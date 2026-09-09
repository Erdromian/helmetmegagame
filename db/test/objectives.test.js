// node --test over the pure half of db/lib/objectives.js and
// db/lib/objectiveKinds.js — the reveal lines, the deaths-per-day count, the
// kind catalog's shape and the pin's precedence. Run with
// `npm test --workspace=db`. The one Prisma call is faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { formatAntagonistLines, maxDeathsInOneDay, evaluateObjectives, membersByParty } = require("../lib/objectives");
const { OBJECTIVE_KINDS, PARTY_DEFAULTS, kindsForParty, describeObjective, objectiveKind } = require("../lib/objectiveKinds");
const { PARTIES, partyOf, threatBySlug } = require("../lib/threats");

test("solo seats are their own party; the Thanati and the Tribunal share one", () => {
  assert.deepEqual(partyOf(threatBySlug("judge")), { key: "judge", name: "Judge", solo: true });
  assert.deepEqual(partyOf(threatBySlug("thanati-leader")), { key: "thanati", name: "Thanati", solo: false });
  assert.equal(partyOf(threatBySlug("tribune")).key, partyOf(threatBySlug("tribunal-ordinator")).key);
  assert.deepEqual(PARTIES.map((p) => p.key), ["demoness", "judge", "thanati", "tribunal"]);
});

test("every kind is well-formed and the defaults exist", () => {
  for (const k of OBJECTIVE_KINDS) {
    assert.ok(k.key && k.pick && k.label, k.key);
    if (k.script == null && k.startsDone) assert.equal(k.script, null);
    if (k.target === "number") assert.ok(k.defaultValue >= 1);
  }
  for (const keys of Object.values(PARTY_DEFAULTS)) for (const key of keys) assert.ok(objectiveKind(key), key);
  // Solo seats only get custom; the Thanati get theirs plus custom.
  assert.deepEqual(kindsForParty("judge").map((k) => k.key), ["custom"]);
  assert.equal(kindsForParty("thanati").at(-1).key, "custom");
  assert.ok(kindsForParty("tribunal").some((k) => k.key === "detonate-nuke"));
});

test("describeObjective fills the template from snapshots", () => {
  assert.equal(describeObjective({ kind: "kill-character", targetName: "Corvin" }), "Kill Corvin");
  assert.equal(describeObjective({ kind: "mass-deaths", value: 5 }), "Cause 5 deaths in a single day");
  assert.equal(describeObjective({ kind: "blow-up-location", targetLocationName: "The Inn" }), "Blow up The Inn");
  assert.equal(describeObjective({ kind: "custom", text: "Seduce the Baron" }), "Seduce the Baron");
  assert.equal(describeObjective({ kind: "kill-character" }), "Kill somebody");
});

test("deaths are counted per in-game day, two turns to a day", () => {
  const deaths = [
    { turnNumber: 1 }, { turnNumber: 2 }, { turnNumber: 2 }, // day 1: three
    { turnNumber: 3 }, // day 2: one
    { turnNumber: null }, // no day
  ];
  assert.equal(maxDeathsInOneDay(deaths), 3);
  assert.equal(maxDeathsInOneDay([]), 0);
  // The bomb's turn does not count: the blast is the Tribunal's, not the cult's.
  assert.equal(maxDeathsInOneDay(deaths, { excludeTurn: 2 }), 1);
});

test("membersByParty names a leader by the seat that grants the other, leader first", () => {
  const tags = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));
  const members = membersByParty([
    { id: "w", name: "Wren", tags: tags("thanati") },
    { id: "a", name: "Ash", tags: tags("thanati", "thanati-leader") },
    { id: "m", name: "Maeris", tags: tags("demoness") },
    { id: "j", name: "Jorren", tags: tags("judge", "thanati") }, // two parties: listed in both
    { id: "n", name: "Nobody", tags: [] },
  ]);
  assert.deepEqual(members.get("thanati"), [
    { id: "a", name: "Ash", seat: "Thanati Leader" },
    { id: "w", name: "Wren", seat: "Thanati" },
    { id: "j", name: "Jorren", seat: "Thanati" },
  ]);
  assert.deepEqual(members.get("demoness"), [{ id: "m", name: "Maeris", seat: "Demoness" }]);
  assert.deepEqual(members.get("judge"), [{ id: "j", name: "Jorren", seat: "Judge" }]);
  assert.equal(members.has("tribunal"), false);
});

test("the reveal reads in Bascinet's format", () => {
  const lines = formatAntagonistLines([
    { partyKey: "judge", partyName: "Judge", solo: true, members: [{ name: "Ash", seat: "Judge" }], objectives: [] },
    {
      partyKey: "demoness", partyName: "Demoness", solo: true,
      members: [{ name: "Maeris", seat: "Demoness" }],
      objectives: [{ text: "Seduce the Baron.", done: true }, { text: "Did the heir survive?", done: false }],
    },
    {
      partyKey: "thanati", partyName: "Thanati", solo: false,
      members: [{ name: "Ash", seat: "Thanati Leader" }, { name: "Wren", seat: "Thanati" }],
      objectives: [{ text: "Kill Corvin", done: true }],
    },
  ]);
  assert.deepEqual(lines, [
    "Ash was a Judge.",
    "Maeris was a Demoness. Their objectives were: Seduce the Baron. **Success!** / Did the heir survive? **Failed!**",
    "Ash (Thanati Leader), Wren were the Thanati. Their objectives were: Kill Corvin. **Success!**",
  ]);
});

test("the pin beats the script; otherwise the game decides", async () => {
  const fakePrisma = {
    character: { findMany: async () => [{ id: "c1", status: "DEAD" }, { id: "c2", status: "ALIVE" }] },
    // The detonation stamp hangs off the GAME now, not off GameState — a turn
    // number on the global row could not say which game it belonged to.
    gameState: { findUnique: async () => ({ gameId: "g", game: { nukeDetonatedTurn: 7 } }) },
  };
  const rows = [
    { id: "a", kind: "kill-character", targetCharacterId: "c1", pinned: null },
    { id: "b", kind: "kill-character", targetCharacterId: "c2", pinned: null },
    { id: "c", kind: "kill-character", targetCharacterId: "c1", pinned: false },
    { id: "d", kind: "detonate-nuke", pinned: null },
    { id: "e", kind: "mass-deaths", value: 2, pinned: null },
    { id: "g", kind: "mass-deaths", value: 5, pinned: null },
    { id: "f", kind: "celebrate", pinned: true },
  ];
  // Day 2 has two deaths; the eight on turn 7 are the blast and do not count.
  const deaths = [{ turnNumber: 4 }, { turnNumber: 3 }, ...Array.from({ length: 8 }, () => ({ turnNumber: 7 }))];
  const scored = await evaluateObjectives(fakePrisma, rows, { deaths });
  assert.deepEqual(scored.get("a"), { done: true, source: "script" });
  assert.deepEqual(scored.get("b"), { done: false, source: "script" });
  assert.deepEqual(scored.get("c"), { done: false, source: "pinned" });
  assert.deepEqual(scored.get("d"), { done: true, source: "script" });
  assert.deepEqual(scored.get("e"), { done: true, source: "script" });
  assert.deepEqual(scored.get("g"), { done: false, source: "script" });
  assert.deepEqual(scored.get("f"), { done: true, source: "pinned" });
});
