// node --test over the pure half of db/lib/mining.js — the gate, the rate
// switch and the tool filter. Run with `npm test --workspace=db`. Nothing here
// touches Prisma; buildMiningContext and resolveMiningRate are the halves that
// need a database, and are exercised by hand per LOCAL-DEV.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MINING_RATE,
  PROSPECTING_YIELD_MULTIPLIER,
  computeMiningAccess,
  computeRate,
  toolsFor,
  resolveMiningRateFrom,
} = require("../lib/mining");
const { EXHAUSTED_SLUG, PROSPECTING_SLUG, PICKAXE_SLUG } = require("../lib/constants");

// A context of the shape buildMiningContext returns, with a workable seam under it.
function ctx(slugs, { coefficient = 1, tools = [], zoneSlug = "caves" } = {}) {
  return { locationName: "A Seam", coefficient, zoneSlug, tagSlugs: new Set(slugs), tools };
}

// The same button says Gather in the Black Hills (db/lib/gathering.js): same
// gate, same rate, different words — and the resolved rate says which.
test("the Black Hills gather where the caves mine, on the same gate and rate", () => {
  const caves = resolveMiningRateFrom(ctx([PICKAXE_SLUG]), 1);
  const hills = resolveMiningRateFrom(ctx([PICKAXE_SLUG], { zoneSlug: "hills" }), 1);
  assert.equal(caves.verb, "mine");
  assert.equal(caves.gathering, false);
  assert.equal(hills.verb, "gather");
  assert.equal(hills.gathering, true);
  assert.deepEqual([hills.min, hills.max], [caves.min, caves.max]);
});

test("the hills' refusals are worded for the ground, and still want a pickaxe", () => {
  const noPick = computeMiningAccess(ctx([], { zoneSlug: "hills" }));
  assert.equal(noPick.ok, false);
  assert.match(noPick.reason, /pickaxe/i);
  assert.doesNotMatch(noPick.reason, /rock/i);
  const nothing = resolveMiningRateFrom(ctx([PICKAXE_SLUG], { zoneSlug: "hills", coefficient: 0 }), 1);
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason, /nothing to gather/i);
});

test("a zone nobody named mines, so a new seam is never a hillside by accident", () => {
  assert.equal(resolveMiningRateFrom(ctx([PICKAXE_SLUG], { zoneSlug: null }), 1).verb, "mine");
  assert.equal(resolveMiningRateFrom(ctx([PICKAXE_SLUG], { zoneSlug: "depths" }), 1).verb, "mine");
});

test("a pickaxe is what opens the button", () => {
  assert.deepEqual(computeMiningAccess(ctx([PICKAXE_SLUG])), { ok: true });
});

test("no pickaxe, no digging — even holding Prospecting", () => {
  const refusal = computeMiningAccess(ctx([PROSPECTING_SLUG]));
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /pickaxe/i);
});

test("Exhausted refuses before the pickaxe is even looked at", () => {
  const refusal = computeMiningAccess(ctx([EXHAUSTED_SLUG, PICKAXE_SLUG]));
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /Exhausted/);
});

test("being tied up refuses too", () => {
  const refusal = computeMiningAccess(ctx(["bound", PICKAXE_SLUG]));
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /can't work/);
});

test("Prospecting multiplies the base rather than replacing it", () => {
  const plain = computeRate(1, 1, false);
  const skilled = computeRate(1, 1, true);
  assert.deepEqual(plain, { min: MINING_RATE.min, max: MINING_RATE.max });
  assert.deepEqual(skilled, {
    min: Math.round(MINING_RATE.min * PROSPECTING_YIELD_MULTIPLIER),
    max: Math.round(MINING_RATE.max * PROSPECTING_YIELD_MULTIPLIER),
  });
});

// The whole reason the skill is a multiplier and not a second flat range: a rich
// seam has to beat a poor one for BOTH diggers, and the skill has to be worth the
// same proportion in either place.
test("the skill and the place multiply, so a poor seam never out-earns a rich one", () => {
  const poorSkilled = computeRate(1, 0.25, true);
  const richPlain = computeRate(1, 1, false);
  assert.ok(poorSkilled.max < richPlain.max);
});

test("a seam drifted to nothing refuses, pickaxe or not", () => {
  const refusal = resolveMiningRateFrom(ctx([PICKAXE_SLUG], { coefficient: 0 }), 1);
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /nothing to mine/i);
});

test("the resolved range carries the prospecting flag the loot draw reads", () => {
  assert.equal(resolveMiningRateFrom(ctx([PICKAXE_SLUG]), 1).prospecting, false);
  assert.equal(resolveMiningRateFrom(ctx([PICKAXE_SLUG, PROSPECTING_SLUG]), 1).prospecting, true);
});

test("the stored expression stays the bare machine shape resourceDelta parses", () => {
  const rate = resolveMiningRateFrom(ctx([PICKAXE_SLUG]), 1);
  assert.match(rate.expression, /^\d+-\d+$/);
});

test("tools add flat, after the scaling, so one is worth the same everywhere", () => {
  const pick = { name: "Pickaxe", amount: 1, needsEquipped: true, equipped: true, isWeapon: false };
  const poor = resolveMiningRateFrom(ctx([PICKAXE_SLUG], { coefficient: 0.5, tools: [pick] }), 1);
  const rich = resolveMiningRateFrom(ctx([PICKAXE_SLUG], { coefficient: 1, tools: [pick] }), 1);
  assert.equal(poor.bonus, 1);
  assert.equal(rich.bonus, 1);
});

test("an unequipped tool that wants to be worn pays nothing", () => {
  const stowed = { name: "Pickaxe", amount: 1, needsEquipped: true, equipped: false, isWeapon: false };
  assert.deepEqual(toolsFor(ctx([PICKAXE_SLUG], { tools: [stowed] })), []);
});

test("only the best-paying weapon counts, but every non-weapon sums", () => {
  const tools = [
    { name: "Good Pick", amount: 3, needsEquipped: false, equipped: false, isWeapon: true },
    { name: "Bad Pick", amount: 1, needsEquipped: false, equipped: false, isWeapon: true },
    { name: "Helmet", amount: 1, needsEquipped: false, equipped: false, isWeapon: false },
  ];
  const kept = toolsFor(ctx([PICKAXE_SLUG], { tools }));
  assert.deepEqual(
    kept.map((t) => t.name).sort(),
    ["Good Pick", "Helmet"],
  );
});

test("Soft Hands halves what is left", () => {
  const plain = resolveMiningRateFrom(ctx([PICKAXE_SLUG]), 1);
  const soft = resolveMiningRateFrom(ctx([PICKAXE_SLUG, "soft-hands"]), 1);
  assert.deepEqual(soft.halvedBy, ["Soft Hands"]);
  assert.equal(soft.max, Math.floor(plain.max / 2));
});
