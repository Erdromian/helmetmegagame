// The shared read half of the building system (schema.prisma has the model notes);
// WRITES live in web/app/(app)/character/requestActions.js. Runtime rules never key
// on the assets-structures TagGroup. Takes `prisma`, stays off the barrel.

const { ambientLine } = require("./ambientLine");
const { hasAttribute } = require("./locationAttributes");
const { hasNoticeboard } = require("./noticeboard");

// placement with defaults applied; defaults here must agree with Tag.placement in schema.prisma.
function placementOf(tag) {
  const p = tag?.placement;
  if (!p || typeof p !== "object") return null;
  return {
    unique: p.unique !== false,
    fieldwork: p.fieldwork === true,
    examine: typeof p.examine === "string" ? p.examine : null,
    defenseNote: typeof p.defenseNote === "string" ? p.defenseNote : null,
    miningBonus: p.miningBonus ?? null,
    locations: Array.isArray(p.locations) ? p.locations : [],
    yields: p.yields ?? null,
    birdSendsPerDay: p.birdSendsPerDay ?? null,
    music: p.music ?? null,
    provides: Array.isArray(p.provides) ? p.provides : [],
    inscribable: p.inscribable === true,
    underground: p.underground === true,
    noticeboard: p.noticeboard === true,
    shelter: p.shelter ?? null,
  };
}

// Every structure at a Location, each row carrying its catalog type as `.type` (or null after a prune).
async function structuresAt(prisma, locationId, { statuses = null } = {}) {
  if (!locationId) return [];
  const rows = await prisma.structure.findMany({
    where: { locationId, ...(statuses ? { status: { in: statuses } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // Examine and the desk must never disagree which came first.
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

// Where building is refused: indoors (you do not raise a palisade in the
// Cathedral's nave), CAVE_LEVEL zones for any type not flagged `placement.underground`, and `noBuild`.
function canBuildHere(location, placement = null) {
  if (!location) return { ok: false, reason: "You can't build here." };
  // Cave first: cave levels are also authored `indoors: true`.
  const cave = location.zone?.kind === "CAVE_LEVEL";
  if (cave && !placement?.underground) {
    return { ok: false, reason: "That can't be built down here." };
  }
  // Per-TYPE gate; no placement means the ground question alone.
  const sites = placement?.locations ?? [];
  if (sites.length && !sites.includes(location.slug)) {
    return { ok: false, reason: "The brewery can only be built in the inn." };
  }
  // A NAMED SITE SATISFIES THE INDOORS DEFAULT only — cave and `noBuild` still stand regardless.
  // So does an underground type in a cave: the roof down there is the cave, already answered above.
  if (location.indoors && !sites.length && !cave) {
    return { ok: false, reason: "You can't build indoors." };
  }
  if (hasAttribute(location, "noBuild")) {
    return { ok: false, reason: "You can't build here." };
  }
  // A built board IS the Location's `noticeboard` attribute while it stands (noticeboard.js#raiseBoard),
  // and tearing one down takes the attribute with it. A second one would take an authored board down too.
  if (placement?.noticeboard && hasNoticeboard(location)) {
    return { ok: false, reason: "There's already a noticeboard here." };
  }
  return { ok: true, reason: null };
}

// What an ordinary type gets, and what an underground one gets, on this ground — the two answers a
// Craft menu needs to drop a placement it could not raise (craftRecipes.js#placementOfferedHere).
function buildGround(location) {
  return {
    buildable: canBuildHere(location).ok,
    buildableUnderground: canBuildHere(location, { underground: true }).ok,
  };
}

// One word per status, for a chip or aside. Prose lives in locationAttributes.js#structureLines.
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

// Statuses that OCCUPY the ground for the one-per-place rule: RUINED/ABANDONED
// never block raising the same type again. Shared so the two filters can never drift apart.
const PRESENT_STATUSES = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];

// Statuses in which a structure actually WORKS (defenseNote/mining bonus apply).
const WORKING_STATUSES = ["COMPLETE", "DAMAGED"];

// locationId -> the best (lowest) `placement.shelter.factor` standing there, for the nightly mood
// pass. COMPLETE only, the reading mining takes: a damaged camp shelters nobody. Two reads for the whole game.
async function shelterFactorsByLocation(prisma) {
  const rows = await prisma.structure.findMany({
    where: { status: "COMPLETE" },
    select: { locationId: true, typeSlug: true },
  });
  if (!rows.length) return new Map();
  const types = await prisma.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { slug: true, placement: true },
  });
  const factorBySlug = new Map();
  for (const type of types) {
    const factor = placementOf(type)?.shelter?.factor;
    if (Number.isFinite(factor)) factorBySlug.set(type.slug, factor);
  }
  const best = new Map();
  for (const row of rows) {
    const factor = factorBySlug.get(row.typeSlug);
    if (factor == null) continue;
    const have = best.get(row.locationId);
    if (have == null || factor < have) best.set(row.locationId, factor);
  }
  return best;
}

// --- The lines a site speaks -------------------------------------------
// Scenery, through ambientLine (CLAUDE.md: `-#` subtext). Posted post-commit, catch-logged,
// never awaited inside a transaction. Worker's name is deliberately absent — the count is the story.

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

// GM ruling lines (/gm/structures). Damage/destruction lines deliberately do not say WHO.
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

// Everyone with a StructureWork row, plus the payer if a character. Deduplicated characterIds.
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
  buildGround,
  shelterFactorsByLocation,
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
