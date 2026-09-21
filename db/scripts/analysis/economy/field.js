// The field's productivity, worked out (docs/systemdocs/SOILERY.md §9, db/lib/fieldProductivity.js).
//
// A farming place's pool refills at what the town eats plus a margin and every harvest draws on it, so a town that farms
// what it needs holds the field whole and one that farms much more wears it down until output falls to the refill. The
// curve, the refill and the order of a turn are the game's own functions (fieldProductivity.js), and the knobs are read
// off the schema defaults, so a retune there moves this.
//
// It answers three questions: how many farmers does the town need, what does each mix of farmers settle at, and how long
// until they notice. Crops are counted in FOOD-CROP EQUIVALENTS: a plant draws the same from the soil whatever it gives you,
// so a tobacco leaf, a third of a plant's yield, counts as three.

const field = require("../../../lib/fieldProductivity");
const soilery = require("../../../lib/soilery");

// Plays one field forward from full: each turn the farmers TRY to make `demand` crops at full yield, make `demand` times the
// multiplier the pool set, that comes out of the pool, and the pool refills. Answers where it settles and how it got there.
function settle(demand, { rate, cap, s, turns = 200 }) {
  let pool = cap;
  let mult = field.yieldMultiplier(pool, cap, s);
  let firstDrop = null;
  let firstWarning = null;
  for (let t = 1; t <= turns; t++) {
    pool = field.stepPool(pool, demand * mult, rate, cap);
    mult = field.yieldMultiplier(pool, cap, s);
    if (firstDrop == null && mult < 0.98) firstDrop = t;
    if (firstWarning == null && field.fieldTier(mult) > 0) firstWarning = t;
  }
  return { mult, produced: demand * mult, firstDrop, firstWarning, pool };
}

function buildField({ params, cooking, schemaDefault, players }) {
  const s = {
    enabled: true,
    margin: schemaDefault("farmSustainMargin"),
    poolTurns: schemaDefault("farmPoolTurns"),
    comfort: schemaDefault("farmComfortFrac"),
    minYield: schemaDefault("farmMinYield"),
    curveExp: schemaDefault("farmCurveExp"),
  };
  const seats = players;
  const rate = field.sustainableRate(seats, s);
  const cap = field.poolCap(seats, s);
  const eaten = seats * field.CROPS_PER_SEAT; // what the town eats, crops a turn
  const cycle = params.farmCycle;
  const plants = params.farmMaxCrops;

  // What one Farm action draws, and what it gives, by crop. A wheat plant stands for the food crops.
  const food = soilery.CROPS.find((c) => c.crop === "wheat");
  const cpp = food?.cropsPerPlant ?? soilery.CROPS_PER_PLANT;
  const wither = food?.witherIn ?? soilery.WITHER_IN;
  const foodAction = plants * (1 - 1 / wither) * cpp;
  const fertAction = plants * (1 + 1 / soilery.BOUNTY_IN) * cpp;
  const tob = soilery.CROPS.find((c) => c.crop === "tobacco");
  const tobLeaves = plants * (1 - 1 / (tob?.witherIn ?? wither)) * (tob?.cropsPerPlant ?? cpp);
  const tobDraw = tobLeaves * (soilery.CROPS_PER_PLANT / (tob?.cropsPerPlant ?? cpp));
  const tobPrice = cooking?.tobacco?.price ?? null;

  const perTurn = { food: foodAction / cycle, fert: fertAction / cycle, tobacco: tobDraw / cycle };
  const farmersToEat = eaten / perTurn.food;
  const farmersToFill = rate / perTurn.food;

  const scenarios = [];
  const add = (label, mix, group) => {
    const demand = (mix.food ?? 0) * perTurn.food + (mix.fert ?? 0) * perTurn.fert + (mix.tobacco ?? 0) * perTurn.tobacco;
    const r = settle(demand, { rate, cap, s });
    const foodShare = ((mix.food ?? 0) * perTurn.food + (mix.fert ?? 0) * perTurn.fert) / (demand || 1);
    const foodCrops = r.produced * (demand ? foodShare : 0);
    const tobaccoLeaves = mix.tobacco ? (mix.tobacco * (tobLeaves / cycle)) * r.mult : 0;
    scenarios.push({
      group,
      label,
      food: mix.food ?? 0,
      fert: mix.fert ?? 0,
      tobacco: mix.tobacco ?? 0,
      farmers: (mix.food ?? 0) + (mix.fert ?? 0) + (mix.tobacco ?? 0),
      demand,
      ratio: demand / rate,
      settled: r.mult,
      firstDrop: r.firstDrop,
      firstWarning: r.firstWarning,
      produced: r.produced,
      foodCrops,
      fed: Math.min(seats, foodCrops / field.CROPS_PER_SEAT),
      tobaccoCoin: tobPrice == null ? null : tobaccoLeaves * tobPrice,
    });
  };
  for (const n of [2, 3, 4, 5, 6, 8]) add(`${n} food farmers`, { food: n }, "Food only");
  for (const n of [1, 2, 3]) add(`3 food farmers and ${n} on tobacco`, { food: 3, tobacco: n }, "With a cash crop");
  for (const n of [2, 3]) add(`${n} food farmers on Fertilizer`, { fert: n }, "Fertilized");
  add("2 food farmers and 4 on tobacco", { food: 2, tobacco: 4 }, "With a cash crop");

  // How a field with a lower regeneration behaves, for the same farming. A second place at 0.4 takes 40% of the refill.
  const second = [0.25, 0.4, 0.6].map((share) => {
    const r2 = field.sustainableRate(seats, s, share);
    const c2 = field.poolCap(seats, s, share);
    const demand = 2 * perTurn.food;
    const out = settle(demand, { rate: r2, cap: c2, s });
    return { share, rate: r2, cap: c2, farmersToFill: r2 / perTurn.food, twoFarmers: out.mult, twoFarmersFirstDrop: out.firstDrop };
  });

  // The recovery: farmers at twice the refill for `weeks` turns, then back to 0.9 of it.
  const recover = (() => {
    const overTurns = 10;
    let pool = cap;
    let mult = 1;
    let low = 1;
    let back = null;
    for (let t = 1; t <= 60; t++) {
      const demand = t <= overTurns ? 2 * rate : 0.9 * rate;
      pool = field.stepPool(pool, demand * mult, rate, cap);
      mult = field.yieldMultiplier(pool, cap, s);
      low = Math.min(low, mult);
      if (t > overTurns && back == null && mult >= 0.99) back = t - overTurns;
    }
    return { overTurns, lowest: low, turnsToRecover: back };
  })();

  return {
    settings: s,
    seats,
    rate,
    cap,
    eaten,
    cycle,
    plants,
    perAction: { food: foodAction, fert: fertAction, tobaccoLeaves: tobLeaves, tobaccoDraw: tobDraw },
    perTurn,
    farmersToEat,
    farmersToFill,
    scenarios,
    second,
    recover,
    tobaccoPrice: tobPrice,
    hungerPerCrop: params.hungerDecay / field.CROPS_PER_SEAT,
    checks: {
      defaultsMatchCode:
        s.margin === field.DEFAULTS.margin &&
        s.poolTurns === field.DEFAULTS.poolTurns &&
        s.comfort === field.DEFAULTS.comfort &&
        s.minYield === field.DEFAULTS.minYield &&
        s.curveExp === field.DEFAULTS.curveExp,
      refillCoversTown: rate >= eaten,
      soundAtTheRefill: settle(rate, { rate, cap, s }).mult === 1,
      overdrawWears: settle(2 * rate, { rate, cap, s }).mult < 0.6,
    },
  };
}

module.exports = { buildField };
