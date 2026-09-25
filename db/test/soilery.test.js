// node --test over db/lib/soilery.js. Pure and Prisma-free. Covers the Farm
// button's rules after the Soilery Rework: 100 crops, a 1-in-6 wither die per
// crop (real per-unit variance, never a rounded average), one Foodstuff per
// survivor, the Exhausted/Tired refusal, and that the catalog carries the
// tags all of it names.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { FARM_PLANTS, WITHER_IN, reapFoodstuffs, farmDm, farmRefusalFor } = require("../lib/soilery");

test("a farm plants 100 crops", () => {
  assert.equal(FARM_PLANTS, 100);
});

test("reapFoodstuffs: every survivor is exactly one Foodstuff", () => {
  // Never the wither slot (0): everything survives, one each.
  assert.equal(reapFoodstuffs(100, () => 0.99), 100);
});

test("reapFoodstuffs: a rng that always rolls the wither slot loses everything", () => {
  assert.equal(reapFoodstuffs(100, () => 0), 0);
});

test("reapFoodstuffs: planting 0 reaps 0, with no rng calls needed", () => {
  assert.equal(reapFoodstuffs(0, () => { throw new Error("rng should not be called"); }), 0);
});

test("reapFoodstuffs: real per-unit variance — a large sample lands within 3 std dev of 5/6 a crop", () => {
  const planted = 60_000;
  const got = reapFoodstuffs(planted);
  const p = 1 - 1 / WITHER_IN;
  const mean = planted * p;
  const sd = Math.sqrt(planted * p * (1 - p));
  assert.ok(Math.abs(got - mean) < 3 * sd, `got ${got}, expected about ${mean}`);
});

test("farmRefusalFor: needs Soilery, refuses Exhausted AND Tired, and a second action", () => {
  const soiler = [{ tag: { slug: "soilery" } }];
  assert.equal(farmRefusalFor([], false), "You don't know how to farm.");
  assert.equal(farmRefusalFor(soiler, false), null);
  assert.match(farmRefusalFor([...soiler, { tag: { slug: "exhausted" } }], false), /worn out/);
  assert.match(farmRefusalFor([...soiler, { tag: { slug: "tired" } }], false), /worn out/);
  assert.match(farmRefusalFor(soiler, true), /already have an action/);
});

test("farmDm: names what was planted and what came in, in Foodstuffs", () => {
  const dm = farmDm(7, { planted: 100, reaped: 83 });
  assert.match(dm, /turn 7/);
  assert.match(dm, /planted 100 crops and reaped 83 Foodstuffs/);
  assert.match(farmDm(7, { planted: 100, reaped: 1 }), /reaped 1 Foodstuff\./);
  assert.match(farmDm(7, { planted: 100, reaped: 120, fertilized: true }), /richly fed/);
});

test("the catalog: Foodstuffs weigh 1 and restore 4 hunger for -5 mood; the crops, seed bags and licences are gone", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8"));
  const tags = doc.tags ?? doc;
  const foodstuffs = tags.foodstuffs;
  assert.ok(foodstuffs, "docs/tags.yaml has a foodstuffs tag");
  assert.equal(foodstuffs.weight, 1);
  assert.equal(foodstuffs.mealHunger, 4);
  assert.equal(foodstuffs.mealMood, -5);
  // No cooked: block — Foodstuffs are what a meal is cooked FROM, never an extra ingredient.
  assert.equal(foodstuffs.cooked, undefined);
  for (const slug of ["wheat", "potato", "tomato", "carrot", "onion", "plump-helmet", "pigtails", "tobacco"]) {
    assert.equal(tags[slug], undefined, `${slug} is retired`);
    assert.equal(tags[`${slug}-seed-bag`], undefined, `${slug}-seed-bag is retired`);
    assert.equal(tags[`sowing-${slug}`], undefined, `sowing-${slug} is retired`);
  }
  // Exhausted wears off into Tired, which is what makes a farmer farm one turn in three.
  assert.deepEqual([].concat(tags.exhausted.expiresInto), ["tired"]);
});
