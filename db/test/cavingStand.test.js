// Where everybody stood when the turn locked (db/lib/cavingStand.js, CAVING.md §5c), against a real
// Postgres: who the freeze stamps, that it only ever adds, and the result the server works out from a
// roll before and after it. Skips unless DATABASE_URL is a local one (db/lib/localDatabase.js); makes its
// own characters and deletes them after, with every stand the freeze wrote on the way.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("the freeze stamps cavers and everybody underground, once, and the result follows it", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const { freezeCavingStands, cavingResultMembers } = require("../lib/cavingStand");

  const cave = await prisma.location.findUnique({ where: { slug: "caves-2" }, select: { id: true, zoneId: true } });
  const surface = await prisma.location.findFirst({ where: { zone: { kind: { not: "CAVE_LEVEL" } }, retiredAt: null }, select: { id: true, zoneId: true } });
  const turn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  if (!cave || !surface || !turn) {
    await prisma.$disconnect();
    return t.skip("the local database has no caves-2, no surface Location, or no Turn — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const started = new Date(Date.now() - 1000);
  const made = [];
  t.after(async () => {
    // The characters take their rolls and stands with them; the freeze also stamped anybody else underground.
    await prisma.character.deleteMany({ where: { id: { in: made.map((c) => c.id) } } });
    await prisma.cavingStand.deleteMany({ where: { turnId: turn.id, createdAt: { gte: started } } });
    await prisma.$disconnect();
  });

  const person = async (key, at) => {
    const c = await prisma.character.create({
      data: {
        discordUserId: `cst-${run}-${key}`,
        firstName: key,
        name: `${key} ${run}`,
        status: "ALIVE",
        zoneId: at.zoneId,
        locationId: at.id,
      },
    });
    made.push(c);
    return c;
  };
  const one = (c, at, ms) =>
    prisma.cavingRoll.create({
      data: { turnId: turn.id, characterId: c.id, zoneId: at.zoneId, locationId: at.id, die: 1, kind: "TROUBLE", createdAt: new Date(ms) },
    });

  const ada = await person("Ada", cave); // a 1, standing in the cave
  const bob = await person("Bob", cave); // no 1, standing in the cave
  const cal = await person("Cal", surface); // a 1, already moved up by a GM
  const dee = await person("Dee", surface); // nothing to do with the caves
  const base = Date.now();
  const ada1 = await one(ada, cave, base);
  const ada2 = await one(ada, cave, base + 1000);
  const cal1 = await one(cal, cave, base - 1000);

  // Before the lock: Ada's own 1s, nobody else.
  const before = await cavingResultMembers(prisma, ada2);
  assert.equal(before.merged, false);
  assert.deepEqual(before.rolls.map((r) => r.id), [ada1.id, ada2.id], "oldest first");
  assert.deepEqual(before.bystanderIds, []);

  await freezeCavingStands(prisma, turn);
  const stands = await prisma.cavingStand.findMany({ where: { turnId: turn.id, characterId: { in: made.map((c) => c.id) } } });
  const at = new Map(stands.map((s) => [s.characterId, s]));
  assert.equal(at.get(ada.id)?.locationId, cave.id);
  assert.equal(at.get(bob.id)?.locationId, cave.id, "underground with no 1 is still stamped");
  assert.equal(at.get(cal.id)?.locationId, surface.id, "a caver with a 1 is stamped wherever they are");
  assert.equal(at.has(dee.id), false, "nobody on the surface without a 1");
  assert.ok(at.get(bob.id).presentedState, "a bystander's snapshot is taken at the lock");

  // A second tick adds nobody already there, and moves nobody either.
  await prisma.character.update({ where: { id: bob.id }, data: { locationId: surface.id, zoneId: surface.zoneId } });
  await freezeCavingStands(prisma, turn);
  const again = await prisma.cavingStand.findMany({ where: { turnId: turn.id, characterId: { in: made.map((c) => c.id) } } });
  assert.equal(again.length, 3);
  assert.equal(again.find((s) => s.characterId === bob.id).locationId, cave.id, "where they stood at the lock, not now");

  // After the lock: everybody stamped at the cave, from any roll in it.
  const after = await cavingResultMembers(prisma, ada2);
  assert.equal(after.merged, true);
  assert.equal(after.locationId, cave.id);
  assert.deepEqual(after.rolls.map((r) => r.id).filter((id) => [ada1.id, ada2.id, cal1.id].includes(id)), [ada1.id, ada2.id]);
  assert.ok(after.bystanderIds.includes(bob.id));
  assert.equal(after.bystanderIds.includes(cal.id), false, "Cal stood somewhere else at the lock");

  const cals = await cavingResultMembers(prisma, cal1);
  assert.deepEqual(cals.rolls.map((r) => r.id), [cal1.id], "Cal's result is his own, at the surface");
});
