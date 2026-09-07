// node --test over the pure half of db/lib/poison.js — detection and the
// hypergeometric draw the stack primitives (tagWrites.js) and the poison
// action (requestActions.js) both lean on. Run with `npm test --workspace=db`.
// Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { canDetectPoison, drawPoisonedUnits, POISON_SENSE_SLUG, POISON_SNOOPER_SLUG } = require("../lib/poison");

test("canDetectPoison: neither trait nor gadget means no", () => {
  assert.equal(canDetectPoison([]), false);
  assert.equal(canDetectPoison(null), false);
  assert.equal(canDetectPoison([{ tag: { slug: "iron-constitution" } }]), false);
});

test("canDetectPoison: either the trait or the held gadget is enough", () => {
  assert.equal(canDetectPoison([{ tag: { slug: POISON_SENSE_SLUG } }]), true);
  assert.equal(canDetectPoison([{ tag: { slug: POISON_SNOOPER_SLUG } }]), true);
  assert.equal(
    canDetectPoison([{ tag: { slug: "bound" } }, { tag: { slug: POISON_SNOOPER_SLUG } }]),
    true,
  );
});

test("canDetectPoison: tolerates a bare Tag[] shape too", () => {
  assert.equal(canDetectPoison([{ slug: POISON_SENSE_SLUG }]), true);
  assert.equal(canDetectPoison([{ slug: "bound" }]), false);
});

test("drawPoisonedUnits: no poisoned units on the stack draws none, ever", () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(drawPoisonedUnits(10, 0, 5), 0);
  }
});

test("drawPoisonedUnits: the whole stack tainted draws poisoned every time, capped at what's taken", () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(drawPoisonedUnits(6, 6, 4), 4);
    assert.equal(drawPoisonedUnits(6, 6, 6), 6);
  }
});

test("drawPoisonedUnits: never draws more than what's poisoned or what's taken", () => {
  for (let i = 0; i < 500; i += 1) {
    const total = 1 + Math.floor(Math.random() * 20);
    const poisoned = Math.floor(Math.random() * (total + 1));
    const take = 1 + Math.floor(Math.random() * total);
    const drawn = drawPoisonedUnits(total, poisoned, take);
    assert.ok(drawn >= 0, "never negative");
    assert.ok(drawn <= poisoned, "never more than the stack actually carries");
    assert.ok(drawn <= take, "never more than what left the stack");
  }
});

test("drawPoisonedUnits: taking nothing draws nothing", () => {
  assert.equal(drawPoisonedUnits(10, 5, 0), 0);
});

test("drawPoisonedUnits: a single unit's odds land near poisonedCount / quantity over many trials", () => {
  // 3 of 10 poisoned, drawing 1 at a time — expected long-run rate 0.3.
  // 4000 trials keeps this comfortably far from flaking on the true 0.3 mean
  // (a two-sided 5-sigma band around it is roughly [0.264, 0.336]).
  let hits = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i += 1) {
    hits += drawPoisonedUnits(10, 3, 1);
  }
  const rate = hits / trials;
  assert.ok(rate > 0.25 && rate < 0.35, `observed rate ${rate} strayed too far from 0.3`);
});
