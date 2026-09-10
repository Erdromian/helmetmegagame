// Structures: the shared read half of the building system.
//
// A Structure row is a built thing standing at a Location — and, while
// UNDER_CONSTRUCTION, the build site itself (schema.prisma has the full
// model notes). This module owns the reads and the wording both faces
// share: the loader that joins a row to its catalog type, the derived
// can-you-build-here rule, and the ambient lines a site speaks into its
// Location channel. The WRITES live in the web server actions
// (web/app/(app)/character/requestActions.js) — the web face is the only
// builder, the same way it is the only crafter.
//
// Structure types live in the assets-structures TagGroup
// (docs/taggroups.yaml) — display color and catalog organisation only. The
// runtime rules never key on the group: unique is per-type
// (placement.unique), non-stacking is per labor kind
// (laborAccess.js#structureTools).
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { ambientLine } = require("./ambientLine");
const { hasAttribute } = require("./locationAttributes");

// placement with its defaults applied. Normalisation/validation happen at
// sync time (db/lib/tagShapes.js); this is the read-side accessor, and the
// defaults here must agree with the ones documented on Tag.placement in
// schema.prisma.
function placementOf(tag) {
  const p = tag?.placement;
  if (!p || typeof p !== "object") return null;
  return {
    unique: p.unique !== false,
    fieldwork: p.fieldwork === true,
    examine: typeof p.examine === "string" ? p.examine : null,
    defenseNote: typeof p.defenseNote === "string" ? p.defenseNote : null,
    laborBonus: p.laborBonus ?? null,
    locations: Array.isArray(p.locations) ? p.locations : [],
    yields: p.yields ?? null,
    birdSendsPerDay: p.birdSendsPerDay ?? null,
    music: p.music ?? null,
    provides: Array.isArray(p.provides) ? p.provides : [],
    inscribable: p.inscribable === true,
  };
}

// Every structure standing (or rising, or ruined) at a Location, each row
// carrying its catalog type as `.type` (or null after a catalog prune —
// callers render typeName and skip type-dependent behaviour). One query per
// table, joined in JS: typeSlug is a string on purpose (schema.prisma), so
// there is no relation to include.
async function structuresAt(prisma, locationId, { statuses = null } = {}) {
  if (!locationId) return [];
  const rows = await prisma.structure.findMany({
    where: { locationId, ...(statuses ? { status: { in: statuses } } : {}) },
    // The id tiebreaker keeps two same-instant rows in one stable order —
    // Examine and the desk must never disagree about which came first.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!rows.length) return [];
  const types = await prisma.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { id: true, slug: true, name: true, placement: true },
  });
  const bySlug = new Map(types.map((t) => [t.slug, t]));
  return rows.map((row) => {
    const type = bySlug.get(row.typeSlug) ?? null;
    return { ...row, type, placement: type ? placementOf(type) : null };
  });
}

// Where building is refused. DERIVED from columns the game already
// maintains, not a hand-authored denylist: indoors (you do not raise a
// palisade in the Cathedral's nave), a CAVE_LEVEL zone (no #summary
// underground, so nothing built there could ever announce — MAP.md §1),
// and the `noBuild` attribute for the genuine one-offs the registry names
// (the Depot, the Lifeweb's ground). `location` needs
// { indoors, attributes, zone: { kind } }.
function canBuildHere(location, placement = null) {
  if (!location) return { ok: false, reason: "You can't build here." };
  // Cave first: the cave levels are also authored `indoors: true`, and the
  // underground refusal is the truer sentence for them.
  if (location.zone?.kind === "CAVE_LEVEL") {
    return { ok: false, reason: "Nothing can be built down here." };
  }
  // The per-TYPE gate, and the only rule here that needs to know what is
  // being raised — everything above and below is a fact about the ground
  // alone. Passing no placement asks the ground question only, which is what
  // the sheet's "is there anywhere to build" flag wants and what every caller
  // written before this key did by default.
  const sites = placement?.locations ?? [];
  if (sites.length && !sites.includes(location.slug)) {
    return { ok: false, reason: "The brewery can only be build in the inn." };
  }
  // A NAMED SITE SATISFIES THE INDOORS DEFAULT, and this is the one rule here
  // worth arguing about. "You can't build indoors" is a blanket answer for a
  // type that names nowhere — you do not raise a palisade in the Cathedral's
  // nave, and nothing in the catalog said otherwise. But a type whose
  // `locations` list names exactly where it may stand has already had that
  // judgement made for it, by the person who wrote the list. The Brewery is
  // the case that forced the question: it belongs at the Old Cock Inn,
  // pouring into the cellar underneath, and the inn is `indoors: true`.
  //
  // The bypass is deliberately narrow. It covers the indoors DEFAULT only —
  // the cave refusal above and `noBuild` below both stand whatever a type
  // claims, because those two name real one-off ground (no #summary
  // underground for anything to announce into; the Depot and the Lifeweb's
  // own floor) rather than a general habit.
  if (location.indoors && !sites.length) {
    return { ok: false, reason: "You can't build indoors." };
  }
  if (hasAttribute(location, "noBuild")) {
    return { ok: false, reason: "You can't build here." };
  }
  return { ok: true, reason: null };
}

// One word per status, for surfaces that need the state as a chip or an
// aside. Prose sentences live in locationAttributes.js#structureLines.
function statusWord(status) {
  switch (status) {
    case "UNDER_CONSTRUCTION":
      return "half-built";
    case "COMPLETE":
      return "standing";
    case "DAMAGED":
      return "damaged";
    case "RUINED":
      return "a ruin";
    case "ABANDONED":
      return "abandoned groundwork";
    default:
      return String(status ?? "").toLowerCase();
  }
}

// The statuses that OCCUPY the ground for the one-per-place rule: a wreck —
// RUINED or ABANDONED — never blocks raising the same type again. Shared so
// the server's refusal (openBuildSiteImpl) and the Craft menu's filter
// (web/lib/tagRequests.js#placementOfferedHere) can never drift apart.
const PRESENT_STATUSES = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];

// The statuses in which a structure actually WORKS: a damaged palisade still
// stands and its defenseNote still applies; a rising site and a wreck do
// nothing yet or nothing any more. web/lib/moveRows.js prints the note only
// for these, and the labor bonus (laborAccess.js) is stricter still —
// COMPLETE only.
const WORKING_STATUSES = ["COMPLETE", "DAMAGED"];

// --- The lines a site speaks -------------------------------------------
//
// All three are scenery and go through ambientLine (CLAUDE.md: a line the
// WORLD says into a channel is `-#` subtext). Callers post the result to
// the Location's own channel (Location.discordChannelId) AFTER their
// transaction commits — discordRest.js#postMessage from the web face —
// and every send is catch-logged, never awaited inside a transaction.
//
// The worker's name is deliberately absent from the advance line: who is
// swinging a hammer is visible to anyone standing there in the fiction,
// but a per-name feed would turn the channel into a work log. The count is
// the story.

function siteOpenedLine(structure) {
  return ambientLine(
    `Work begins on a ${structure.typeName} here (1/${structure.turnsNeeded}).`,
  );
}

function siteAdvancedLine(structure, turnsDone) {
  return ambientLine(
    `The ${structure.typeName} rises (${turnsDone}/${structure.turnsNeeded}).`,
  );
}

function siteCompletedLine(structure) {
  return ambientLine(`The ${structure.typeName} stands finished.`);
}

function siteCancelledLine(structure) {
  return ambientLine(`Work on the ${structure.typeName} is abandoned.`);
}

// The GM ruling lines (/gm/structures). Same scenery rules as the site
// lines above: ambientLine, posted post-commit, catch-logged. The damage
// and destruction lines deliberately do not say WHO — the desk adjudication
// and #summary carry the story; the channel just sees the state change.
function structureDamagedLine(structure) {
  return ambientLine(`The ${structure.typeName} here has taken damage.`);
}

function structureRepairedLine(structure) {
  return ambientLine(`The ${structure.typeName} here stands whole again.`);
}

function structureDestroyedLine(structure) {
  return ambientLine(`The ${structure.typeName} here is destroyed — a ruin of it remains.`);
}

function structureClearedLine(structure) {
  return ambientLine(`The remains of the ${structure.typeName} here have been cleared away.`);
}

// The notification list: everyone with a StructureWork row, plus the payer
// when the payer is a character — a structure has no owner, but the people
// whose turns raised it hear when something happens to it. Returns
// characterIds, deduplicated, optionally without the actor themselves.
async function stakeholderCharacterIds(prisma, structureId, { except = null, payerKey = null } = {}) {
  const work = await prisma.structureWork.findMany({
    where: { structureId },
    select: { characterId: true },
  });
  const ids = new Set(work.map((w) => w.characterId));
  const payerParts = String(payerKey ?? "").split(":");
  if (payerParts[0] === "character" && payerParts[1]) ids.add(payerParts[1]);
  if (except) ids.delete(except);
  return [...ids];
}

module.exports = {
  PRESENT_STATUSES,
  WORKING_STATUSES,
  placementOf,
  structuresAt,
  canBuildHere,
  statusWord,
  siteOpenedLine,
  siteAdvancedLine,
  siteCompletedLine,
  siteCancelledLine,
  structureDamagedLine,
  structureRepairedLine,
  structureDestroyedLine,
  structureClearedLine,
  stakeholderCharacterIds,
};
