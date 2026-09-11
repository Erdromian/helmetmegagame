// What Arelitz LAY: an egg a turn, into the owner's inventory if held, or
// into the room's stash if the animal is sitting parked in one. Run from
// db/index.js#resolveNeeds(), right after structureYield and for the same
// reason — the room half of this must not run before "carry"'s own overflow
// drop, which can already be putting things on that same floor.
//
// Deliberately NOT structureYieldPass's shape. That pass claims each
// structure's own turn on a row (Structure.lastUpkeepTurnId) because nothing
// else protects it from a resume pouring twice. An Arelitz has no such column
// on CharacterTag or RoomTag, and doesn't need one: this whole pass sits
// behind the ordinary `done.has("arelitzLay")` guard in db/index.js, the same
// single-pass idempotency horseUpkeepPass.js relies on. Also unlike that
// pass, structureYieldPass's ruling that "the produce goes on a floor, not
// into pockets" (its own header) does NOT apply here — a structure has no
// owner, and an Arelitz does. An animal's eggs go home with it.
const { addToStack, addToRoomStack } = require("./tagWrites");
const {
  ARELITZ_WARBEAST_SLUG,
  ARELITZ_OVUM_SLUG,
  ARELITZ_THOROUGHBRED_SLUG,
  ARELITZ_EGG_SLUG,
} = require("./constants");

// Warbeast and Thoroughbred lay one egg a turn each, same as a horse trots at
// one pace. The Ovum is the whole point of breeding one: 3-5, rolled fresh
// per animal, per turn.
const LAY_YIELDS = {
  [ARELITZ_WARBEAST_SLUG]: () => 1,
  [ARELITZ_THOROUGHBRED_SLUG]: () => 1,
  [ARELITZ_OVUM_SLUG]: () => 3 + Math.floor(Math.random() * 3),
};
const LAYER_SLUGS = Object.keys(LAY_YIELDS);

async function runArelitzLayPass(prisma, turn) {
  const [layers, egg] = await Promise.all([
    prisma.tag.findMany({ where: { slug: { in: LAYER_SLUGS } }, select: { id: true, slug: true } }),
    prisma.tag.findUnique({ where: { slug: ARELITZ_EGG_SLUG }, select: { id: true } }),
  ]);
  if (!layers.length || !egg) {
    console.error(`Arelitz lay skipped: missing tags — run npm run db:sync-tags.`);
    return null;
  }
  const layerIds = layers.map((t) => t.id);
  const slugById = new Map(layers.map((t) => [t.id, t.slug]));

  const [held, stashed] = await Promise.all([
    prisma.characterTag.findMany({
      where: { tagId: { in: layerIds }, character: { status: "ALIVE" } },
      select: { characterId: true, tagId: true, quantity: true },
    }),
    prisma.roomTag.findMany({
      where: { tagId: { in: layerIds } },
      select: { roomId: true, tagId: true, quantity: true },
    }),
  ]);

  let laidToCharacters = 0;
  let laidToRooms = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of held) {
      const roll = LAY_YIELDS[slugById.get(row.tagId)]();
      const eggs = roll * row.quantity;
      await addToStack(tx, row.characterId, egg.id, eggs, { source: "EVENT", stackable: true });
      laidToCharacters += eggs;
    }
    for (const row of stashed) {
      const roll = LAY_YIELDS[slugById.get(row.tagId)]();
      const eggs = roll * row.quantity;
      await addToRoomStack(tx, row.roomId, egg.id, eggs);
      laidToRooms += eggs;
    }
  });

  return { turnNumber: turn.number, laidToCharacters, laidToRooms };
}

module.exports = { runArelitzLayPass };
