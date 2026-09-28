// Starting money rolls within 10% of what the YAML says (db/lib/startingVariance.js):
// a seat's bank balance and purse at creation, the Vault once at Start Game.
// Pure, plus one fake-Prisma run of the stash pour.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startingRange, varyStarting, varyStartingPurse, varyVaultEntries } = require("../lib/startingVariance");
const { seedAuthoredStashes } = require("../lib/roomStashSeed");
const { VAULT_ROOM_SLUG } = require("../lib/bankAccounts");

const low = () => 0;
const high = () => 0.9999999;

test("the range is 10% either side, rounded inward to whole obols", () => {
  assert.deepEqual(startingRange(350), { lo: 315, hi: 385 });
  assert.deepEqual(startingRange(57), { lo: 52, hi: 62 });
  assert.deepEqual(startingRange(10), { lo: 9, hi: 11 });
  assert.deepEqual(startingRange(30), { lo: 27, hi: 33 });
});

test("a figure under 10 cannot move, and 0 stays 0", () => {
  for (const n of [0, 1, 3, 9]) {
    assert.equal(varyStarting(n, low), n);
    assert.equal(varyStarting(n, high), n);
  }
});

test("both ends of the range are reachable and nothing lands outside it", () => {
  assert.equal(varyStarting(350, low), 315);
  assert.equal(varyStarting(350, high), 385);
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = varyStarting(88, rng);
    assert.ok(v >= 80 && v <= 96, `88 rolled ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 17, "every whole obol from 80 to 96 turns up");
});

test("only the purse in a role kit rolls", () => {
  const kit = new Map([["obol", 68], ["foodstuffs", 40], ["dagger", 1]]);
  varyStartingPurse(kit, high);
  assert.deepEqual([...kit], [["obol", 74], ["foodstuffs", 40], ["dagger", 1]]);
  const none = new Map([["dagger", 1]]);
  assert.deepEqual([...varyStartingPurse(none, high)], [["dagger", 1]]);
});

test("only the Vault's visible obols roll; every other room pours what it says", () => {
  const entries = [["obol", 350, 5], ["painting", 1, 0]];
  assert.deepEqual(varyVaultEntries(VAULT_ROOM_SLUG, entries, low), [["obol", 315, 5], ["painting", 1, 0]]);
  assert.deepEqual(varyVaultEntries("undertown-6-3", [["obol", 10, 0]], low), [["obol", 10, 0]]);
});

test("Start Game pours the Vault within range and the Cargo Bay exactly", async () => {
  const written = [];
  const prisma = {
    room: {
      findMany: async () => [
        { id: "v", slug: VAULT_ROOM_SLUG, seededStashSlugs: [], stashSeed: { items: [["obol", 350]] }, destroysContents: false },
        { id: "c", slug: "undertown-6-3", seededStashSlugs: [], stashSeed: { items: [["obol", 10]] }, destroysContents: false },
      ],
      update: (args) => ({ room: args }),
    },
    tag: { findMany: async ({ where }) => where.slug.in.map((slug) => ({ id: `t-${slug}`, slug })) },
    roomTag: { upsert: (args) => { written.push(args); return args; } },
    $transaction: async (ops) => ops,
  };
  await seedAuthoredStashes(prisma, { rng: high });
  const byRoom = Object.fromEntries(written.map((w) => [w.create.roomId, w.create.quantity]));
  assert.deepEqual(byRoom, { v: 385, c: 10 });
});
