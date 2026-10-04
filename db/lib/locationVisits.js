// The fog behind /map. The ONE module reading or writing LocationVisit, same
// reason db/lib/locationGraph.js is the one for LocationLink. `stood` is "I have been here"; without it, "seen from next door" (hollow). Deliberately NOT on the @lifeweb/db barrel — require by path.
const { travelOptions } = require("./locationGraph");
const { onRoadsWhere } = require("./offRoad");

// Called from applyLocationMoveSideEffects, run by every writer of Character.locationId (MAP.md §4).
//
// `neighbours` is the same travelOptions list this would otherwise go and fetch. Pass it when you already have one — web/app/(app)/map/actions.js builds it to draw the board — and this costs two writes instead of two writes and a graph read. It must be travelOptions output, NOT linksFor: the hidden-way rule below is the whole reason this does its own read by default.
async function recordArrival(prisma, character, locationId, { neighbours = null } = {}) {
  if (!character?.id || !locationId) return;

  await prisma.locationVisit.upsert({
    where: { characterId_locationId: { characterId: character.id, locationId } },
    create: { characterId: character.id, locationId, stood: true },
    update: { stood: true },
  });

  // travelOptions, not linksFor — a hidden crawl the character lacks the tag for is never recorded.
  const seen = neighbours ?? (await travelOptions(prisma, character, locationId));
  if (seen.length === 0) return;

  // skipDuplicates is load-bearing — a STOOD place can never be downgraded.
  await prisma.locationVisit.createMany({
    data: seen.map((row) => ({
      characterId: character.id,
      locationId: row.location.id,
      stood: false,
    })),
    skipDuplicates: true,
  });
}

// db/lib/startingMemories.js. recordArrival per location, not one bulk write, so the hidden-way rule above is obeyed rather than re-derived.
async function seedMemories(prisma, character, locationSlugs) {
  if (!character?.id || !locationSlugs?.length) return;

  const locations = await prisma.location.findMany({
    where: { slug: { in: locationSlugs } },
    select: { id: true },
  });

  for (const location of locations) {
    if (location.id === character.locationId) continue;
    await recordArrival(prisma, character, location.id);
  }
}

async function knownLocations(prisma, characterId) {
  const empty = { stood: new Set(), seen: new Set() };
  if (!characterId) return empty;

  const rows = await prisma.locationVisit.findMany({
    where: { characterId },
    select: { locationId: true, stood: true },
  });

  const stood = new Set();
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.locationId);
    if (row.stood) stood.add(row.locationId);
  }
  return { stood, seen };
}

// Deliberately NOT recordArrival/seedMemories reused — those also paint
// NEIGHBOURS, leaking a cave-adjacent Location as a "sighting". `stood: false` throughout; `skipDuplicates` keeps a stood-in Location from ever downgrading.
//
// A place with NO LocationLink at either end is not part of the surface a map
// can show, and is skipped. That is not tidiness: the Charon sits in the
// Fortress zone, which is SURFACE, and the whole arrangement in
// db/lib/startingMemories.js is that its table is the only way anybody ever
// learns the ship exists — so a map item sweeping every SURFACE Location was
// handing it to whoever spent one. The Charon's orbit is the same shape. An
// edgeless Location is the honest test rather than a slug check: you cannot
// walk to it, so a picture of the roads has nothing to draw (db/lib/offRoad.js).
async function revealSurface(prisma, characterId) {
  if (!characterId) return;
  const locations = await prisma.location.findMany({
    where: {
      zone: { kind: "SURFACE" },
      ...onRoadsWhere(),
    },
    select: { id: true },
  });
  if (locations.length === 0) return;
  await prisma.locationVisit.createMany({
    data: locations.map((location) => ({ characterId, locationId: location.id, stood: false })),
    skipDuplicates: true,
  });
}

module.exports = { recordArrival, seedMemories, revealSurface, knownLocations };
