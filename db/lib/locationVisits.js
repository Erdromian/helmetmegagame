// What a character knows of the map — the fog behind /map.
//
// The ONE module that reads or writes LocationVisit, for the same reason
// db/lib/locationGraph.js is the one module that touches LocationLink: the
// rule about what a player may see is a policy, and a second copy of it would
// drift into a leak. Nothing here decides passability itself — every question
// about an edge is asked of locationGraph.
//
// Two grades of knowing. `stood` is "I have been here". A row without it is "I
// have seen this from next door", which draws hollow and carries a name but no
// description. Neither is ever unlearned: seen once, drawn forever, so the map
// only ever grows.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { travelOptions } = require("./locationGraph");

// Called on arrival — from applyLocationMoveSideEffects, which is the one
// function every writer of Character.locationId runs (MAP.md §4). Hooking
// there rather than in performLocationMove is what stops a GM teleport, a
// character's first placement or the turn's arrival pass from leaving a hole
// in somebody's map.
//
// `character` wants tags loaded (CHARACTER_SELECT shape is enough);
// travelOptions falls back to querying them if not.
async function recordArrival(prisma, character, locationId) {
  if (!character?.id || !locationId) return;

  await prisma.locationVisit.upsert({
    where: { characterId_locationId: { characterId: character.id, locationId } },
    create: { characterId: character.id, locationId, stood: true },
    update: { stood: true },
  });

  // Everything one step away, as a sighting. travelOptions rather than
  // linksFor: it has already dropped the ways this character cannot see, so a
  // hidden crawl they lack the tag for is never recorded and can never be
  // revealed by the map later.
  const neighbours = await travelOptions(prisma, character, locationId);
  if (neighbours.length === 0) return;

  // skipDuplicates is load-bearing, not an optimisation. It is what makes this
  // write unable to touch a row that already exists — so a place the character
  // has actually STOOD in can never be downgraded to a bare sighting by
  // walking past its door afterwards.
  await prisma.locationVisit.createMany({
    data: neighbours.map((row) => ({
      characterId: character.id,
      locationId: row.location.id,
      stood: false,
    })),
    skipDuplicates: true,
  });
}

// Everything this character knows, as two sets. `stood` is a subset of `seen`
// — a place you have been is also a place you have seen — so a caller asking
// "is this on the map at all" checks `seen`.
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

module.exports = { recordArrival, knownLocations };
