// node --test over db/lib/slotMachine.js and db/lib/slotText.js — the Den's
// slot machine, which is the one place in the game where the house's edge is
// a number somebody chose. Run with `npm test --workspace=db`. Nothing here
// touches Prisma: the classifier and the table are pure, and everything that
// moves money is behind them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyRoll, payoutFor, slotLine } = require("../lib/slotMachine");
const { SLOT_COST, SLOT_PAYOUTS, SLOT_MAX_PAYOUT } = require("../lib/slotText");

// Every one of the 216 ways three dice can fall, classified.
function census() {
  const counts = { triple: 0, run: 0, pair: 0, nothing: 0 };
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let c = 1; c <= 6; c++) {
        counts[classifyRoll([a, b, c]) ?? "nothing"] += 1;
      }
    }
  }
  return counts;
}

test("the outcomes are exactly the 216 ways three dice fall", () => {
  const counts = census();
  assert.equal(counts.triple + counts.run + counts.pair + counts.nothing, 216);
  assert.deepEqual(counts, { triple: 6, run: 12, pair: 90, nothing: 108 });
});

test("half of spins pay something — the edge is in the money, not the lights", () => {
  const counts = census();
  assert.equal(counts.triple + counts.run + counts.pair, 108);
});

test("the house keeps its edge: the table pays back less than it takes", () => {
  const counts = census();
  const paid = counts.triple * SLOT_PAYOUTS.triple + counts.run * SLOT_PAYOUTS.run + counts.pair * SLOT_PAYOUTS.pair;
  const taken = 216 * SLOT_COST;
  assert.ok(paid < taken, `the machine pays out ${paid} against ${taken} taken — the house is losing`);
  // Around 94% back, which is generous and still a house. A retune that leaves
  // this band is a decision, not a typo, so the test says so out loud.
  const rtp = paid / taken;
  assert.ok(rtp > 0.85 && rtp < 0.99, `return to player is ${(rtp * 100).toFixed(1)}%`);
});

test("the machine never owes more than one jackpot", () => {
  assert.equal(SLOT_MAX_PAYOUT, Math.max(...Object.values(SLOT_PAYOUTS)));
  for (const outcome of Object.keys(SLOT_PAYOUTS)) {
    assert.ok(payoutFor(outcome) <= SLOT_MAX_PAYOUT);
  }
  assert.equal(payoutFor(null), 0);
  assert.equal(payoutFor("something else"), 0);
});

test("order does not matter — a run is a run whichever way it lands", () => {
  assert.equal(classifyRoll([1, 2, 3]), "run");
  assert.equal(classifyRoll([3, 1, 2]), "run");
  assert.equal(classifyRoll([6, 4, 5]), "run");
  // …and 2-3-4 is not one. Two runs only, or a run would be commoner than a pair.
  assert.equal(classifyRoll([2, 3, 4]), null);
  assert.equal(classifyRoll([5, 6, 1]), null);
});

test("a triple is never read as a pair", () => {
  for (let f = 1; f <= 6; f++) assert.equal(classifyRoll([f, f, f]), "triple");
});

test("the line names the roll, the result and nobody's account", () => {
  assert.equal(slotLine("Greeblus", [1, 3, 6], null), "Greeblus rolled 1/3/6. Better luck next time.");
  assert.equal(slotLine("A young man", [2, 2, 5], "pair"), "A young man rolled 2/2/5. They gained 6 ¢.");
  assert.equal(slotLine("Greeblus", [4, 4, 4], "triple"), "Greeblus rolled 4/4/4. Jackpot! They gained 50 ¢.");
  // The faces print in the order they fell, not sorted — the classifier sorts
  // its own copy, and a player watching the reels should see what the reels did.
  assert.match(slotLine("X", [6, 1, 6], "pair"), /rolled 6\/1\/6\./);
});
