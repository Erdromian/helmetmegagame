// db/lib/seatConflicts.js — the tags an antagonist seat clears out of its own
// way (THREATS.md §3): sweep 1's Addictions and Desire locks, and sweep 2's
// `conflictsWith` edges, which go whatever they cost.
const test = require("node:test");
const assert = require("node:assert");
const { resolveSeatConflicts, describeSeatConflicts, blocksSeatDesires } = require("../lib/seatConflicts");

const BELIEFS = "g-beliefs";

// The Thanati Belief and a Judge-shaped seat, plus things a character might
// already be holding.
const TAGS = {
  // No group, no Desires of its own — only conflictsWith edges.
  judge: {
    id: "judge", name: "Judge", pointCost: 0, exclusive: false, groupId: null,
    requiredTagId: null, desireLocks: null, group: null,
    conflictsWith: [{ id: "pacifist" }, { id: "saint" }, { id: "charitable" }, { id: "craven" }, { id: "slow" }],
  },
  saint: {
    id: "saint", name: "Saint", pointCost: 14, exclusive: false, groupId: BELIEFS,
    requiredTagId: "pale", desireLocks: null, group: { slug: "general-beliefs" },
    conflictsWith: [{ id: "judge" }],
  },
  charitable: {
    id: "charitable", name: "Charitable", pointCost: 4, exclusive: false, groupId: "g-pers",
    requiredTagId: null, desireLocks: null, group: { slug: "general-personality" },
    conflictsWith: [{ id: "judge" }],
  },
  // A drawback on the seat's own list, like Hemophobia on the Vampire.
  craven: {
    id: "craven", name: "Craven", pointCost: -2, exclusive: false, groupId: "g-traits",
    requiredTagId: null, desireLocks: null, group: { slug: "general-traits" },
    conflictsWith: [{ id: "judge" }],
  },
  // Buyable perks a seat hands out, and what they clash with.
  literacy: {
    id: "literacy", name: "Literacy", pointCost: 4, exclusive: false, groupId: null,
    requiredTagId: null, desireLocks: null, group: null,
    conflictsWith: [{ id: "slow" }, { id: "calligraphy" }],
  },
  slow: {
    id: "slow", name: "Slow", pointCost: -6, exclusive: false, groupId: "g-traits",
    requiredTagId: null, desireLocks: null, group: { slug: "general-traits" },
    conflictsWith: [{ id: "literacy" }, { id: "judge" }],
  },
  // Made up: a bought tag that clashes with a perk.
  calligraphy: {
    id: "calligraphy", name: "Calligraphy", pointCost: 2, exclusive: false, groupId: "g-traits",
    requiredTagId: null, desireLocks: null, group: { slug: "general-traits" },
    conflictsWith: [{ id: "literacy" }],
  },
  thanati: {
    id: "thanati", name: "Thanati", pointCost: 0, exclusive: true, groupId: BELIEFS,
    requiredTagId: null, desireLocks: null, group: { slug: "general-beliefs" },
    conflictsWith: [{ id: "pacifist" }],
  },
  alcoholic: {
    id: "alcoholic", name: "Alcoholic", pointCost: -4, exclusive: true, groupId: "g-add",
    requiredTagId: null, group: { slug: "general-addictions" }, conflictsWith: [],
    desireLocks: [{ all: true, exceptFamilies: ["alcohol"], slot: "bottom" }],
  },
  pacifist: {
    id: "pacifist", name: "Pacifist", pointCost: 0, exclusive: false, groupId: "g-pers",
    requiredTagId: null, group: { slug: "general-personality" }, conflictsWith: [{ id: "thanati" }],
    desireLocks: [{ families: ["violence", "feud"] }],
  },
  kleptomaniac: {
    id: "kleptomaniac", name: "Kleptomaniac", pointCost: 0, exclusive: false, groupId: "g-pers",
    requiredTagId: null, group: { slug: "general-personality" }, conflictsWith: [],
    desireLocks: [{ families: ["wealth"] }],
  },
  depressed: {
    id: "depressed", name: "Depressed", pointCost: -8, exclusive: false, groupId: "g-pers",
    requiredTagId: null, group: { slug: "general-personality" }, conflictsWith: [],
    desireLocks: [{ all: true }],
  },
};

// What the Thanati Belief opens: one plain cult goal and one violent one.
const THANATI_DESIRES = [
  { families: ["thanati"], tier: 3 },
  { families: ["thanati", "violence"], tier: 4 },
];

function fakeTx(heldSlugs, templates = THANATI_DESIRES) {
  const calls = { deleted: null, increment: null };
  return {
    calls,
    characterTag: {
      findMany: async () => heldSlugs.map((s) => ({ tagId: s, quantity: 1, tag: TAGS[s] })),
      deleteMany: async ({ where }) => { calls.deleted = [...where.tagId.in].sort(); },
    },
    desireTemplate: { findMany: async () => templates },
    character: { update: async ({ data }) => { calls.increment = data.tagPoints.increment; } },
  };
}

test("the seat strips every Addiction and only the Personality tags in its way", async () => {
  const tx = fakeTx(["thanati", "alcoholic", "pacifist", "kleptomaniac", "depressed"]);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.deepEqual(out.stripped.map((s) => s.name).sort(), ["Alcoholic", "Depressed", "Pacifist"]);
  // Kleptomaniac locks `wealth`, which no Thanati Desire is in — it survives.
  assert.deepEqual(tx.calls.deleted, ["alcoholic", "depressed", "pacifist"]);
});

test("the drawback's points go back with it, and the balance may go negative", async () => {
  const tx = fakeTx(["thanati", "alcoholic", "depressed"]);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.equal(out.clawedBack, 12);          // 4 for Alcoholic, 8 for Depressed
  assert.equal(out.points, -12);
  assert.equal(tx.calls.increment, -12);     // no floor at zero, on purpose
});

test("a tag both sweeps name is reported once", async () => {
  // Pacifist is a conflictsWith edge on the seat tag AND a `violence` lock.
  const tx = fakeTx(["thanati", "pacifist"]);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.deepEqual(out.stripped, [{ name: "Pacifist", points: 0 }]);
  assert.deepEqual(out.removed, []);
});

test("a seat that opens no Desires still strips Addictions", async () => {
  const tx = fakeTx(["thanati", "alcoholic", "pacifist"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.deepEqual(out.stripped.map((s) => s.name), ["Alcoholic"]);
  // With no seat Desires to block, Pacifist falls through to sweep 2 — and
  // still goes, as a conflictsWith edge.
  assert.deepEqual(out.removed, [{ name: "Pacifist", points: 0 }]);
  assert.deepEqual(tx.calls.deleted, ["alcoholic", "pacifist"]);
});

test("every conflictsWith edge goes, and what it cost comes back", async () => {
  const tx = fakeTx(["judge", "pacifist", "saint", "charitable", "kleptomaniac"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["judge"]);

  assert.deepEqual(tx.calls.deleted, ["charitable", "pacifist", "saint"]);
  assert.deepEqual(out.refunded, [{ name: "Saint", points: 14 }, { name: "Charitable", points: 4 }]);
  assert.deepEqual(out.removed, [{ name: "Pacifist", points: 0 }]);
  assert.equal(tx.calls.increment, 18);
  assert.equal(
    describeSeatConflicts(out),
    "Refunded, since the seat forbids them: Saint (+14), Charitable (+4). Dropped: Pacifist.",
  );
});

test("a conflicting drawback goes too, and its points go back with it", async () => {
  const tx = fakeTx(["judge", "craven"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["judge"]);

  assert.deepEqual(tx.calls.deleted, ["craven"]);
  assert.deepEqual(out.stripped, [{ name: "Craven", points: -2 }]);
  assert.equal(out.clawedBack, 2);
  assert.equal(tx.calls.increment, -2);
});

test("a perk the seat hands out keeps the drawbacks it clashes with", async () => {
  // Literacy is a perk, not the seat: Slow stays, and the DM says so.
  const tx = fakeTx(["thanati", "literacy", "slow"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"], ["literacy"]);

  assert.equal(tx.calls.deleted, null);
  assert.deepEqual(out.kept, [{ name: "Slow", points: -6 }]);
  assert.equal(tx.calls.increment, null);
  assert.equal(describeSeatConflicts(out), "Kept, drawbacks and all: Slow.");
});

test("a perk still refunds a bought tag it clashes with", async () => {
  const tx = fakeTx(["thanati", "literacy", "calligraphy"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"], ["literacy"]);

  assert.deepEqual(tx.calls.deleted, ["calligraphy"]);
  assert.deepEqual(out.refunded, [{ name: "Calligraphy", points: 2 }]);
});

test("when the seat and a perk both clash with a tag, the seat decides", async () => {
  // Slow is on the Judge's own list here as well as Literacy's.
  const tx = fakeTx(["judge", "literacy", "slow"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["judge"], ["literacy"]);

  assert.deepEqual(tx.calls.deleted, ["slow"]);
  assert.deepEqual(out.stripped, [{ name: "Slow", points: -6 }]);
  assert.deepEqual(out.kept, []);
  assert.equal(out.clawedBack, 6);
});

test("blocksSeatDesires ignores a tag that locks nothing", () => {
  assert.equal(blocksSeatDesires(TAGS.thanati, THANATI_DESIRES), false);
  assert.equal(blocksSeatDesires(TAGS.kleptomaniac, THANATI_DESIRES), false);
  assert.equal(blocksSeatDesires(TAGS.pacifist, THANATI_DESIRES), true);
});

test("the DM names what went and what it cost", () => {
  const line = describeSeatConflicts({
    refunded: [], removed: [],
    stripped: [{ name: "Alcoholic", points: -4 }, { name: "Pacifist", points: 0 }],
    clawedBack: 4,
  });
  assert.equal(
    line,
    "Your role conflicted with Alcoholic and Pacifist, so 4 tag points have been taken back with them.",
  );
});

test("nothing stripped costs nothing, and says no number", () => {
  const line = describeSeatConflicts({
    refunded: [], removed: [],
    stripped: [{ name: "Pacifist", points: 0 }], clawedBack: 0,
  });
  assert.equal(line, "Your role conflicted with Pacifist.");
  assert.equal(describeSeatConflicts({ refunded: [], removed: [] }), null);
});
