// The economy report's restated rules, checked against the game's own functions on the same inputs.
//
// db/scripts/analysis/economy/ reads most of its numbers straight from db/lib, but some rules it has to restate:
// an average of a range, a duty cycle it simulates, a harvest it multiplies out, a die it enumerates. Each test here
// runs the game's own function on the same inputs and compares, so a mechanic change fails a test rather than quietly
// drifting the report. Where the report imports the game's function outright, one test checks it is the same one.
// Run with `npm test --workspace=db`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO = path.resolve(__dirname, "../..");
const { buildModel } = require("../scripts/analysis/economy/model");
const { entriesOf } = require("../lib/yamlEntries");
const mining = require("../lib/mining");
const soilery = require("../lib/soilery");
const ladder = require("../lib/fatigue");
const constants = require("../lib/constants");
const { taxOn } = require("../lib/trainDeparturePass");
const { crateWeight } = require("../lib/depotCrates");
const carry = require("../lib/carry");
const armor = require("../lib/armorValue");
const { BANDS } = require("../lib/fightingSkill");
const hunger = require("../lib/hunger");
const { expiryFrom } = require("../lib/turnFormat");

const model = buildModel({});
const taxed = buildModel({ sellTax: 25 });
const list = entriesOf(yaml.load(fs.readFileSync(path.join(REPO, "docs/tags.yaml"), "utf8")).tags, "slug");
const get = (slug) => list.find((t) => t.slug === slug);
const schemaDefault = (field) => Number(fs.readFileSync(path.join(REPO, "db/prisma/schema.prisma"), "utf8").match(new RegExp(`\\b${field}\\s+\\w+\\s+@default\\(([-0-9.]+)\\)`))[1]);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Wages, Balance: a press's ⬢ is the middle of the game's own range, plus the pickaxe.
test("mining ⬢ a press is the middle of computeRate's range plus the pickaxe", () => {
  const row = model.activities.find((a) => a.id === "mine:Caves:unskilled");
  const coeff = Math.min(...Object.values(yaml.load(fs.readFileSync(path.join(REPO, "docs/zones.yaml"), "utf8")).zones.underground.levels.caves.locations).filter((l) => typeof l.mining === "number").map((l) => l.mining));
  const r = mining.computeRate(model.params.productionCoefficient, coeff, false);
  assert.ok(close(row.resourcesPerPress, (r.min + r.max) / 2 + (get("pickaxe").miningBonus?.amount ?? 0)));
});

// Wages, Investments: Prospecting's multiplier is the game's constant.
test("the Prospecting multiplier is mining.js's", () => {
  assert.equal(model.params.prospectingMultiplier, mining.PROSPECTING_YIELD_MULTIPLIER);
});

// Wages, Food: a harvest is FARM_PLANTS crops, one Foodstuff each survivor; Fertilizer takes the wither
// die away and doubles a crop 1 time in BOUNTY_IN. Run the game's own reapFoodstuffs with an rng that
// sweeps every face of the die exactly once per WITHER_IN/BOUNTY_IN crops, so the result is the EXACT
// expectation model.js computes analytically, not a sampled approximation.
const cycleRng = (n) => {
  let i = 0;
  return () => (i++ % n) / n;
};
test("a Farm action's harvest follows soilery.js's reapFoodstuffs", () => {
  const plants = model.params.farmMaxCrops;
  const plain = soilery.reapFoodstuffs(plants * soilery.WITHER_IN, cycleRng(soilery.WITHER_IN)) / soilery.WITHER_IN;
  const fert = soilery.reapFoodstuffs(plants * soilery.BOUNTY_IN, cycleRng(soilery.BOUNTY_IN), { fertilized: true }) / soilery.BOUNTY_IN;
  assert.ok(close(model.params.harvestPerFarm, plain));
  assert.ok(close(model.params.harvestPerFarmFert, fert));
});

// Fatigue, and every duty-scaled wage: the simulated steady rate of Mine, against a direct run of the ladder.
test("mining's duty cycle matches a direct run of the fatigue ladder", () => {
  const dur = { [constants.TIRED_SLUG]: get(constants.TIRED_SLUG).durationTurns, [constants.EXHAUSTED_SLUG]: get(constants.EXHAUSTED_SLUG).durationTurns };
  const held = new Map();
  let pressed = 0;
  const N = 200;
  for (let turn = 1; turn <= N; turn++) {
    const slugs = new Set([...held.keys(), constants.PICKAXE_SLUG]);
    if (mining.computeMiningAccess({ tagSlugs: slugs }).ok) {
      pressed++;
      const target = ladder.nextFatigueSlug(new Set(held.has(constants.TIRED_SLUG) ? [constants.TIRED_SLUG] : []));
      if (target) {
        held.delete(constants.TIRED_SLUG);
        if (!held.has(target)) held.set(target, expiryFrom(turn + 1, dur[target]));
      }
    }
    // The close: an expired Exhausted turns into Tired (its expiresInto), anything else expired goes.
    for (const [slug, exp] of [...held]) {
      if (exp <= turn) {
        held.delete(slug);
        for (const next of get(slug).expiresInto ?? []) if (typeof next === "string" && !held.has(next)) held.set(next, expiryFrom(turn + 1, dur[next]));
      }
    }
  }
  assert.ok(Math.abs(pressed / N - model.params.mineDuty) < 0.02, `direct ${pressed / N} against the model's ${model.params.mineDuty}`);
});

// Every net figure, and What the sell tax does: the tax is the game's taxOn on the gross of the sale.
test("a craft's sell tax is trainDeparturePass.taxOn on its gross, and the rounding rule is taxOn's", () => {
  const row = taxed.activities.find((a) => a.kind === "craft" && a.revenue > 0 && !a.ceiling && a.family !== "cooking");
  assert.equal(row.sellTax, taxOn(row.revenue, 25));
  assert.equal(model.sellTax.dodgeBelow, [...Array(100).keys()].map((i) => i + 1).find((r) => taxOn(1, r) > 0));
});

// Transport: a crate weighs what depotCrates.js#crateWeight says.
test("the crated Squeeze load is crateWeight's", () => {
  const sq = model.transport.squeezeFlow;
  assert.equal(sq.cratedLbs, crateWeight([{ tagId: "x", quantity: sq.units }], new Map([["x", sq.unitLbs]])));
});

// Transport, Combining activities: the carry cap and the hard cap are carry.js's at the schema default.
test("the bare carrier's caps are carryCaps and carryHardCaps at the schema default", () => {
  const bare = model.transport.carriers.find((c) => c.label === "Bare");
  const caps = carry.carryCaps({ carryWeightLbs: schemaDefault("carryWeightLbs") });
  assert.equal(bare.cap, caps.weight);
  assert.equal(bare.hard, carry.carryHardCaps(caps).weight);
  assert.equal(model.transport.hardRatio, carry.HARD_CAP_RATIO);
});

// The planner and the mining panel: the free crossings a turn are the schema's.
test("the free zone crossings a turn are GameConfig.freeZoneMovesPerTurn's default", () => {
  assert.equal(model.params.freeZoneMoves, schemaDefault("freeZoneMovesPerTurn"));
});

// Caving, Lucky: the die's faces, and Lucky's, against a seeded run of advantage.js#rollWithAdvantage.
test("the Caving Die's find and trouble odds match a seeded run of rollWithAdvantage", () => {
  const rollPath = require.resolve("../lib/rollDie");
  const advPath = require.resolve("../lib/advantage");
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const saved = Math.random;
  Math.random = rnd;
  delete require.cache[advPath];
  delete require.cache[rollPath];
  try {
    const adv = require(advPath);
    const run = (tags) => {
      const n = 60000;
      let one = 0;
      let six = 0;
      for (let i = 0; i < n; i++) {
        const { die } = adv.rollWithAdvantage(tags);
        if (die === 1) one++;
        if (die === 6) six++;
      }
      return { trouble: one / n, find: six / n };
    };
    const plain = run([]);
    const lucky = run([{ tag: { slug: constants.LUCKY_SLUG } }]);
    assert.ok(Math.abs(plain.trouble - model.caving.faces.base.trouble) < 0.01);
    assert.ok(Math.abs(plain.find - model.caving.faces.base.find) < 0.01);
    assert.ok(Math.abs(lucky.trouble - model.caving.faces.lucky.trouble) < 0.01);
    assert.ok(Math.abs(lucky.find - model.caving.faces.lucky.find) < 0.01);
  } finally {
    Math.random = saved;
    delete require.cache[advPath];
    delete require.cache[rollPath];
  }
});

// Drops, Lucky: the report's Lucky mining columns are the game's two-draw rule, 1 − (1 − p)² for a tier or better.
test("the report's Lucky mining columns keep the rarer of two draws", () => {
  const { PROSPECTING_TABLE, PROSPECTING_SKILLED_WEIGHTS_BY_ZONE } = require("../lib/cavingLoot");
  const top = new Set(PROSPECTING_TABLE["nearly-impossible"]);
  const share = (rows) => rows.filter((r) => top.has(r.slug)).reduce((n, r) => n + r.p, 0);
  const p = PROSPECTING_SKILLED_WEIGHTS_BY_ZONE.depths["nearly-impossible"];
  const drops = model.producerDrops.prospecting.depths;
  assert.ok(Math.abs(share(drops.skilled) - p) < 0.003, `plain ${share(drops.skilled)} against ${p}`);
  assert.ok(Math.abs(share(drops.skilledLucky) - (1 - (1 - p) ** 2)) < 0.003, `lucky ${share(drops.skilledLucky)} against ${1 - (1 - p) ** 2}`);
  assert.ok(model.lucky.uses.some((u) => u.id === "mining-depths-skilled" && u.gain > 0), "the Lucky page prices mining");
});

// Combat, armour kits: a kit's combined figures are combineArmor's on the same pieces.
test("an armour kit's combined values are armorValue.combineArmor's", () => {
  const kit = model.combat.armourKits.kits.find((k) => k.count === 2);
  const rows = kit.pieces.map((name) => list.find((t) => t.name === name)).map((t) => ({ tag: { ballisticArmor: t.ballistic ?? 0, meleeArmor: t.melee ?? 0 }, equipped: true }));
  assert.equal(kit.ballistic, armor.combineArmor(rows, "ballisticArmor"));
  assert.equal(kit.melee, armor.combineArmor(rows, "meleeArmor"));
});

// Combat: the band words are fightingSkill's BANDS, in order.
test("the fighting band words are fightingSkill.js's", () => {
  assert.deepEqual(model.combat.bands, BANDS.map((b) => b.label));
});

// The one food valuation: the Ration Box restores the average of its draws, as hunger.js scores them.
test("the Ration Box's hunger is the average of foodHungerFor over its outcomes", () => {
  const box = get(model.foodFloor.anyone.slug);
  const outs = (box.consumesInto ?? []).flatMap((x) => (typeof x === "string" ? [x] : x.oneOf ?? [x.slug])).map((o) => (typeof o === "string" ? o : o?.slug));
  const avg = outs.reduce((n, o) => n + (o === "nothing" ? 0 : hunger.foodHungerFor(get(o))), 0) / outs.length;
  assert.ok(Math.abs(model.foodFloor.anyone.hunger - avg) < 0.01);
});

// Medicine: the free pool is requests.js's, and every health tag on a rung carries the block the tab shows.
test("the medical free pool and the cure ladder match the catalog", () => {
  const src = fs.readFileSync(path.join(REPO, "web/lib/requests.js"), "utf8");
  assert.equal(model.medical.freePool, Number(src.match(/MEDICAL_SIMPLE_PER_TURN\s*=\s*(\d+)/)[1]));
  const named = new Set([...(fs.readFileSync(path.join(REPO, "docs/systemdocs/TAGS.md"), "utf8").match(/### Named exceptions([\s\S]*?)\n### /)[1].matchAll(/`([a-z-]+)`/g))].map((m) => m[1]));
  for (const t of list.filter((x) => x.category === "health" && Number.isInteger(x.cureRung) && x.cureRung > 0 && x.requirement && x.slug !== "dying" && !named.has(x.slug))) {
    const rung = model.medical.rungs.find((r) => r.rung === t.cureRung);
    assert.equal(t.requirement.resourceCost ?? 0, rung.resources, `${t.slug}: ⬢`);
    assert.equal(t.requirement.turnsCost ?? 0, rung.turns, `${t.slug}: Move share`);
  }
});

// Baselines: Distilling doubles exactly the drinks the game's constant names.
test("Distilling rows exist for DISTILLING_DOUBLES_SLUGS and double the stack", () => {
  const distilled = model.activities.filter((a) => a.distilled);
  assert.deepEqual(new Set(distilled.map((a) => a.slug)), new Set([...constants.DISTILLING_DOUBLES_SLUGS].filter((s) => distilled.some((a) => a.slug === s))));
  for (const d of distilled) {
    const plain = model.activities.find((a) => a.slug === d.slug && !a.distilled && a.kind === "craft");
    assert.ok(close(d.revenue, plain.revenue * 2));
  }
});
