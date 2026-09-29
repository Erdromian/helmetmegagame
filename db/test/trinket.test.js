// Make a Trinket's gate (db/lib/trinket.js): who sees the button, why it greys,
// and which held tags are offered as stones.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSmith,
  trinketRefusalFor,
  trinketCostRefusal,
  inlayStonesOf,
  TRINKET_NO_FORGE,
  TRINKET_NO_TURN,
  TRINKET_MOVED,
} = require("../lib/trinket");

const tierRows = [
  { id: "s", slug: "smithing" },
  { id: "k", slug: "smithing-skilled" },
];

test("isSmith: plain Smithing counts, and so does anything that satisfies it", () => {
  assert.equal(isSmith(tierRows, new Set(["s"])), true);
  assert.equal(isSmith(tierRows, new Set(["k", "s"])), true);
  assert.equal(isSmith(tierRows, new Set(["k"])), false);
  assert.equal(isSmith([], new Set(["s"])), false);
});

const ready = { hasOpenTurn: true, hasWorkshop: true, hasMoved: false, resources: 4 };

test("trinketRefusalFor: null when everything is in place", () => {
  assert.equal(trinketRefusalFor(ready), null);
});

test("trinketRefusalFor: the forge, the turn, the Move, then the ⬢", () => {
  assert.equal(trinketRefusalFor({ ...ready, hasWorkshop: false, hasMoved: true }), TRINKET_NO_FORGE);
  assert.equal(trinketRefusalFor({ ...ready, hasOpenTurn: false }), TRINKET_NO_TURN);
  assert.equal(trinketRefusalFor({ ...ready, hasMoved: true }), TRINKET_MOVED);
  assert.equal(trinketRefusalFor({ ...ready, resources: 3 }), "A Trinket costs 4 ⬢, and you have 3 ⬢.");
  assert.equal(trinketRefusalFor({ ...ready, resources: undefined }), "A Trinket costs 4 ⬢, and you have 0 ⬢.");
});

test("trinketCostRefusal: the request and the button share the shortfall sentence", () => {
  assert.equal(trinketCostRefusal(4), null);
  assert.equal(trinketCostRefusal(9), null);
  assert.equal(trinketCostRefusal(2), trinketRefusalFor({ ...ready, resources: 2 }));
});

test("inlayStonesOf: only held tags with an inlay value, by name", () => {
  const stones = inlayStonesOf([
    { quantity: 2, tag: { slug: "onyx", name: "Onyx", inlayValue: 10 } },
    { quantity: 1, tag: { slug: "hematite", name: "Hematite", inlayValue: 6 } },
    { quantity: 3, tag: { slug: "bread", name: "Bread", inlayValue: null } },
    { quantity: 0, tag: { slug: "opal", name: "Opal", inlayValue: 24 } },
  ]);
  assert.deepEqual(stones, [
    { slug: "hematite", name: "Hematite", quantity: 1 },
    { slug: "onyx", name: "Onyx", quantity: 2 },
  ]);
});
