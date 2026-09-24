// What a character leaves on a public floor sinks under it after a whole
// in-game day (db/lib/floorSettle.js, CARRY.md §6a). settleFloors decides by
// `settles` and `planSettle`; these pin the rule: the day
// threshold, the rooms that are stashes or otherwise exempt, the things that
// never sink (assets, buildings, corpses, the heavy), and the clutter rule —
// one at a time, never below two things on the floor.
const test = require("node:test");
const assert = require("node:assert/strict");
const { settles, canSink, planSettle, SETTLE_AFTER_DAYS, MIN_VISIBLE_TO_SINK, HEAVY_LBS } = require("../lib/floorSettle");

const row = (over = {}) => ({ quantity: 2, floorDay: 5, expiresTurn: null, ...over });
const publicRoom = (over = {}) => ({ accessTagSlugs: [], destroysContents: false, stable: false, ...over });
const tag = (over = {}) => ({ category: "Items", corpseKind: null, corpseOfCharacterId: null, placement: null, weightLbs: 1, ...over });

test("left on day 5: still there when day 6 opens, gone when day 7 does", () => {
  assert.equal(SETTLE_AFTER_DAYS, 2);
  assert.equal(settles(row(), publicRoom(), tag(), 5), false);
  assert.equal(settles(row(), publicRoom(), tag(), 6), false);
  assert.equal(settles(row(), publicRoom(), tag(), 7), true);
  assert.equal(settles(row(), publicRoom(), tag(), 9), true);
});

test("a keyed room is a stash, and keeps what is left in it", () => {
  assert.equal(settles(row(), publicRoom({ accessTagSlugs: ["inn-key"] }), tag(), 7), false);
});

test("the Spillway and a Stable never sink anything", () => {
  assert.equal(settles(row(), publicRoom({ destroysContents: true }), tag(), 7), false);
  assert.equal(settles(row(), publicRoom({ stable: true }), tag(), 7), false);
});

test("a corpse stays where burial and the smell can find it, a person's or a beast's", () => {
  assert.equal(settles(row(), publicRoom(), tag({ corpseOfCharacterId: "c1", corpseKind: "CHARACTER" }), 7), false);
  assert.equal(canSink(tag({ corpseKind: "CREATURE" })), false);
});

test("only loose objects sink: never an asset, a building, or something too heavy to miss", () => {
  assert.equal(canSink(tag()), true);
  assert.equal(canSink(tag({ weightLbs: null })), true);
  // The catalog stores the display name; an old minter's slug spelling still counts.
  assert.equal(canSink(tag({ category: "items" })), true);
  // An arelitz, a dog, a cart: the Assets category, however it is spelled.
  assert.equal(canSink(tag({ category: "Assets" })), false);
  assert.equal(canSink(tag({ category: "assets" })), false);
  // A building is a placement tag, wherever it is filed.
  assert.equal(canSink(tag({ category: "Assets", placement: { kind: "structure" } })), false);
  assert.equal(canSink(tag({ placement: { kind: "structure" } })), false);
  assert.equal(HEAVY_LBS, 40);
  assert.equal(canSink(tag({ weightLbs: 39 })), true);
  assert.equal(canSink(tag({ weightLbs: 40 })), false);
  // Anything not an object at all.
  for (const category of ["General", "Health", "Status", "Skills"]) assert.equal(canSink(tag({ category })), false);
  assert.equal(settles(row(), publicRoom(), tag({ category: "Assets" }), 7), false);
});

test("clutter: one at a time, oldest first, never below two things on the floor", () => {
  assert.equal(MIN_VISIBLE_TO_SINK, 3);
  const r = (id, floorDay) => ({ id, floorDay });
  // Two on the floor: nothing sinks, however old.
  assert.deepEqual(planSettle(2, [r("a", 1), r("b", 1)]), []);
  // Three on the floor, all ready: the oldest goes, two stay.
  assert.deepEqual(planSettle(3, [r("b", 4), r("a", 2), r("c", 3)]).map((x) => x.id), ["a"]);
  // Six on the floor (two of them things that never sink), three ready: all three go, three stay.
  assert.deepEqual(planSettle(6, [r("c", 3), r("a", 1), r("b", 2)]).map((x) => x.id), ["a", "b", "c"]);
  // Five on the floor, four ready: three go, down to two.
  assert.deepEqual(planSettle(5, [r("a", 1), r("b", 1), r("c", 2), r("d", 3)]).map((x) => x.id), ["a", "b", "c"]);
});

test("a stack on an expiry clock rots in view instead of sinking", () => {
  assert.equal(settles(row({ expiresTurn: 40 }), publicRoom(), tag(), 7), false);
});

test("nothing a seed, a GM or a system pass put down ever sinks", () => {
  assert.equal(settles(row({ floorDay: null }), publicRoom(), tag(), 99), false);
});

test("an empty floor has nothing to sink", () => {
  assert.equal(settles(row({ quantity: 0 }), publicRoom(), tag(), 7), false);
});
