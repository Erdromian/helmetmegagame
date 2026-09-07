// The fear dial's nightly settle (docs/systemdocs/FEAR.md). Run from
// db/index.js#resolveNeeds() in the slot the phobia pass used to hold: after
// hunger (it reads the final hungerStreak), after carry (the final sheet), and
// BEFORE travelArrival — a traveller still stands where they set out from, and
// pays the night for that place, the same rule auto-labor and the turrets use.
//
// Per ALIVE character it sums the turn-end terms — the place they stand in, the
// nightly decay, hunger, still being bound, an unburied body in the room, a
// noble who skipped dinner — and applies them in ONE write through
// db/lib/fear.js, its own transaction per character so a bad row cannot roll
// back a hundred good ones. The `dined` marker a meal granted is consumed here
// too, the way hungerPass eats `ate-meal`: the pass that reads it owns it.
//
// Returns an object, never null (null means "did not run, retry"). DMs are not
// sent here — they ride back on `dms` for the thunk. Takes `prisma` as a
// parameter — see db/lib/dm.js.
const {
  BAND_SLUGS,
  MULTIPLIER_SLUGS,
  EVENTS,
  NIGHTLY_DECAY,
  placeClassOf,
  placeTermFor,
  applyFearTerms,
  settleFearTag,
  loadIntensity,
} = require("./fear");
const { DINED_SLUG, NOBILITY_SLUG, HUNGERLESS_SLUG, DYING_SLUG } = require("./constants");

// db/lib/bind.js reads the slug directly too; a hostage's night is not restful.
const BOUND_SLUG = "bound";

// Every Location with a body lying in it that nobody has buried — stashed in a
// Room, or carried by somebody standing there. Same two-legged read as
// bot/src/lib/deathSmell.js, minus its ROTTEN filter: a fresh corpse is the
// more frightening one.
async function unburiedCorpseLocationIds(prisma) {
  const unburied = { corpseOfCharacterId: { not: null }, corpseOf: { buriedAt: null } };
  const [stashed, carried] = await Promise.all([
    prisma.roomTag.findMany({ where: { tag: unburied }, select: { room: { select: { locationId: true } } } }),
    prisma.characterTag.findMany({
      where: { tag: unburied, character: { status: "ALIVE" } },
      select: { character: { select: { locationId: true } } },
    }),
  ]);
  const ids = new Set();
  for (const row of stashed) if (row.room?.locationId) ids.add(row.room.locationId);
  for (const row of carried) if (row.character?.locationId) ids.add(row.character.locationId);
  return ids;
}

async function runFearPass(prisma, turn) {
  const intensity = await loadIntensity(prisma);
  const dinedTag = await prisma.tag.findUnique({ where: { slug: DINED_SLUG }, select: { id: true } });
  const dms = [];
  const failed = [];

  // The off switch: nothing frightens anyone, and every dial empties.
  if (intensity === 0) {
    const zeroed = await prisma.character.updateMany({ where: { fear: { gt: 0 } }, data: { fear: 0 } });
    const holders = await prisma.character.findMany({
      where: { tags: { some: { source: "CONDITION", tag: { slug: { in: BAND_SLUGS } } } } },
      select: { id: true },
    });
    for (const { id } of holders) {
      await settleFearTag(prisma, id).catch((err) => {
        console.error(`Fear settle (off) failed for ${id}:`, err.message ?? err);
        failed.push(id);
      });
    }
    if (dinedTag) await prisma.characterTag.deleteMany({ where: { tagId: dinedTag.id } });
    return { turnNumber: turn.number, intensity, zeroed: zeroed.count, settled: holders.length, raised: 0, eased: 0, cleared: 0, failed, dms };
  }

  const corpseLocationIds = await unburiedCorpseLocationIds(prisma);
  // One read per character, and applyFearTerms is handed the row rather than
  // re-reading it: the tag rows here cover everything it needs — the
  // multiplier slugs, the band rows it settles, and this pass's own gates.
  const watched = [...MULTIPLIER_SLUGS, ...BAND_SLUGS, NOBILITY_SLUG, HUNGERLESS_SLUG, DYING_SLUG, DINED_SLUG, BOUND_SLUG];
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      status: true,
      fear: true,
      discordUserId: true,
      hungerStreak: true,
      locationId: true,
      location: { select: { indoors: true, attributes: true, zone: { select: { kind: true } } } },
      tags: { where: { tag: { slug: { in: watched } } }, select: { tagId: true, source: true, tag: { select: { slug: true } } } },
    },
  });

  let settled = 0;
  let raised = 0;
  let eased = 0;
  let cleared = 0;
  let skipped = 0;
  const byPlace = {};

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    const terms = [];
    const placeClass = placeClassOf(character.location);
    byPlace[placeClass] = (byPlace[placeClass] ?? 0) + 1;
    terms.push(placeTermFor(placeClass));
    if (character.fear > 0) terms.push({ kind: "DECAY", base: NIGHTLY_DECAY });
    if (character.hungerStreak > 0) terms.push({ kind: "HUNGER", base: EVENTS.HUNGER });
    if (held.has(BOUND_SLUG)) terms.push({ kind: "BOUND", base: EVENTS.BOUND_HELD });
    if (character.locationId && corpseLocationIds.has(character.locationId)) terms.push({ kind: "CORPSE", base: EVENTS.CORPSE });
    const noble = held.has(NOBILITY_SLUG) && !held.has(HUNGERLESS_SLUG) && !held.has(DYING_SLUG);
    if (noble && !held.has(DINED_SLUG)) terms.push({ kind: "NOBLE_MEAL", base: EVENTS.NOBLE_MEAL });

    // A calm character somewhere calm has nothing to settle: no write.
    if (character.fear === 0 && !terms.some((t) => t.base > 0)) {
      skipped += 1;
      continue;
    }

    const result = await prisma
      .$transaction((tx) => applyFearTerms(tx, character.id, terms, { intensity, notify: false, character }))
      .catch((err) => {
        console.error(`Fear settle failed for ${character.id}:`, err.message ?? err);
        failed.push(character.id);
        return null;
      });
    if (!result) continue;
    settled += 1;
    if (result.after > result.before) raised += 1;
    else if (result.after < result.before) eased += 1;
    if (result.previousBand && !result.band) cleared += 1;
    if (result.dm) dms.push(result.dm);
  }

  // Every `dined` marker is eaten here, once, AFTER the loop — not inside each
  // character's transaction. A pass that dies half-way is re-run from the top
  // on the next advance, and a per-character delete would have already taken
  // the marker off the nobles it had reached, charging them for a dinner they
  // ate. Done this way a replay is at worst a repeat, never a wrong direction.
  if (dinedTag) await prisma.characterTag.deleteMany({ where: { tagId: dinedTag.id } });

  // A corpse or a Catatonic character wants no band; sweep what is left on them.
  const stale = await prisma.character.findMany({
    where: { status: { not: "ALIVE" }, tags: { some: { source: "CONDITION", tag: { slug: { in: BAND_SLUGS } } } } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await settleFearTag(prisma, id).catch((err) => {
      console.error(`Fear sweep failed for ${id}:`, err.message ?? err);
      failed.push(id);
    });
  }

  return {
    turnNumber: turn.number,
    intensity,
    settled,
    skipped,
    raised,
    eased,
    cleared,
    byPlace,
    corpseLocations: corpseLocationIds.size,
    swept: stale.length,
    failed,
    dms,
  };
}

module.exports = { runFearPass };
