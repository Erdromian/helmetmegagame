// The map a character is made remembering (Map.docx; MAP.md §6a). Map
// knowledge is a MEMORY — the same kind of thing the Friends list is — that
// the player never reads as text: it lives in LocationVisit and shows only as
// the map, and Concussed/Amnesiac scramble it there (MEMORIES.md §6). Nothing
// about it is drawn on /memories, whose payload is snapshotted to the browser.
//
// Everybody except the outsiders starts knowing every place and every way
// outside the Caves and the Depths. The per-role table in
// db/lib/startingMemories.js still runs on top of this: it is what marks a
// seat's own home as somewhere they have STOOD, rather than somewhere they
// only know of.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.

const { isLateJoinRoleSlug } = require("./lateJoin");
const { hasAttribute } = require("./locationAttributes");
const { seedMemories } = require("./locationVisits");
const { startingMemorySlugs } = require("./startingMemories");

// The seats the floor is NOT for. A Migrant walking in through the caves has
// never seen Ravenheart, and the late joins (the Tribunal and the Bastard's
// party, db/lib/lateJoin.js) march in from outside. Each keeps only its own
// line of the role table.
function isMapOutsider(roleSlug) {
  return roleSlug === "migrant" || isLateJoinRoleSlug(roleSlug);
}

// Which Locations the floor hands over, as ids.
//
// Every live, on-the-map Location outside a CAVE_LEVEL zone that has at least
// one NON-HIDDEN way to another such Location. That second half is the whole
// guard against leaking, and it is a rule rather than a list:
//   - the Charon (fortress-6) has no way at all — only its three seats know it;
//   - Space carries offMap and has no way either;
//   - the Hole in the Wall is reached only by hidden crawls and a climb up out
//     of the Depths, so it has no ordinary way from the known world.
// A LOCKED way still counts: a door you can see and not open is on the map for
// everybody already (MAP.md §2a), so knowing where it leads is no secret.
//
// Pure, over rows shaped like loadGraph's (a Location with its `zone`, a link
// with aId/bId/hidden), so the test can hand it a world without a database.
function mapFloorIds(locations, links) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const eligible = (l) => l && !l.retiredAt && l.zone?.kind !== "CAVE_LEVEL" && !hasAttribute(l, "offMap");
  const out = new Set();
  for (const link of links) {
    if (link.hidden) continue;
    const a = byId.get(link.aId);
    const b = byId.get(link.bId);
    if (!eligible(a) || !eligible(b)) continue;
    out.add(a.id);
    out.add(b.id);
  }
  return out;
}

async function mapFloorLocationIds(prisma) {
  const [locations, links] = await Promise.all([
    prisma.location.findMany({
      select: { id: true, retiredAt: true, attributes: true, zone: { select: { kind: true } } },
    }),
    prisma.locationLink.findMany({ select: { aId: true, bId: true, hidden: true } }),
  ]);
  return mapFloorIds(locations, links);
}

// Writes the floor as SIGHTINGS (stood: false): a hollow crosshair and a name,
// no description and no rooms — you know the Keep is there, not what is inside
// it. One bulk write rather than recordArrival per place, on purpose: that
// paints every listed NEIGHBOUR as well, and would hand over the cave mouth off
// the Bridge and the Depot, which the floor exists to leave dark.
// skipDuplicates means it can never downgrade somewhere already stood in.
async function seedMapFloor(prisma, characterId) {
  if (!characterId) return;
  const ids = await mapFloorLocationIds(prisma);
  if (ids.size === 0) return;
  await prisma.locationVisit.createMany({
    data: [...ids].map((locationId) => ({ characterId, locationId, stood: false })),
    skipDuplicates: true,
  });
}

// What every character-creating path calls once, after its transaction: the
// floor (unless an outsider), then the role table on top of it. `character`
// needs id and locationId, plus `tags` if the caller has them loaded.
async function seedStartingMap(prisma, character, roleSlug, tagSlugs = []) {
  if (!character?.id) return;
  if (!isMapOutsider(roleSlug)) await seedMapFloor(prisma, character.id);
  await seedMemories(prisma, character, startingMemorySlugs(roleSlug, tagSlugs));
}

module.exports = { isMapOutsider, mapFloorIds, mapFloorLocationIds, seedMapFloor, seedStartingMap };
