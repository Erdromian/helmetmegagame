// node --test over db/lib/advantage.js — Lucky's roll-twice-keep-the-better
// die, and the labor drop die's Scavenging remap that rides beside it. Run
// with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { rollWithAdvantage, holdsAdvantage, formatAdvantage } = require("../lib/advantage");
const { effectiveDropRoll } = require("../lib/laborDrops");

const LUCKY = [{ tag: { slug: "lucky" } }];

test("holdsAdvantage takes both tag shapes, and neither by accident", () => {
  assert.equal(holdsAdvantage(LUCKY), true);
  assert.equal(holdsAdvantage([{ slug: "lucky" }]), true);
  assert.equal(holdsAdvantage([{ tag: { slug: "brave" } }]), false);
  assert.equal(holdsAdvantage([]), false);
  assert.equal(holdsAdvantage(undefined), false);
});

test("without Lucky exactly one die is thrown", () => {
  for (let i = 0; i < 200; i++) {
    const r = rollWithAdvantage([]);
    assert.equal(r.rolls.length, 1);
    assert.equal(r.advantage, false);
    assert.equal(r.die, r.rolls[0]);
    assert.ok(r.die >= 1 && r.die <= 6);
  }
});

test("with Lucky two dice are thrown and the better one counts", () => {
  for (let i = 0; i < 200; i++) {
    const r = rollWithAdvantage(LUCKY);
    assert.equal(r.rolls.length, 2);
    assert.equal(r.advantage, true);
    assert.equal(r.die, Math.max(...r.rolls));
  }
});

// The point of the tag, stated as a number: advantage on a d6 is worth about
// a full point of average. A regression that quietly rolled once would land
// near 3.5 and this is what would catch it.
test("Lucky lifts the average roll by roughly a point", () => {
  const mean = (tags) => {
    let sum = 0;
    for (let i = 0; i < 60000; i++) sum += rollWithAdvantage(tags).die;
    return sum / 60000;
  };
  assert.ok(Math.abs(mean([]) - 3.5) < 0.1, "a plain d6 averages 3.5");
  assert.ok(Math.abs(mean(LUCKY) - 4.472) < 0.1, "advantage on a d6 averages 4.47");
});

test("the roll line names Lucky only when it actually fired", () => {
  assert.equal(formatAdvantage({ rolls: [3], advantage: false }), null);
  assert.equal(formatAdvantage({ rolls: [6, 2], advantage: true }), "(6, 2 — Lucky)");
});

// Laboring (Scavenging). Only faces 1 and 6 are configured in
// docs/labordrops.yaml, so "drops on 4 and 5 as well" is a remap onto 6.
test("Scavenging reads a 4 or a 5 as a 6, and leaves a 1 alone", () => {
  const none = new Set();
  const scav = new Set(["laboring-scavenging"]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((r) => effectiveDropRoll(r, none)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((r) => effectiveDropRoll(r, scav)), [1, 2, 3, 6, 6, 6]);
});

test("Scavenging never converts the injury face into a find", () => {
  assert.equal(effectiveDropRoll(1, new Set(["laboring-scavenging"])), 1);
});

test("effectiveDropRoll takes an array as readily as a Set", () => {
  assert.equal(effectiveDropRoll(4, ["laboring-scavenging"]), 6);
  assert.equal(effectiveDropRoll(4, []), 4);
});
