// db/lib/mountRides.js against an in-memory stand-in for the two tables it
// touches: spending a ride shifts ONE unit of the equipped mount's row onto
// the next rung's row, and the turn pass shifts every ridden rung back —
// creating, merging or retagging as the counts need, equippedQuantity carried
// across. No Prisma: the fake below answers exactly the calls the module makes.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { rideMount, runMountRestPass, shiftCharacterUnits } = require("../lib/mountRides");

// Tags by slug, rows by id. `where` support is only as wide as the module's
// own queries — anything else throws, so a new query shape fails loudly here
// rather than silently matching nothing.
function fakeDb({ tags, characterTags = [], roomTags = [] }) {
  const tagBySlug = new Map(tags.map((slug, i) => [slug, `tag-${i}`]));
  const slugById = new Map([...tagBySlug].map(([slug, id]) => [id, slug]));
  let nextId = 1;
  const ct = characterTags.map((r) => ({ id: `ct-${nextId++}`, source: "GM_GRANT", acquiredAt: new Date("2026-09-20"), expiresTurn: null, equippedQuantity: r.equipped ? 1 : 0, equipped: Boolean(r.equipped), quantity: 1, ...r, tagId: tagBySlug.get(r.slug) }));
  const rt = roomTags.map((r) => ({ id: `rt-${nextId++}`, hiddenQuantity: 0, expiresTurn: null, floorDay: null, quantity: 1, ...r, tagId: tagBySlug.get(r.slug) }));
  const matches = (row, where) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "tag") return v.slug.in.includes(slugById.get(row.tagId));
      if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
      return row[k] === v;
    });
  const tx = {
    tag: {
      findUnique: async ({ where }) => (tagBySlug.has(where.slug) ? { id: tagBySlug.get(where.slug) } : null),
      findMany: async ({ where }) => [...tagBySlug].filter(([slug]) => where.slug.in.includes(slug)).map(([slug, id]) => ({ id, slug })),
    },
    characterTag: {
      findFirst: async ({ where }) => ct.find((r) => matches(r, where)) && { ...ct.find((r) => matches(r, where)), tag: { slug: slugById.get(ct.find((r) => matches(r, where)).tagId) } },
      findUnique: async ({ where }) => {
        const k = where.characterId_tagId;
        return ct.find((r) => r.characterId === k.characterId && r.tagId === k.tagId) ?? null;
      },
      findMany: async ({ where }) => ct.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      update: async ({ where, data }) => Object.assign(ct.find((r) => r.id === where.id), data),
      delete: async ({ where }) => ct.splice(ct.findIndex((r) => r.id === where.id), 1),
      create: async ({ data }) => {
        const row = { id: `ct-${nextId++}`, ...data };
        ct.push(row);
        return row;
      },
    },
    roomTag: {
      findUnique: async ({ where }) => {
        const k = where.roomId_tagId;
        return rt.find((r) => r.roomId === k.roomId && r.tagId === k.tagId) ?? null;
      },
      findMany: async ({ where }) => rt.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      update: async ({ where, data }) => {
        const row = rt.find((r) => r.id === where.id);
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
        return row;
      },
      delete: async ({ where }) => rt.splice(rt.findIndex((r) => r.id === where.id), 1),
    },
    $queryRaw: async () => [{ id: "locked" }],
    $transaction: async (fn) => fn(tx),
  };
  const held = (characterId) => ct.filter((r) => r.characterId === characterId).map((r) => ({ slug: slugById.get(r.tagId), quantity: r.quantity, equippedQuantity: r.equippedQuantity, equipped: r.equipped })).sort((a, b) => a.slug.localeCompare(b.slug));
  const floor = (roomId) => rt.filter((r) => r.roomId === roomId).map((r) => ({ slug: slugById.get(r.tagId), quantity: r.quantity, hiddenQuantity: r.hiddenQuantity })).sort((a, b) => a.slug.localeCompare(b.slug));
  return { tx, held, floor, rows: ct };
}

const LADDER = ["arelitz", "arelitz-ridden-1", "arelitz-tacked", "arelitz-tacked-ridden-1", "arelitz-tacked-ridden-2", "motorcycle", "motorcycle-ridden-1", "cart"];

test("a lone equipped arelitz is retagged in place — same row, one rung down, still equipped", async () => {
  const db = fakeDb({ tags: LADDER, characterTags: [{ characterId: "A", slug: "arelitz", equipped: true }] });
  const before = db.rows[0].id;
  assert.deepEqual(await rideMount(db.tx, "A"), { from: "arelitz", to: "arelitz-ridden-1" });
  assert.deepEqual(db.held("A"), [{ slug: "arelitz-ridden-1", quantity: 1, equippedQuantity: 1, equipped: true }]);
  assert.equal(db.rows[0].id, before);
  // An arelitz has the one ride, so that was the bottom of its ladder.
  assert.equal(await rideMount(db.tx, "A"), null, "a spent mount has no ride to spend");
  assert.deepEqual(db.held("A"), [{ slug: "arelitz-ridden-1", quantity: 1, equippedQuantity: 1, equipped: true }]);
});

test("one out of a stack of three splits off: two fresh in the pack, the ridden one still under you", async () => {
  const db = fakeDb({ tags: LADDER, characterTags: [{ characterId: "A", slug: "arelitz", quantity: 3, equipped: true }] });
  await rideMount(db.tx, "A");
  assert.deepEqual(db.held("A"), [
    { slug: "arelitz", quantity: 2, equippedQuantity: 0, equipped: false },
    { slug: "arelitz-ridden-1", quantity: 1, equippedQuantity: 1, equipped: true },
  ]);
});

test("a ride lands on an existing rung row by merging, never a duplicate (characterId, tagId)", async () => {
  const db = fakeDb({
    tags: LADDER,
    characterTags: [
      { characterId: "A", slug: "arelitz", quantity: 2, equipped: true },
      { characterId: "A", slug: "arelitz-ridden-1", quantity: 1, equipped: false },
    ],
  });
  await rideMount(db.tx, "A");
  assert.deepEqual(db.held("A"), [
    { slug: "arelitz", quantity: 1, equippedQuantity: 0, equipped: false },
    { slug: "arelitz-ridden-1", quantity: 2, equippedQuantity: 1, equipped: true },
  ]);
});

test("a stowed mount and a cart are not ridden; a tacked arelitz walks its own ladder", async () => {
  const stowed = fakeDb({ tags: LADDER, characterTags: [{ characterId: "A", slug: "arelitz", equipped: false }, { characterId: "A", slug: "cart", equipped: true }] });
  assert.equal(await rideMount(stowed.tx, "A"), null);
  const tacked = fakeDb({ tags: LADDER, characterTags: [{ characterId: "A", slug: "arelitz-tacked", equipped: true }] });
  assert.deepEqual(await rideMount(tacked.tx, "A"), { from: "arelitz-tacked", to: "arelitz-tacked-ridden-1" });
  assert.deepEqual(await rideMount(tacked.tx, "A"), { from: "arelitz-tacked-ridden-1", to: "arelitz-tacked-ridden-2" });
  assert.equal(await rideMount(tacked.tx, "A"), null);
});

test("a rung missing from the catalog leaves the mount fresh rather than refusing the crossing", async () => {
  const db = fakeDb({ tags: ["motorcycle"], characterTags: [{ characterId: "A", slug: "motorcycle", equipped: true }] });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await rideMount(db.tx, "A"), null);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(db.held("A"), [{ slug: "motorcycle", quantity: 1, equippedQuantity: 1, equipped: true }]);
});

test("the turn pass rests every rung on every sheet and floor, merging back into the fresh row", async () => {
  const db = fakeDb({
    tags: LADDER,
    characterTags: [
      { characterId: "A", slug: "arelitz", quantity: 1, equipped: false },
      { characterId: "A", slug: "arelitz-ridden-1", quantity: 1, equipped: true },
      { characterId: "B", slug: "arelitz-tacked-ridden-1", quantity: 2, equipped: true },
      { characterId: "C", slug: "motorcycle-ridden-1", quantity: 1, equipped: false },
    ],
    roomTags: [
      { roomId: "stable", slug: "arelitz", quantity: 2 },
      { roomId: "stable", slug: "arelitz-ridden-1", quantity: 3, hiddenQuantity: 1 },
      { roomId: "shed", slug: "motorcycle-ridden-1", quantity: 1 },
    ],
  });
  const result = await runMountRestPass(db.tx);
  assert.deepEqual(result, { rested: 9 });
  // A's ridden one merged INTO the fresh row, and it is the equipped unit.
  assert.deepEqual(db.held("A"), [{ slug: "arelitz", quantity: 2, equippedQuantity: 1, equipped: true }]);
  // B's tacked pair retagged in place.
  assert.deepEqual(db.held("B"), [{ slug: "arelitz-tacked", quantity: 2, equippedQuantity: 1, equipped: true }]);
  assert.deepEqual(db.held("C"), [{ slug: "motorcycle", quantity: 1, equippedQuantity: 0, equipped: false }]);
  // The stable floor: hidden units come along with the visible ones.
  assert.deepEqual(db.floor("stable"), [{ slug: "arelitz", quantity: 5, hiddenQuantity: 1 }]);
  assert.deepEqual(db.floor("shed"), [{ slug: "motorcycle", quantity: 1, hiddenQuantity: 0 }]);
});

test("shiftCharacterUnits never carries more equipped units than it moves", async () => {
  const db = fakeDb({ tags: LADDER, characterTags: [{ characterId: "A", slug: "arelitz", quantity: 2, equipped: true }] });
  const row = db.rows[0];
  await shiftCharacterUnits(db.tx, row, "tag-1", { units: 1, equippedUnits: 5 });
  assert.deepEqual(db.held("A"), [
    { slug: "arelitz", quantity: 1, equippedQuantity: 0, equipped: false },
    { slug: "arelitz-ridden-1", quantity: 1, equippedQuantity: 1, equipped: true },
  ]);
});
