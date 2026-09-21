// node --test over db/lib/customCost.js: what a craft costs in ⬢ with the maker's own words on it, per unit or per batch.
const test = require("node:test");
const assert = require("node:assert/strict");
const { craftResourceCost } = require("../lib/customCost");

test("an unnamed craft costs the recipe's own ⬢ for every unit, and nothing more", () => {
  assert.equal(craftResourceCost({ resources: 3, surcharge: 0, quantity: 4 }), 12);
  assert.equal(craftResourceCost({ resources: 0, surcharge: 0, quantity: 20, perBatch: true }), 0);
});

test("the surcharge is per unit unless the recipe says per batch", () => {
  assert.equal(craftResourceCost({ resources: 3, surcharge: 1, quantity: 1 }), 4);
  assert.equal(craftResourceCost({ resources: 3, surcharge: 1, quantity: 5 }), 20, "a named batch of five daggers is 5 x (3 + 1)");
  assert.equal(craftResourceCost({ resources: 0, surcharge: 1, quantity: 20, perBatch: true }), 1, "twenty named dishes, one ⬢");
});

test("a per-batch surcharge is charged once, on top of the recipe's own per-unit cost", () => {
  assert.equal(craftResourceCost({ resources: 2, surcharge: 1, quantity: 10, perBatch: true }), 21);
  assert.equal(craftResourceCost({ resources: 2, surcharge: 3, quantity: 10, perBatch: true }), 23);
});

test("a batch of one costs the same either way", () => {
  assert.equal(craftResourceCost({ resources: 2, surcharge: 1, quantity: 1, perBatch: true }), craftResourceCost({ resources: 2, surcharge: 1, quantity: 1 }));
});

test("nothing made costs nothing, even named, and a bad quantity is nothing rather than negative", () => {
  assert.equal(craftResourceCost({ resources: 5, surcharge: 1, quantity: 0, perBatch: true }), 0);
  assert.equal(craftResourceCost({ resources: 5, surcharge: 1, quantity: -3 }), 0);
  assert.equal(craftResourceCost({ resources: 5, surcharge: 1, quantity: "x" }), 0);
  assert.equal(craftResourceCost(), 0);
});

test("a free naming recipe adds nothing whichever way it charges", () => {
  assert.equal(craftResourceCost({ resources: 4, surcharge: 0, quantity: 3, perBatch: true }), 12);
  assert.equal(craftResourceCost({ resources: 4, surcharge: 0, quantity: 3 }), 12);
});
