// The per-turn fog of war (db/lib/vantages.js) — what stays lit, and what a
// reader must treat as dark. Run with `npm test --workspace=db`.
//
// ONE STEP is the whole point of this file. A light stays on only while the
// place is still directly next door to where the character stands: walk on
// past it and it goes out. The two snapshot columns are how that is read
// cheaply — a row carries the turn it was lit in and the place the character
// stood in when it was last confirmed next door, and every read filters on
// both, so a prune that never ran leaves rows that are already invisible
// rather than a leak. These tests pin that, plus the rule that standing
// somewhere is never a row, and the rule that a zone boundary is just another
// step.
const test = require("node:test");
const assert = require("node:assert/strict");
const { lightVantage, pruneVantages, vantagesFor, allVantages, expireVantages } = require("../lib/vantages");

// A stand-in for the two tables these functions touch. Small enough to read,
// and it enforces the unique([characterId, locationId]) the schema declares —
// which is what makes the upsert in lightVantage meaningful.
function fakePrisma({ openTurnId = "turn-2", rows = [] } = {}) {
  const store = rows.map((r) => ({ ...r }));
  const match = (row, where) => {
    if (!where) return true;
    if (where.characterId) {
      const c = where.characterId;
      if (typeof c === "string" && row.characterId !== c) return false;
      if (c?.in && !c.in.includes(row.characterId)) return false;
    }
    if (where.locationId) {
      const l = where.locationId;
      if (typeof l === "string" && row.locationId !== l) return false;
      if (l?.in && !l.in.includes(row.locationId)) return false;
      if (l?.notIn && l.notIn.includes(row.locationId)) return false;
    }
    if (where.anchorLocationId && row.anchorLocationId !== where.anchorLocationId) return false;
    if (typeof where.turnId === "string" && row.turnId !== where.turnId) return false;
    if (where.turnId?.not !== undefined && row.turnId === where.turnId.not) return false;
    return true;
  };
  const dress = (row) => ({
    ...row,
    location: {
      id: row.locationId,
      name: row.locationId,
      zoneId: row.zoneId ?? "town",
      discordChannelId: `ch-${row.locationId}`,
      zone: { id: row.zoneId ?? "town", name: row.zoneId ?? "town" },
    },
    character: { id: row.characterId, discordUserId: `u-${row.characterId}`, discordMirrored: true, status: "ALIVE" },
  });
  return {
    store,
    turn: { findFirst: async () => (openTurnId ? { id: openTurnId } : null) },
    vantage: {
      findMany: async ({ where } = {}) => store.filter((r) => match(r, where)).map(dress),
      deleteMany: async ({ where } = {}) => {
        const keep = store.filter((r) => !match(r, where));
        const removed = store.length - keep.length;
        store.length = 0;
        store.push(...keep);
        return { count: removed };
      },
      updateMany: async ({ where, data } = {}) => {
        let count = 0;
        for (const row of store) {
          if (!match(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      upsert: async ({ where, create, update }) => {
        const key = where.characterId_locationId;
        const found = store.find((r) => r.characterId === key.characterId && r.locationId === key.locationId);
        if (found) {
          Object.assign(found, update);
          return dress(found);
        }
        const row = { id: `v${store.length + 1}`, ...create };
        store.push(row);
        return dress(row);
      },
    },
  };
}

// Where Ada stands is what a read is measured against now, not which zone she is in.
const ADA = { id: "ada", locationId: "gate" };

test("walking out of a street lights it, under the open turn and anchored where she now stands", async () => {
  const prisma = fakePrisma();
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "market",
    toLocationId: "gate",
    anchorLocationId: "gate",
    turnId: "turn-2",
  });
  assert.deepEqual(
    prisma.store.map((r) => [r.locationId, r.anchorLocationId, r.turnId]),
    [["market", "gate", "turn-2"]],
  );
});

test("standing somewhere is never a row — arriving clears any light on the destination", async () => {
  const prisma = fakePrisma({
    rows: [{ id: "v1", characterId: "ada", locationId: "gate", anchorLocationId: "market", turnId: "turn-2" }],
  });
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "market",
    toLocationId: "gate",
    anchorLocationId: "gate",
    turnId: "turn-2",
  });
  assert.deepEqual(prisma.store.map((r) => r.locationId), ["market"], "walking back into a watched street makes it Here again");
});

test("without an open turn nothing is lit — a row with no turn could never be expired", async () => {
  const prisma = fakePrisma();
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "market",
    toLocationId: "gate",
    anchorLocationId: "gate",
    turnId: null,
  });
  assert.equal(prisma.store.length, 0);
});

test("a row lit in an earlier turn reads as dark", async () => {
  const prisma = fakePrisma({
    openTurnId: "turn-2",
    rows: [{ id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-1" }],
  });
  assert.deepEqual(await vantagesFor(prisma, ADA), []);
});

test("a row she has walked on past reads as dark", async () => {
  const prisma = fakePrisma({
    rows: [{ id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-2" }],
  });
  assert.deepEqual(await vantagesFor(prisma, { id: "ada", locationId: "quay" }), [], "two streets on, and the market is gone");
  assert.equal((await vantagesFor(prisma, ADA)).length, 1, "still lit from the gate it was anchored to");
});

test("with no open turn at all, every light reads as out", async () => {
  const prisma = fakePrisma({
    openTurnId: null,
    rows: [{ id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-2" }],
  });
  assert.deepEqual(await vantagesFor(prisma, ADA), []);
});

test("the whole-game read drops a row nobody is next to any more, and skips web-only players", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-2" },
      { id: "v2", characterId: "bo", locationId: "mill", anchorLocationId: "lane", turnId: "turn-2" },
      { id: "v3", characterId: "cy", locationId: "quay", anchorLocationId: "pier", turnId: "turn-2" },
    ],
  });
  const alive = [
    { id: "ada", locationId: "gate", discordUserId: "u1", discordMirrored: true },
    { id: "bo", locationId: "forest", discordUserId: "u2", discordMirrored: true }, // walked on past the lane
    { id: "cy", locationId: "pier", discordUserId: "u3", discordMirrored: false }, // holds no Discord access at all
  ];
  assert.deepEqual((await allVantages(prisma, alive)).map((r) => r.characterId), ["ada"]);
});

test("the prune puts out everything no longer next door and hands it back to be closed", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-2" },
      { id: "v2", characterId: "ada", locationId: "mill", anchorLocationId: "gate", turnId: "turn-2" },
      { id: "v3", characterId: "bo", locationId: "quay", anchorLocationId: "gate", turnId: "turn-2" },
    ],
  });
  // Ada walks gate -> lane. The lane touches the mill but not the market.
  const dropped = await pruneVantages(prisma, "ada", { anchorLocationId: "lane", keepLocationIds: ["gate", "mill"] });
  assert.deepEqual(dropped.map((r) => r.location.discordChannelId), ["ch-market"]);
  assert.deepEqual(prisma.store.map((r) => r.locationId).sort(), ["mill", "quay"], "nobody else's lights go out");
});

test("a survivor is re-anchored to where she now stands, so the next step measures from there", async () => {
  const prisma = fakePrisma({
    rows: [{ id: "v1", characterId: "ada", locationId: "mill", anchorLocationId: "gate", turnId: "turn-2" }],
  });
  await pruneVantages(prisma, "ada", { anchorLocationId: "lane", keepLocationIds: ["mill"] });
  assert.equal(prisma.store[0].anchorLocationId, "lane");
  assert.equal((await vantagesFor(prisma, { id: "ada", locationId: "lane" })).length, 1);
});

test("the place she has just arrived in is never kept, even if the graph calls it its own neighbour", async () => {
  const prisma = fakePrisma({
    rows: [{ id: "v1", characterId: "ada", locationId: "lane", anchorLocationId: "gate", turnId: "turn-2" }],
  });
  await pruneVantages(prisma, "ada", { anchorLocationId: "lane", keepLocationIds: ["lane", "mill"] });
  assert.deepEqual(prisma.store, [], "here is never a row");
});

test("a teleport lands in the dark — nothing next door was ever walked out of", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-2" },
      { id: "v2", characterId: "ada", locationId: "mill", anchorLocationId: "gate", turnId: "turn-2" },
    ],
  });
  // Carried off to somewhere touching none of it.
  const dropped = await pruneVantages(prisma, "ada", { anchorLocationId: "cell", keepLocationIds: ["corridor"] });
  assert.equal(dropped.length, 2);
  assert.deepEqual(prisma.store, []);
});

test("a zone boundary is just another step — the street behind her stays lit through a gate", async () => {
  // Ada walks Residences (fortress) -> Fortress Gate (town). The zones differ
  // and it makes no difference: one step is one step.
  const prisma = fakePrisma();
  await pruneVantages(prisma, "ada", { anchorLocationId: "fortress-gate", keepLocationIds: ["residences"] });
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "residences",
    toLocationId: "fortress-gate",
    anchorLocationId: "fortress-gate",
    turnId: "turn-2",
  });
  prisma.store[0].zoneId = "fortress";

  const lit = await vantagesFor(prisma, { id: "ada", locationId: "fortress-gate" });
  assert.deepEqual(lit.map((r) => r.locationId), ["residences"]);
  assert.equal(lit[0].location.zone.name, "fortress", "and it is filed under its OWN zone, not the one she is standing in");
});

test("the turn shift keeps what this very push lit and expires the day before", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", anchorLocationId: "gate", turnId: "turn-1" },
      { id: "v2", characterId: "bo", locationId: "mill", anchorLocationId: "lane", turnId: "turn-2" }, // a relocation inside the push
    ],
  });
  const expired = await expireVantages(prisma, { keepTurnId: "turn-2" });
  assert.deepEqual(expired.map((r) => r.characterId), ["ada"]);
  assert.deepEqual(prisma.store.map((r) => r.id), ["v2"]);
});
