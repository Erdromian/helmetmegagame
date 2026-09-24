// What a character leaves on a public floor sinks under it after a whole
// in-game day (db/lib/floorSettle.js, CARRY.md §6a). The SQL in settleFloors
// says what `settles` says; these pin the rule: the day threshold, the rooms
// that are stashes or otherwise exempt, and the stacks that never sink.
const test = require("node:test");
const assert = require("node:assert/strict");
const { settles, SETTLE_AFTER_DAYS } = require("../lib/floorSettle");

const row = (over = {}) => ({ quantity: 2, floorDay: 5, expiresTurn: null, ...over });
const publicRoom = (over = {}) => ({ accessTagSlugs: [], destroysContents: false, stable: false, ...over });
const tag = (over = {}) => ({ corpseOfCharacterId: null, ...over });

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

test("a corpse stays where burial and the smell can find it", () => {
  assert.equal(settles(row(), publicRoom(), tag({ corpseOfCharacterId: "c1" }), 7), false);
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
