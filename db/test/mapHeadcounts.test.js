// The numbers /map draws beside a crosshair (db/lib/mapHeadcounts.js). Run
// with `npm test --workspace=db`.
//
// Two things are pinned here. WHICH places get a number: where you stand and
// the lit streets in your own zone, and nowhere else — a number anywhere else
// would be a live look at a street the character is not watching. And WHAT
// the number is: the living, the looker included, with an empty street
// reading 0 rather than going missing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { headcountLocationIds, mapHeadcounts } = require("../lib/mapHeadcounts");

const vantage = (locationId, zoneId) => ({ locationId, location: { id: locationId, zoneId } });

// The three tables mapHeadcounts reads. `vantages` are rows already valid for
// the open turn; the fake still applies the anchor filter vantagesFor sends.
function fakePrisma({ locations = [], vantages = [], characters = [], openTurnId = "turn-1" } = {}) {
  return {
    turn: { findFirst: async () => (openTurnId ? { id: openTurnId } : null) },
    location: { findUnique: async ({ where }) => locations.find((l) => l.id === where.id) ?? null },
    vantage: {
      findMany: async ({ where }) =>
        vantages
          .filter((v) => v.characterId === where.characterId && v.anchorLocationId === where.anchorLocationId)
          .map((v) => ({ ...v, location: locations.find((l) => l.id === v.locationId) })),
    },
    character: {
      groupBy: async ({ where }) => {
        const tally = new Map();
        for (const c of characters) {
          if (c.status !== where.status || !where.locationId.in.includes(c.locationId)) continue;
          tally.set(c.locationId, (tally.get(c.locationId) ?? 0) + 1);
        }
        return [...tally].map(([locationId, n]) => ({ locationId, _count: { _all: n } }));
      },
    },
  };
}

test("here comes first, then the lit streets in the same zone", () => {
  const ids = headcountLocationIds({ id: "square", zoneId: "town" }, [vantage("inn", "town"), vantage("alley", "town")]);
  assert.deepEqual(ids, ["square", "inn", "alley"]);
});

test("a lit street across a zone boundary gets no number", () => {
  const ids = headcountLocationIds({ id: "square", zoneId: "town" }, [vantage("bridge", "fortress"), vantage("inn", "town")]);
  assert.deepEqual(ids, ["square", "inn"]);
});

test("standing nowhere names nowhere", () => {
  assert.deepEqual(headcountLocationIds(null, [vantage("inn", "town")]), []);
});

test("a row for where they stand is not counted twice", () => {
  const ids = headcountLocationIds({ id: "square", zoneId: "town" }, [vantage("square", "town")]);
  assert.deepEqual(ids, ["square"]);
});

test("counts the living at each watched place, the looker included", async () => {
  const prisma = fakePrisma({
    locations: [
      { id: "square", zoneId: "town" },
      { id: "inn", zoneId: "town" },
      { id: "keep", zoneId: "fortress" },
    ],
    vantages: [{ characterId: "me", locationId: "inn", anchorLocationId: "square" }],
    characters: [
      { id: "me", locationId: "square", status: "ALIVE" },
      { id: "a", locationId: "square", status: "ALIVE" },
      { id: "b", locationId: "inn", status: "ALIVE" },
      { id: "c", locationId: "inn", status: "ALIVE" },
      { id: "corpse", locationId: "inn", status: "DEAD" },
      { id: "far", locationId: "keep", status: "ALIVE" },
    ],
  });
  const counts = await mapHeadcounts(prisma, { id: "me", locationId: "square" });
  assert.deepEqual([...counts], [["square", 2], ["inn", 2]]);
});

test("an empty watched street reads 0 rather than going missing", async () => {
  const prisma = fakePrisma({
    locations: [
      { id: "square", zoneId: "town" },
      { id: "inn", zoneId: "town" },
    ],
    vantages: [{ characterId: "me", locationId: "inn", anchorLocationId: "square" }],
    characters: [{ id: "me", locationId: "square", status: "ALIVE" }],
  });
  const counts = await mapHeadcounts(prisma, { id: "me", locationId: "square" });
  assert.equal(counts.get("inn"), 0);
});

test("a light anchored to a place they have walked on from is dark", async () => {
  const prisma = fakePrisma({
    locations: [
      { id: "square", zoneId: "town" },
      { id: "inn", zoneId: "town" },
    ],
    vantages: [{ characterId: "me", locationId: "inn", anchorLocationId: "alley" }],
    characters: [{ id: "b", locationId: "inn", status: "ALIVE" }],
  });
  const counts = await mapHeadcounts(prisma, { id: "me", locationId: "square" });
  assert.deepEqual([...counts.keys()], ["square"]);
});

test("with no turn open nothing is lit, and here still counts", async () => {
  const prisma = fakePrisma({
    openTurnId: null,
    locations: [{ id: "square", zoneId: "town" }],
    vantages: [{ characterId: "me", locationId: "inn", anchorLocationId: "square" }],
    characters: [{ id: "me", locationId: "square", status: "ALIVE" }],
  });
  const counts = await mapHeadcounts(prisma, { id: "me", locationId: "square" });
  assert.deepEqual([...counts], [["square", 1]]);
});

test("a character standing nowhere gets an empty answer", async () => {
  const counts = await mapHeadcounts(fakePrisma(), { id: "me", locationId: null });
  assert.equal(counts.size, 0);
});
