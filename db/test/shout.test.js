// node --test over db/lib/shout.js#shoutParts — the distance ladder.
const test = require("node:test");
const assert = require("node:assert/strict");
const { shoutParts } = require("../lib/shout");

test("your own Location hears the words whole", () => {
  assert.equal(shoutParts("Run!", 0, null).text, "You hear someone shout: » Run!");
});

test("one hop away hears the words clear, with the direction", () => {
  assert.equal(shoutParts("Run!", 1, "the Gate").text, "You hear someone shout from the direction of the Gate: » Run!");
});

test("two hops away hears static of the same length", () => {
  const { text } = shoutParts("Run now", 2, "the Gate");
  assert.match(text, /^You hear someone shout from the direction of the Gate: » .{7}$/);
});

test("three hops away hears only that someone shouted, and which way", () => {
  assert.equal(shoutParts("Run!", 3, "the Gate").text, "You hear someone shout from the direction of the Gate.");
  assert.equal(shoutParts("Run!", 3, null).text, "You hear someone shout somewhere nearby.");
});

// The place gate the three moment-to-moment verbs share (db/lib/placeKey.js).
// Both faces ask this one question, so a drift between them fails here first.
const { isScenePlaceKey } = require("../lib/placeKey");

test("a room and a conversation are scenes", () => {
  assert.equal(isScenePlaceKey("room:abc"), true);
  assert.equal(isScenePlaceKey("conv:abc"), true);
});

test("the street and the zone summary are not", () => {
  assert.equal(isScenePlaceKey("loc:abc"), false);
  assert.equal(isScenePlaceKey("zone:abc"), false);
});

test("a missing or malformed key is not a scene", () => {
  for (const key of [null, undefined, "", "room:", ":abc", "nonsense", 7]) {
    assert.equal(isScenePlaceKey(key), false);
  }
});
