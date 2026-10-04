// Nothing but its own door puts a player aboard the Charon, on the ground or in
// orbit, and nothing but its own door takes one off (db/lib/offRoad.js,
// CHARON.md §2). Players stepped straight into orbit with a Stepstone; a first
// placement, Xom's lonely teleport and the Rite of Summoning could all do the
// same. Each is pinned here at both ends.
//
// The DB-backed half runs against a real Postgres and skips unless
// DATABASE_URL is a local one (db/lib/localDatabase.js). It makes its own
// characters and deletes them after.
process.env.LOCAL_MODE = "true";

// Pinned before anything loads riteEffects: it destructures roomLine at require
// time, and the room line is the archive's business, not this test's.
require("../lib/placeLine").roomLine = async () => {};

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");
const { isArrivable, isOffRoad, offRoadLocationIds } = require("../lib/offRoad");
const { stepstone, stepstoneTargets } = require("../lib/verbs/self");
const { performLocationMove } = require("../lib/locationTravel");
const { pickCompany } = require("../lib/xomPass");
const { resolveIngredients } = require("../lib/riteIngredients");
const { ROOM_SELECT } = require("../lib/riteChant");
const { riteByKey } = require("../lib/rites");
const { EFFECTS } = require("../lib/riteEffects");
const { CHARON_SLUG, CHARON_SPACE_SLUG, COCKPIT_SLUG } = require("../lib/charonPlaces");
const { GATE_MESSAGES } = require("../lib/turnGate");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

// ---------------------------------------------------------------- no database

test("the summoning effect pulls nobody off a place with no road", async () => {
  const ship = "loc-ship";
  let writes = 0;
  const db = {
    tag: { findMany: async () => [] },
    character: {
      findMany: async () => [
        { id: "aboard", name: "Aboard", locationId: ship, location: { slug: CHARON_SPACE_SLUG } },
        { id: "here", name: "Here", locationId: "loc-room", location: { slug: "town-9" } },
      ],
    },
    location: { findMany: async () => [{ id: ship }] },
    $transaction: async () => {
      writes += 1;
    },
  };
  const { result } = await EFFECTS.summoning({
    db,
    room: { id: "room", name: "Room", locationId: "loc-room" },
    location: { id: "loc-room", zoneId: "z" },
  });
  assert.deepEqual(result.summoned, []);
  assert.equal(writes, 0, "nobody standing aboard the ship may be moved");
});

// ---------------------------------------------------------------- the database

test("no raw relocation reaches the Charon or leaves it", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const bySlug = async (slug) => prisma.location.findUnique({ where: { slug }, include: { zone: true } });
  const [ground, orbit, square] = await Promise.all([bySlug(CHARON_SLUG), bySlug(CHARON_SPACE_SLUG), bySlug("town-1")]);
  const stoneTag = await prisma.tag.findUnique({ where: { slug: "stepstone" } });
  if (!ground || !orbit || !square || !stoneTag) {
    await prisma.$disconnect();
    return t.skip("the local database has no Charon, no town-1 or no Stepstone tag — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const made = [];
  t.after(async () => {
    const ids = made.map((c) => c.id);
    await prisma.auditLog.deleteMany({ where: { targetCharacterId: { in: ids } } }).catch(() => {});
    await prisma.characterTag.deleteMany({ where: { characterId: { in: ids } } });
    await prisma.character.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function person(key, place, { stone = false } = {}) {
    const row = await prisma.character.create({
      data: {
        discordUserId: `charon-sealed-${run}-${key}`,
        firstName: "Sealed",
        lastName: key,
        name: `Sealed ${key} ${run}`,
        status: "ALIVE",
        zoneId: place?.zoneId ?? null,
        locationId: place?.id ?? null,
      },
    });
    made.push(row);
    if (stone) {
      await prisma.characterTag.create({ data: { characterId: row.id, tagId: stoneTag.id, source: "GM_GRANT", quantity: 1 } });
    }
    return prisma.character.findUnique({ where: { id: row.id }, include: { tags: { include: { tag: true } } } });
  }

  await t.test("the road test itself", async () => {
    assert.equal(await isOffRoad(prisma, ground.id), true);
    assert.equal(await isOffRoad(prisma, orbit.id), true);
    assert.equal(await isOffRoad(prisma, square.id), false);
    assert.equal(await isOffRoad(prisma, null), false, "unplaced has nothing to leave");
    assert.equal(await isArrivable(prisma, ground.id), false);
    assert.equal(await isArrivable(prisma, orbit.id), false);
    assert.equal(await isArrivable(prisma, square.id), true);
    const offRoad = await offRoadLocationIds(prisma);
    assert.equal(offRoad.has(ground.id) && offRoad.has(orbit.id) && !offRoad.has(square.id), true);
  });

  await t.test("the Stepstone will not carry you onto either Charon", async () => {
    const walker = await person("walker", square, { stone: true });
    const targets = await stepstoneTargets(prisma, walker);
    assert.ok(targets.length > 0, "the stone still goes somewhere");
    assert.equal(targets.some((l) => l.id === ground.id || l.id === orbit.id), false, "the picker offers neither ship");

    for (const ship of [orbit, ground]) {
      const result = await stepstone(prisma, { character: walker, discordUserId: walker.discordUserId, locationId: ship.id, openTurn: null });
      assert.deepEqual(result, { ok: false, error: "The stone will not carry you there." });
    }
    const after = await prisma.character.findUnique({ where: { id: walker.id }, include: { tags: true } });
    assert.equal(after.locationId, square.id);
    assert.equal(after.tags.find((ct) => ct.tagId === stoneTag.id)?.quantity, 1, "a refused step keeps the stone");
  });

  await t.test("the Stepstone will not carry you off the ship in orbit", async () => {
    const flyer = await person("orbit", orbit, { stone: true });
    assert.deepEqual(await stepstoneTargets(prisma, flyer), []);
    const result = await stepstone(prisma, { character: flyer, discordUserId: flyer.discordUserId, locationId: square.id, openTurn: null });
    assert.deepEqual(result, { ok: false, error: "The stone will not carry you from here." });
    assert.equal((await prisma.character.findUnique({ where: { id: flyer.id } })).locationId, orbit.id);
  });

  await t.test("the Stepstone still works between two ordinary places", async () => {
    const other = (await prisma.location.findFirst({
      where: { slug: "town-2", retiredAt: null },
      include: { zone: true },
    }));
    if (!other) return;
    const walker = await person("control", square, { stone: true });
    const result = await stepstone(prisma, { character: walker, discordUserId: walker.discordUserId, locationId: other.id, openTurn: null });
    assert.equal(result.ok, true, result.error);
    assert.equal((await prisma.character.findUnique({ where: { id: walker.id } })).locationId, other.id);
  });

  await t.test("a first placement cannot be onto either Charon", async (tt) => {
    const nowhere = await person("unplaced", null);
    for (const ship of [orbit, ground]) {
      const result = await performLocationMove(prisma, nowhere, ship);
      if (result.reason === GATE_MESSAGES.NOT_IN_SESSION) return tt.skip("the local game is between sittings");
      assert.deepEqual(result, { ok: false, reason: "You can't get there directly from here." });
    }
    assert.equal((await prisma.character.findUnique({ where: { id: nowhere.id } })).locationId, null);
  });

  await t.test("Xom never sends the lonely to somebody aboard", async () => {
    const lonely = await person("lonely", square);
    await person("aboard", orbit);
    await person("docked", ground);
    const candidates = await prisma.character.count({ where: { status: "ALIVE", locationId: { not: null }, id: { not: lonely.id } } });
    // Every index the rng could land on, so a single draw of the ship would show.
    for (let i = 0; i < candidates; i += 1) {
      const pick = await pickCompany(prisma, lonely.id, () => (i + 0.5) / candidates);
      if (!pick) break;
      assert.notEqual(pick.locationId, orbit.id);
      assert.notEqual(pick.locationId, ground.id);
      assert.ok(pick.zoneId, "the zone travels with the location");
    }
  });

  await t.test("a Summoning worked aboard the ship never fires", async () => {
    const summoning = riteByKey("summoning");
    const cockpit = await prisma.room.findUnique({ where: { slug: COCKPIT_SLUG }, select: ROOM_SELECT });
    const ashore = await prisma.room.findFirst({ where: { locationId: square.id, retiredAt: null }, select: ROOM_SELECT });
    assert.ok(cockpit);
    assert.ok((await resolveIngredients(prisma, summoning, cockpit)).missing.includes("place"));
    if (ashore) assert.equal((await resolveIngredients(prisma, summoning, ashore)).missing.includes("place"), false);
    // Only Summoning asks.
    assert.equal((await resolveIngredients(prisma, riteByKey("rage"), cockpit)).missing.includes("place"), false);
  });
});
