// node --test over db/lib/fieldProductivity.js and the field's side of db/lib/soilery.js.
// The pure half (rate, cap, curve, the turn step) is checked directly; the two writers are
// checked against a fake `tx` that records the SQL it was handed, so the clamp lives in the
// query and the tests can only see what the query says.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CROPS_PER_SEAT,
  DEFAULTS,
  fieldSettings,
  sustainableRate,
  poolCap,
  yieldMultiplier,
  stepPool,
  regenShare,
  MIN_SHARE,
  fieldStatus,
  fieldTier,
  fieldWarning,
  yieldMultFor,
  drawFromPool,
  refundToPool,
  runFieldPass,
} = require("../lib/fieldProductivity");
const { reapDetail, reapDetailFor, reap, scaleCrops, CROPS_PER_PLANT, farmDm } = require("../lib/soilery");

// ---- rate and cap ---------------------------------------------------------------------------------------

test("the refill is two crops a seat plus the margin", () => {
  assert.equal(CROPS_PER_SEAT, 2);
  // 80 seats eat 160 crops a turn; 15% on top is 184.
  assert.ok(Math.abs(sustainableRate(80, DEFAULTS) - 184) < 1e-9);
  assert.equal(sustainableRate(0, DEFAULTS), 0);
});

test("the pool holds poolTurns turns of refill", () => {
  assert.ok(Math.abs(poolCap(80, DEFAULTS) - 184 * 4) < 1e-9);
  assert.ok(Math.abs(poolCap(80, { ...DEFAULTS, poolTurns: 2 }) - 368) < 1e-9);
});

test("a missing or absurd knob falls back or clamps rather than breaking the curve", () => {
  assert.deepEqual(fieldSettings(undefined), DEFAULTS);
  const s = fieldSettings({ farmComfortFrac: 0, farmMinYield: 7, farmPoolTurns: "x", farmCurveExp: -3, farmSustainMargin: null });
  assert.equal(s.comfort, 0.05);
  assert.equal(s.minYield, 1);
  assert.equal(s.poolTurns, DEFAULTS.poolTurns);
  assert.equal(s.curveExp, 0.25);
  assert.equal(s.margin, DEFAULTS.margin);
  assert.equal(fieldSettings({ farmFieldEnabled: false }).enabled, false);
});

// ---- the curve ------------------------------------------------------------------------------------------

test("a pool at or above the comfort level changes nothing", () => {
  const cap = 1000;
  assert.equal(yieldMultiplier(1000, cap, DEFAULTS), 1);
  assert.equal(yieldMultiplier(750, cap, DEFAULTS), 1);
});

test("the curve falls in a straight line to the minimum at an empty pool, and stays there in debt", () => {
  const cap = 1000;
  // Halfway between comfort (750) and empty is 375, which is halfway between 1 and 0.25.
  assert.ok(Math.abs(yieldMultiplier(375, cap, DEFAULTS) - 0.625) < 1e-9);
  assert.equal(yieldMultiplier(0, cap, DEFAULTS), DEFAULTS.minYield);
  assert.equal(yieldMultiplier(-400, cap, DEFAULTS), DEFAULTS.minYield);
  assert.equal(yieldMultiplier(-1000, cap, DEFAULTS), DEFAULTS.minYield);
});

test("a steeper curve is gentler at first and harder at the end", () => {
  const cap = 1000;
  const straight = yieldMultiplier(500, cap, DEFAULTS);
  const steep = yieldMultiplier(500, cap, { ...DEFAULTS, curveExp: 2 });
  assert.ok(steep < straight, "at the same pool a steeper curve gives less");
  // Both meet at the ends.
  assert.equal(yieldMultiplier(0, cap, { ...DEFAULTS, curveExp: 2 }), DEFAULTS.minYield);
  assert.equal(yieldMultiplier(750, cap, { ...DEFAULTS, curveExp: 2 }), 1);
});

test("a minimum yield of 1 turns the curve off", () => {
  const s = { ...DEFAULTS, minYield: 1 };
  for (const pool of [-800, 0, 100, 800]) assert.equal(yieldMultiplier(pool, 800, s), 1);
});

// ---- the pool over turns ---------------------------------------------------------------------------------

// Plays the field forward: each turn the farmers TRY to make `demand` crops at full yield, so they make demand x the
// multiplier the pool set, that comes out of the pool, and then the pool refills.
function play(demand, turns, { seats = 80, settings = DEFAULTS, start = null } = {}) {
  const rate = sustainableRate(seats, settings);
  const cap = poolCap(seats, settings);
  let pool = start ?? cap;
  let mult = yieldMultiplier(pool, cap, settings);
  const trail = [];
  for (let t = 0; t < turns; t++) {
    const produced = demand(t) * mult;
    pool = stepPool(pool, produced, rate, cap);
    mult = yieldMultiplier(pool, cap, settings);
    trail.push({ pool, mult, produced });
  }
  return { rate, cap, trail };
}

test("farming at or below the refill never degrades the field", () => {
  const { rate, trail } = play(() => sustainableRate(80) * 0.99, 60);
  assert.ok(trail.every((t) => t.mult === 1), "a sustainable field stays whole");
  assert.ok(trail.at(-1).pool > 0.99 * poolCap(80));
  const { trail: exact } = play(() => rate, 60);
  assert.ok(exact.every((t) => t.mult === 1));
});

test("farming twice the refill wears the field until output matches the refill", () => {
  const { rate, trail } = play(() => 2 * sustainableRate(80), 60);
  assert.equal(trail[0].mult, 1, "the pool is a cushion, so the first turn is untouched");
  assert.ok(trail.some((t) => t.mult < 0.9), "and then it degrades");
  const last = trail.at(-1);
  // It settles where 2 x the multiplier is 1, so the multiplier is a half and the output is the refill.
  assert.ok(Math.abs(last.mult - 0.5) < 0.01, `settles at half yield, got ${last.mult}`);
  assert.ok(Math.abs(last.produced - rate) < rate * 0.02, "output balances the refill");
});

test("a small overdraw settles at a small loss", () => {
  const { trail } = play(() => 1.5 * sustainableRate(80), 80);
  assert.ok(Math.abs(trail.at(-1).mult - 1 / 1.5) < 0.01);
});

test("more farmers making up the shortfall makes the same deficit, not a bigger harvest", () => {
  // They start at twice the refill and keep adding farmers as the yield drops, up to three and a half times it. The yield
  // falls to meet them, so output is still the refill: the extra farmers bought nothing.
  const { rate, trail } = play((t) => Math.min(3.5, 2 * (1 + t / 40)) * sustainableRate(80), 80);
  const late = trail.slice(-10);
  assert.ok(late.every((t) => t.produced <= rate * 1.05), "output stays at the refill however many farmers there are");
  assert.ok(late.every((t) => t.mult < 0.5), "and the yield is worse for the trouble");
});

test("demand beyond the floor pins the yield at the minimum, and the field goes into debt", () => {
  const { cap, trail } = play(() => 6 * sustainableRate(80), 40);
  assert.equal(trail.at(-1).mult, DEFAULTS.minYield);
  assert.equal(trail.at(-1).pool, -cap + sustainableRate(80), "debt is capped at one full pool, less this turn's refill");
});

test("stop over-farming and the field recovers", () => {
  const rate = sustainableRate(80);
  const { trail } = play((t) => (t < 12 ? 2.5 * rate : 0.9 * rate), 40);
  assert.ok(trail[11].mult < 0.6, "worn by turn 12");
  assert.equal(trail.at(-1).mult, 1, "whole again after they stop");
});

test("the turn step clamps at the cap and at the debt floor", () => {
  assert.equal(stepPool(90, 0, 50, 100), 100);
  assert.equal(stepPool(-90, 500, 10, 100), -90);
  assert.equal(stepPool(0, -5, 10, 100), 10, "a negative harvest is nothing, not a gain");
});

// ---- status and warning -----------------------------------------------------------------------------------

test("fieldStatus reads a fresh game as a full field", () => {
  const status = fieldStatus({ playerCount: 80 }, { playerCount: null }, null, {});
  assert.equal(status.seats, 80);
  assert.equal(status.pool, status.cap);
  assert.equal(status.mult, 1);
  assert.equal(status.fraction, 1);
  assert.equal(status.enabled, true);
});

test("the stamped seat count wins over the expected one, as everywhere else", () => {
  assert.equal(fieldStatus({ playerCount: 80 }, { playerCount: 100 }, null, {}).seats, 100);
});

test("a switched-off field reports a whole yield whatever the state says", () => {
  assert.equal(fieldStatus({ farmFieldEnabled: false }, {}, { yieldMult: 0.3, pool: -100 }, {}).mult, 1);
});

test("the field says nothing until the yield is down to 80%, then speaks in four steps", () => {
  assert.equal(fieldTier(1), 0);
  assert.equal(fieldTier(0.85), 0);
  assert.equal(fieldTier(0.81), 0);
  assert.equal(fieldTier(0.8), 1);
  assert.equal(fieldTier(0.7), 1);
  assert.equal(fieldTier(0.6), 2);
  assert.equal(fieldTier(0.5), 2);
  assert.equal(fieldTier(0.4), 3);
  assert.equal(fieldTier(0.31), 3);
  assert.equal(fieldTier(0.3), 3, "below 30%, not at it");
  assert.equal(fieldTier(0.29), 4);
  assert.equal(fieldTier(0), 4);
});

test("the warning is silent for a sound field and never carries a number", () => {
  assert.equal(fieldWarning(1), null);
  assert.equal(fieldWarning(0.9), null);
  const seen = new Set();
  for (const mult of [0.8, 0.6, 0.4, 0.2]) {
    const text = fieldWarning(mult);
    assert.ok(text, `a warning at ${mult}`);
    assert.doesNotMatch(text, /\d|percent|%/, "words, not numbers");
    seen.add(text);
  }
  assert.equal(seen.size, 4, "each step says something different");
  assert.match(farmDm(4, [], false, 0.4), /failing/);
  assert.doesNotMatch(farmDm(4, [], false, 1), /field/i);
  assert.doesNotMatch(farmDm(4, [], false, 0.7), /\d+%/);
});

// ---- a field's own share -------------------------------------------------------------------------------------------

test("a place with no soileryRegen refills like a field that feeds the whole town", () => {
  assert.equal(regenShare({}), 1);
  assert.equal(regenShare(undefined), 1);
  assert.equal(regenShare({ soileryRegen: null }), 1);
  assert.equal(regenShare({ soilery: true }), 1);
});

test("a poorer field takes its share, and one that asks for nothing is kept off zero", () => {
  assert.equal(regenShare({ soileryRegen: 0.4 }), 0.4);
  assert.equal(regenShare({ soileryRegen: 0 }), MIN_SHARE);
  assert.equal(regenShare({ soileryRegen: -3 }), MIN_SHARE);
  assert.equal(regenShare({ soileryRegen: "x" }), 1);
  assert.equal(regenShare({ soileryRegen: 99 }), 10);
});

test("the rate and the pool both scale with the share", () => {
  assert.ok(Math.abs(sustainableRate(80, DEFAULTS, 0.4) - 73.6) < 1e-9);
  assert.ok(Math.abs(poolCap(80, DEFAULTS, 0.4) - 294.4) < 1e-9);
  assert.equal(sustainableRate(80, DEFAULTS), sustainableRate(80, DEFAULTS, 1));
});

test("the same farming wears a poorer field harder", () => {
  // Three food farmers make about 187 crops a turn. That is the refill of a full field and 2.5 times a 0.4 field.
  const demand = () => 187;
  const full = play(demand, 40, { seats: 80 }).trail.at(-1).mult;
  const rate = sustainableRate(80, DEFAULTS, 0.4);
  const cap = poolCap(80, DEFAULTS, 0.4);
  let pool = cap;
  let mult = 1;
  for (let t = 0; t < 40; t++) {
    pool = stepPool(pool, demand() * mult, rate, cap);
    mult = yieldMultiplier(pool, cap, DEFAULTS);
  }
  assert.ok(full > 0.97, "the full field holds");
  assert.ok(Math.abs(mult - rate / 187) < 0.02, `the poor field settles where 187 x yield is its refill, got ${mult}`);
});

// ---- what a harvest costs the field --------------------------------------------------------------------------

test("a food crop draws what it yields", () => {
  const r = reapDetailFor("wheat", 50, () => 0.99); // nothing withers
  assert.equal(r.crops, 50 * CROPS_PER_PLANT);
  assert.equal(r.draw, r.crops);
});

test("a cash crop draws as much as a plant would, not as much as a leaf: tobacco counts three to one", () => {
  const r = reapDetailFor("tobacco", 30, () => 0.99);
  assert.equal(r.crops, 30);
  assert.equal(r.draw, 30 * CROPS_PER_PLANT);
});

test("a whole yield reaps exactly as it did before the field existed, spending no extra dice", () => {
  let calls = 0;
  const rng = () => {
    calls += 1;
    return 0.99;
  };
  assert.equal(reap(10, rng), 10 * CROPS_PER_PLANT);
  assert.equal(calls, 10, "one die a plant, and no die for the multiplier");
});

test("a worn field takes the multiplier off the crops on average, and the draw follows what was produced", () => {
  // 0.8 of 3 crops is 2.4, so a plant gives 2 or 3, 3 forty percent of the time.
  let seed = 1;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const r = reapDetail(20000, rng, { cropsPerPlant: 3, witherIn: 1e9, yieldMult: 0.8 });
  const perPlant = r.crops / 20000;
  assert.ok(Math.abs(perPlant - 2.4) < 0.03, `about 2.4 a plant, got ${perPlant}`);
  assert.equal(r.draw, r.crops, "a food crop draws what it made");
});

test("scaleCrops keeps a whole number whole at 1, and never goes negative", () => {
  assert.equal(scaleCrops(3, 1, () => 0), 3);
  assert.equal(scaleCrops(3, 1.5, () => 0), 3);
  assert.equal(scaleCrops(3, 0, () => 0.5), 0);
  assert.equal(scaleCrops(3, -1, () => 0.5), 0);
  assert.equal(scaleCrops(3, 0.5, () => 0.2), 2, "1.5 rounds up when the die is under the fraction");
  assert.equal(scaleCrops(3, 0.5, () => 0.9), 1, "and down when it is over");
});

// ---- the writers and the pass ---------------------------------------------------------------------------------------

// A `tx` with two farming places and the pieces the field code reads. Its raw rows are what UPDATE ... RETURNING would say.
function fakeTx({ config = { playerCount: 80 }, state = { playerCount: null }, rows = [{ before: 100, after: 60 }], locations, fields = {} } = {}) {
  const places = locations ?? [
    { id: "loc-farm", name: "The Farms", attributes: { soilery: true } },
    { id: "loc-inn", name: "The Inn", attributes: {} },
  ];
  const calls = [];
  const stored = { ...fields };
  return {
    calls,
    stored,
    gameConfig: { findUnique: async () => config },
    gameState: { findUnique: async () => state },
    location: {
      findUnique: async ({ where }) => places.find((l) => l.id === where.id) ?? null,
      findMany: async () => places.map((l) => ({ ...l, field: stored[l.id] ? { pool: stored[l.id].pool ?? null } : null })),
    },
    locationField: {
      findUnique: async ({ where }) => stored[where.locationId] ?? null,
      update: async ({ where, data }) => {
        stored[where.locationId] = { ...(stored[where.locationId] ?? {}), ...data };
        calls.push({ update: { where, data } });
      },
      upsert: async ({ where, update, create }) => {
        stored[where.locationId] = stored[where.locationId] ? { ...stored[where.locationId], ...update } : { ...create };
        calls.push({ upsert: { where, update, create } });
      },
    },
    $queryRaw: async (strings, ...values) => {
      calls.push({ sql: strings.join("?"), values });
      return rows;
    },
  };
}

test("drawFromPool answers what the pool actually gave up, not what was asked", async () => {
  const tx = fakeTx({ rows: [{ before: 50, after: -20 }] });
  const got = await drawFromPool(tx, "loc-farm", 90);
  assert.deepEqual(got, { before: 50, after: -20, delta: 70 });
  const q = tx.calls.find((c) => c.sql);
  assert.match(q.sql, /FOR UPDATE/, "reads and writes under one lock");
  assert.match(q.sql, /GREATEST/, "the clamp is in the query");
  assert.match(q.sql, /"LocationField"/);
  const cap = poolCap(80, DEFAULTS);
  // cap for the default, then the place, then cap, -cap and the amount for the write, then the place again.
  assert.deepEqual(q.values.slice(0, 4), [cap, "loc-farm", cap, -cap]);
  assert.equal(q.values[4], 90);
  assert.equal(q.values.at(-1), "loc-farm");
});

test("a harvest at a poorer place is sized against that place's own pool", async () => {
  const tx = fakeTx({
    locations: [{ id: "loc-poor", name: "The Scrub", attributes: { soilery: true, soileryRegen: 0.4 } }],
    rows: [{ before: 200, after: 150 }],
  });
  await drawFromPool(tx, "loc-poor", 50);
  const q = tx.calls.find((c) => c.sql);
  assert.equal(q.values[0], poolCap(80, DEFAULTS, 0.4));
});

test("drawing nothing, or drawing at no place, writes nothing", async () => {
  const tx = fakeTx();
  assert.deepEqual(await drawFromPool(tx, "loc-farm", 0), { before: null, after: null, delta: 0 });
  assert.deepEqual(await drawFromPool(tx, null, 40), { before: null, after: null, delta: 0 });
  assert.equal(tx.calls.length, 0);
});

test("refundToPool puts back the delta and never past a full pool", async () => {
  const tx = fakeTx();
  await refundToPool(tx, "loc-farm", 40);
  const q = tx.calls.find((c) => c.sql);
  assert.match(q.sql, /LEAST/);
  assert.equal(q.values[3], 40);
  const none = fakeTx();
  await refundToPool(none, "loc-farm", 0);
  await refundToPool(none, null, 10);
  assert.equal(none.calls.length, 0);
});

test("yieldMultFor reads the place's own multiplier, and 1 for no place or a field not made yet", async () => {
  const tx = fakeTx({ fields: { "loc-farm": { pool: 10, yieldMult: 0.6 } } });
  assert.equal(await yieldMultFor(tx, "loc-farm"), 0.6);
  assert.equal(await yieldMultFor(tx, "loc-elsewhere"), 1);
  assert.equal(await yieldMultFor(tx, null), 1);
  const off = fakeTx({ config: { playerCount: 80, farmFieldEnabled: false }, fields: { "loc-farm": { yieldMult: 0.2 } } });
  assert.equal(await yieldMultFor(off, "loc-farm"), 1);
});

test("the pass refills a field and sets next turn's multiplier off where it ended up", async () => {
  const cap = poolCap(80, DEFAULTS);
  const rate = sustainableRate(80, DEFAULTS);
  const tx = fakeTx({ fields: { "loc-farm": { pool: 0 } } });
  const out = await runFieldPass(tx, { number: 5 });
  assert.equal(tx.stored["loc-farm"].pool, rate);
  assert.ok(Math.abs(tx.stored["loc-farm"].yieldMult - yieldMultiplier(rate, cap, DEFAULTS)) < 1e-9);
  assert.equal(out.fields.length, 1, "only the place with the soilery attribute");
  assert.equal(out.fields[0].location, "The Farms");
  assert.equal(out.fields[0].poolBefore, 0);
  assert.equal(tx.stored["loc-inn"], undefined, "a place that is not a field is never given a row");
});

test("the pass caps a full pool and leaves the field whole", async () => {
  const cap = poolCap(80, DEFAULTS);
  const tx = fakeTx({ fields: { "loc-farm": { pool: cap - 1 } } });
  await runFieldPass(tx, { number: 5 });
  assert.equal(tx.stored["loc-farm"].pool, cap);
  assert.equal(tx.stored["loc-farm"].yieldMult, 1);
});

test("a field that has never been harvested starts full, so the first pass changes nothing", async () => {
  const tx = fakeTx();
  const out = await runFieldPass(tx, { number: 1 });
  assert.equal(tx.stored["loc-farm"].pool, poolCap(80, DEFAULTS));
  assert.equal(tx.stored["loc-farm"].yieldMult, 1);
  assert.equal(out.yieldMult, 1);
});

test("two farming places are two fields: each refills on its own share and reports its own multiplier", async () => {
  const tx = fakeTx({
    locations: [
      { id: "loc-farm", name: "The Farms", attributes: { soilery: true } },
      { id: "loc-scrub", name: "The Scrub", attributes: { soilery: true, soileryRegen: 0.4 } },
    ],
    // Both were worked down to nothing.
    fields: { "loc-farm": { pool: 0 }, "loc-scrub": { pool: 0 } },
  });
  const out = await runFieldPass(tx, { number: 7 });
  assert.equal(out.fields.length, 2);
  assert.ok(Math.abs(tx.stored["loc-scrub"].pool - sustainableRate(80, DEFAULTS, 0.4)) < 1e-9);
  assert.ok(Math.abs(tx.stored["loc-farm"].pool - sustainableRate(80, DEFAULTS)) < 1e-9);
  // Refilling the same fraction of a cap a fifth the size lands them at the same place on the curve, but a smaller pool.
  assert.ok(tx.stored["loc-scrub"].pool < tx.stored["loc-farm"].pool);
  assert.equal(out.yieldMult, Math.min(tx.stored["loc-farm"].yieldMult, tx.stored["loc-scrub"].yieldMult));
});

test("a switched-off field is reset to a whole yield and refills nothing", async () => {
  const tx = fakeTx({ config: { playerCount: 80, farmFieldEnabled: false }, fields: { "loc-farm": { pool: -50, yieldMult: 0.3 } } });
  const out = await runFieldPass(tx, { number: 9 });
  assert.equal(tx.stored["loc-farm"].yieldMult, 1);
  assert.equal(tx.stored["loc-farm"].pool, -50, "the pool is left alone");
  assert.equal(out.enabled, false);
  assert.equal(out.fields.length, 0);
});
