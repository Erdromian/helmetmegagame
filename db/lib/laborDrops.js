// The labor drop die: what a Labor payout can find, on top of its ⬢. See
// docs/systemdocs/LABORDROPS.md.
//
// The config lives in the database (LaborDropOption), synced from
// docs/labordrops.yaml by db/lib/syncLaborDrops.js. This file is the reading
// half: given a roll and the three scopes a payout happened under, it finds
// every entry that answers to them and draws one.
//
// The draw is TWO-STAGE, the shape db/lib/cavingLoot.js has always had: land
// on a rarity band by the die face's column, then pick evenly among that
// band's members. db/lib/labordropsRarity.js owns the columns and the
// arithmetic; this file owns finding the pool.
//
// It used to be uniform over the concatenated pool, with repetition as the
// only way to weight anything. That cost three things — nothing could be
// rarer than 1/poolsize, every bucket needed its own `nothing` pad or
// stacking raised the wound rate, and a local table diluted the global one.
// labordropsRarity.js's header has the full account.
//
// A row may ALSO carry requiredTagId, a seventh gate orthogonal to the six
// scopes — "only in this combined pool for a character who holds this tag
// too" (Forester in the Forest is the first user). It is not part of the SQL
// WHERE, because "does the drawing character hold tag X" cannot be expressed
// against a query keyed on their zone/location/laborType alone — it is a
// post-filter over whatever the six scopes already matched, applied by
// passesRequiredTag below.

// db/lib/laborAccess.js#resolveLaborRateFrom's own tier strings. "refining"
// has no entry — the Godard Factory pays in goods, not a die (FACTORY.md),
// and db/lib/moveEffects.js's laborDrop effect skips it before this is ever
// called.
const { drawFromPool } = require("./labordropsRarity");

const TIER_TO_LABOR_DROP_TYPE = {
  basic: "BASIC",
  skilled: "SKILLED",
  hunting: "HUNTING",
  farming: "FARMING",
  fishing: "FISHING",
};

// The six legal scope combinations a pool can be authored under (LABORDROPS.md
// §2). Never zone AND location together — that combination isn't one of the
// six the design calls for, and the sync refuses to write it.
function scopeFilters(laborType, zoneId, locationId) {
  const filters = [{ laborType: null, zoneId: null, locationId: null }]; // Global
  if (laborType) filters.push({ laborType, zoneId: null, locationId: null });
  if (zoneId) filters.push({ laborType: null, zoneId, locationId: null });
  if (laborType && zoneId) filters.push({ laborType, zoneId, locationId: null });
  if (locationId) filters.push({ laborType: null, zoneId: null, locationId });
  if (laborType && locationId) filters.push({ laborType, zoneId: null, locationId });
  return filters;
}

// A row with no requiredTagId always passes. One with it set needs the
// drawing character's held tag ids to include it — heldTagIds defaults to
// empty, so a caller that doesn't know what a character holds (or genuinely
// holds nothing) correctly sees every gated row excluded rather than
// leaking in. Pure, so it's unit-tested without a database
// (db/test/laborDrops.test.js).
function passesRequiredTag(row, heldTagIds = new Set()) {
  return !row.requiredTagId || heldTagIds.has(row.requiredTagId);
}

// Every pool entry across the combined scopes for one roll that the drawing
// character actually qualifies for (requiredTagId included), in DB order —
// callers that just want the whole pool (a preview, a test) can use this
// directly; pickLaborDropOption below is the one that actually draws.
async function laborDropPool(tx, { roll, laborType = null, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const rows = await tx.laborDropOption.findMany({
    where: { roll, OR: scopeFilters(laborType, zoneId, locationId) },
    include: { tag: { select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true } } },
  });
  return rows.filter((row) => passesRequiredTag(row, heldTagIds));
}

// Draws one entry from the combined pool, or null when nothing is configured
// for this roll at all (or nothing in it survives the requiredTagId gate) —
// which is the deliberate default while most of the table is still unbuilt
// (CLAUDE.md session note: "we don't have the full loot table figured out
// yet"). Faces 2-4 have no column, so they are always null.
//
// A NOTHING row can win, and that is not the same as returning null: the
// caller distinguishes "the die was rolled and gave nothing" from "there was
// no table to roll on", and only the first is a real result.
async function pickLaborDropOption(tx, { roll, laborType = null, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const pool = await laborDropPool(tx, { roll, laborType, zoneId, locationId, heldTagIds });
  if (pool.length === 0) return null;
  return drawFromPool(pool, roll);
}

module.exports = {
  TIER_TO_LABOR_DROP_TYPE,
  scopeFilters,
  passesRequiredTag,
  laborDropPool,
  pickLaborDropOption,
};
