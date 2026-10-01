// A Caving find of a non-stackable tag the caver already holds (CAVING.md §2g).
// It used to vanish: addToStack leaves a held non-stackable row alone. Now a
// tradeable one is left in a room at the Location that the caver can get into,
// and anything else changes nothing and says so.
//
// Runs the real roll against a real Postgres, with the die pinned to 6 and the
// draw pinned to throwaway tags this test mints. Skips unless DATABASE_URL is a
// local one (db/lib/localDatabase.js); makes its own character and tags, and
// deletes them after.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

// Pinned before cavingPass is loaded: it destructures both at require time.
const loot = require("../lib/cavingLoot");
const advantage = require("../lib/advantage");
let drawSlug = null;
loot.drawLoot = () => ({ tier: "rare", slug: drawSlug, quantity: 1 });
advantage.rollWithAdvantage = () => ({ die: 6 });
const { rollCaving } = require("../lib/cavingPass");

test("a doubled non-stackable find goes into a room the caver can get into", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const location = await prisma.location.findUnique({ where: { slug: "caves-2" }, include: { zone: true } });
  const rooms = location
    ? await prisma.room.findMany({ where: { locationId: location.id, retiredAt: null }, select: { id: true, name: true, kind: true, accessTagSlugs: true } })
    : [];
  const keyed = rooms.find((r) => r.kind === "PRIVATE" && r.accessTagSlugs.length);
  const turn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  if (!location || !keyed || rooms.every((r) => r.kind === "PRIVATE") || !turn) {
    await prisma.$disconnect();
    return t.skip("the local database has no caves-2 with a keyed room, or no Turn — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const minted = [];
  let caver = null;
  t.after(async () => {
    // The character first: its CavingRoll rows cascade, and they point at the tags.
    if (caver) {
      await prisma.characterTag.deleteMany({ where: { characterId: caver.id } });
      await prisma.character.deleteMany({ where: { id: caver.id } });
      await prisma.auditLog.deleteMany({ where: { targetCharacterId: caver.id } }).catch(() => {});
    }
    await prisma.roomTag.deleteMany({ where: { tagId: { in: minted.map((m) => m.id) } } });
    await prisma.tag.deleteMany({ where: { id: { in: minted.map((m) => m.id) } } });
    await prisma.$disconnect();
  });

  // No price on any of them, so nothing reaches the economy ledger.
  async function mint(key, data) {
    const tag = await prisma.tag.create({
      data: { slug: `cdf-${run}-${key}`, name: `Doubled ${key} ${run}`, category: "Items", ...data },
    });
    minted.push(tag);
    return tag;
  }
  const lamp = await mint("lamp", { stackable: false, tradeable: true });
  const notes = await mint("notes", { stackable: false, tradeable: false });
  const twine = await mint("twine", { stackable: true, tradeable: true });

  caver = await prisma.character.create({
    data: {
      discordUserId: `cdf-test-${run}`,
      firstName: "Doubled",
      lastName: "Test",
      name: `Doubled Test ${run}`,
      status: "ALIVE",
      zoneId: location.zoneId,
      locationId: location.id,
    },
  });

  const roll = async (tag) => {
    drawSlug = tag.slug;
    return rollCaving(prisma, caver, turn, location);
  };
  const onSheet = async (tag) =>
    (await prisma.characterTag.findUnique({ where: { characterId_tagId: { characterId: caver.id, tagId: tag.id } } }))?.quantity ?? 0;
  const inRooms = async (tag) =>
    (await prisma.roomTag.findMany({ where: { tagId: tag.id }, select: { roomId: true, quantity: true } }));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  // The first one goes on the sheet, as it always did.
  let r = await roll(lamp);
  assert.equal(await onSheet(lamp), 1);
  assert.equal(r.roll.lootAlreadyHeld, false);
  assert.equal(r.roll.lootRoomId, null);
  assert.equal(r.dm.content, `Caving Die: 6 — You found something: ${lamp.name}.`);

  // Every repeat lands in a room — never the keyed one, which they cannot open.
  for (let i = 0; i < 12; i++) {
    r = await roll(lamp);
    assert.equal(r.roll.lootAlreadyHeld, true);
    assert.ok(r.roll.lootRoomId, "a room is recorded");
    assert.notEqual(r.roll.lootRoomId, keyed.id, `${keyed.name} is locked to them`);
    assert.equal(
      r.dm.content,
      `Caving Die: 6 — You found something: ${lamp.name}. You already have one, so you leave it in ${roomName.get(r.roll.lootRoomId)}.`,
    );
  }
  assert.equal(await onSheet(lamp), 1, "the sheet still holds one");
  const stash = await inRooms(lamp);
  assert.equal(stash.reduce((n, s) => n + s.quantity, 0), 12, "all twelve repeats are in the rooms");
  assert.equal(
    await prisma.roomTag.count({ where: { tagId: lamp.id, floorDay: { not: null } } }),
    0,
    "a find is not something they set down, so it does not sink",
  );

  // Holding one of the keyed room's tokens opens it to the draw as well.
  const key = await prisma.tag.findUnique({ where: { slug: keyed.accessTagSlugs[0] }, select: { id: true } });
  if (key) {
    await prisma.characterTag.create({ data: { characterId: caver.id, tagId: key.id, source: "GM_GRANT" } });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) reached = (await roll(lamp)).roll.lootRoomId === keyed.id;
    assert.ok(reached, `with the key, ${keyed.name} can take it`);
  }

  // A second of something that cannot change hands goes nowhere, and says so.
  await roll(notes);
  r = await roll(notes);
  assert.equal(await onSheet(notes), 1);
  assert.equal(r.roll.lootAlreadyHeld, true);
  assert.equal(r.roll.lootRoomId, null);
  assert.equal((await inRooms(notes)).length, 0);
  assert.equal(r.dm.content, `Caving Die: 6 — You found something: ${notes.name}. You already have it.`);

  // A stack still stacks.
  await roll(twine);
  r = await roll(twine);
  assert.equal(await onSheet(twine), 2);
  assert.equal(r.roll.lootAlreadyHeld, false);
  assert.equal((await inRooms(twine)).length, 0);
});
