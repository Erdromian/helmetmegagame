// node --test over db/lib/vampire.js. Pure and Prisma-free, same as the
// module it covers. The two things most likely to go wrong silently: a band
// boundary landing one point off (the design doc's printed ranges overlap at
// their edges, so bloodUrgencyBand/humanityBand pick a specific reading —
// see that file's own comment), and perTurnRate's scaling at a non-24h turn.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BLOOD_MAX,
  HUMANITY_MAX,
  clampBlood,
  clampHumanity,
  perTurnRate,
  bloodUrgencyBand,
  isPale,
  hasBlackSclera,
  humanityBand,
} = require("../lib/vampire");

test("clampBlood/clampHumanity hold the meter inside 0-100", () => {
  assert.equal(clampBlood(-5), 0);
  assert.equal(clampBlood(BLOOD_MAX + 10), BLOOD_MAX);
  assert.equal(clampBlood(94.4), 94);
  assert.equal(clampHumanity(-5), 0);
  assert.equal(clampHumanity(HUMANITY_MAX + 10), HUMANITY_MAX);
});

test("perTurnRate scales a per-day config rate by the turn's own length", () => {
  assert.equal(perTurnRate(34, 24), 34);
  assert.equal(perTurnRate(34, 12), 17);
  assert.equal(perTurnRate(34, 8), 11);
  assert.equal(perTurnRate(34, 6), 9);
  assert.equal(perTurnRate(10, 24), 10);
  assert.equal(perTurnRate(10, 6), 3);
});

test("bloodUrgencyBand: every boundary, Flush only at the exact top", () => {
  assert.equal(bloodUrgencyBand(100), "flush");
  assert.equal(bloodUrgencyBand(99), "satiated");
  assert.equal(bloodUrgencyBand(67), "satiated");
  assert.equal(bloodUrgencyBand(66), "thirsty");
  assert.equal(bloodUrgencyBand(34), "thirsty");
  assert.equal(bloodUrgencyBand(33), "famished");
  assert.equal(bloodUrgencyBand(1), "famished");
  assert.equal(bloodUrgencyBand(0), "bloodcrazed");
});

test("isPale/hasBlackSclera: the additive appearance track", () => {
  assert.equal(isPale(67), false);
  assert.equal(isPale(66), true);
  assert.equal(isPale(0), true);
  assert.equal(hasBlackSclera(34), false);
  assert.equal(hasBlackSclera(33), true);
  assert.equal(hasBlackSclera(0), true);
  // Both hold at once once blood is low enough.
  assert.equal(isPale(10) && hasBlackSclera(10), true);
});

test("humanityBand: every boundary, null at 0 (Bestial/Wight territory instead)", () => {
  assert.equal(humanityBand(100), "humane");
  assert.equal(humanityBand(76), "humane");
  assert.equal(humanityBand(75), "estranged");
  assert.equal(humanityBand(51), "estranged");
  assert.equal(humanityBand(50), "disturbed");
  assert.equal(humanityBand(26), "disturbed");
  assert.equal(humanityBand(25), "warped");
  assert.equal(humanityBand(1), "warped");
  assert.equal(humanityBand(0), null);
});
