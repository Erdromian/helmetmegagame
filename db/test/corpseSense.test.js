// node --test over db/lib/corpseSense.js#corpseSenseLine — the four things a
// nose can say. Pure, so none of this needs a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { corpseSenseLine, CORPSE_SENSE_HOPS, CORPSE_SENSE_INTERVAL_MS } = require("../lib/corpseSense");

test("a body in a room you can get into is named", () => {
  assert.equal(
    corpseSenseLine({ here: { roomName: "the Cellar" } }),
    "You smell a corpse in the Cellar.",
  );
});

test("a body behind a door you have no key to is not", () => {
  assert.equal(
    corpseSenseLine({ here: { hidden: true } }),
    "You smell a corpse nearby, but you don't know where.",
  );
});

test("a body further off names YOUR OWN neighbour, never its Location", () => {
  assert.equal(
    corpseSenseLine({ viaName: "the Gate" }),
    "You smell a corpse in the direction of the Gate.",
  );
});

test("a way that runs through a hidden link gives no direction at all", () => {
  // soundRange returns viaName null across a hidden edge, and naming it would
  // punch a hole in the thing that makes the edge hidden.
  assert.equal(corpseSenseLine({ viaName: null }), "You smell a corpse somewhere nearby.");
  assert.equal(corpseSenseLine({}), "You smell a corpse somewhere nearby.");
});

test("the two numbers are the ones the doc promises", () => {
  assert.equal(CORPSE_SENSE_HOPS, 7);
  assert.equal(CORPSE_SENSE_INTERVAL_MS, 20 * 60_000);
});
