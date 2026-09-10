// Sweep 1 of db/lib/seatConflicts.js — the tags an antagonist seat clears out
// of its own way (THREATS.md §3). Sweep 2's pairwise/exclusive rules are
// covered incidentally here, in the one case where the two sweeps could
// disagree about the same tag.
const test = require("node:test");
const assert = require("node:assert");
const { resolveSeatConflicts, describeSeatConflicts, blocksSeatDesires } = require("../lib/seatConflicts");

const BELIEFS = "g-beliefs";

// The Thanati Belief, plus four things a character might already be holding.
const TAGS = {
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

test("a tag both sweeps name is stripped, never reported as kept", async () => {
  // Pacifist is a conflictsWith edge on the seat tag AND a `violence` lock.
  // Sweep 2 alone would grandfather it (cost 0); sweep 1 runs first.
  const tx = fakeTx(["thanati", "pacifist"]);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.deepEqual(out.kept, []);
  assert.deepEqual(out.stripped, [{ name: "Pacifist", points: 0 }]);
});

test("a seat that opens no Desires still strips Addictions", async () => {
  const tx = fakeTx(["thanati", "alcoholic", "pacifist"], []);
  const out = await resolveSeatConflicts(tx, "c1", ["thanati"]);

  assert.deepEqual(out.stripped.map((s) => s.name), ["Alcoholic"]);
  // With no seat Desires to block, Pacifist falls through to sweep 2 and is
  // grandfathered the old way.
  assert.deepEqual(out.kept, [{ name: "Pacifist", points: 0 }]);
});

test("blocksSeatDesires ignores a tag that locks nothing", () => {
  assert.equal(blocksSeatDesires(TAGS.thanati, THANATI_DESIRES), false);
  assert.equal(blocksSeatDesires(TAGS.kleptomaniac, THANATI_DESIRES), false);
  assert.equal(blocksSeatDesires(TAGS.pacifist, THANATI_DESIRES), true);
});

test("the DM names what went and what it cost", () => {
  const line = describeSeatConflicts({
    refunded: [], removed: [], kept: [],
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
    refunded: [], removed: [], kept: [],
    stripped: [{ name: "Pacifist", points: 0 }], clawedBack: 0,
  });
  assert.equal(line, "Your role conflicted with Pacifist.");
  assert.equal(describeSeatConflicts({ refunded: [], removed: [], kept: [] }), null);
});
