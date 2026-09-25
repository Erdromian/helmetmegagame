// node --test over db/lib/meals.js — the meal classes' naming rules (the
// Soilery Rework doc; COOKING.md), and that the catalog's three templates say
// what the doc's Meal Classes table says.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  MEAL_CLASSES,
  MEAL_TASTES,
  cleanMealName,
  decorateMealName,
  cleanMealTaste,
  isLavish,
  needsKitchen,
} = require("../lib/meals");

test("a meal's name is letters only, single spaces between words, 30 at most", () => {
  assert.equal(cleanMealName("Scones"), "Scones");
  assert.equal(cleanMealName("  Meat   Pie "), "Meat Pie");
  assert.equal(cleanMealName("Stew2"), null);
  assert.equal(cleanMealName("+Scones+"), null);
  assert.equal(cleanMealName("*Caviar*"), null);
  assert.equal(cleanMealName("Mum's Pie"), null);
  assert.equal(cleanMealName(""), null);
  assert.equal(cleanMealName("   "), null);
  assert.equal(cleanMealName("A".repeat(31)), null);
  assert.equal(cleanMealName(null), null);
});

test("the class's symbols go either side of the name", () => {
  assert.equal(decorateMealName("BASIC", "Stew"), "Stew");
  assert.equal(decorateMealName("SKILLED", "Scones"), "+Scones+");
  assert.equal(decorateMealName("LAVISH", "Caviar"), "*Caviar*");
});

test("only a Lavish meal is italic and needs a kitchen", () => {
  assert.ok(isLavish({ mealClass: "LAVISH" }));
  assert.ok(!isLavish({ mealClass: "SKILLED" }));
  assert.ok(needsKitchen({ mealClass: "LAVISH" }));
  assert.ok(!needsKitchen({ mealClass: "BASIC" }));
  assert.ok(!needsKitchen({}));
});

test("a base taste is one of the fixed list, or none", () => {
  assert.equal(cleanMealTaste("earthy"), "earthy");
  assert.equal(cleanMealTaste("like despair"), "");
  assert.equal(cleanMealTaste(undefined), "");
  assert.ok(MEAL_TASTES.every((t) => /^[a-z]+$/.test(t)));
});

test("the catalog's templates match the doc's Meal Classes table", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8"));
  const tags = doc.tags ?? doc;
  const want = {
    BASIC: { skill: "cooking-basic", foodstuffs: 2, hunger: 15, mood: 2, turns: 0.05, min: 0 },
    SKILLED: { skill: "cooking-skilled", foodstuffs: 2, hunger: 18, mood: 6, turns: 0.1, min: 0 },
    LAVISH: { skill: "cooking-skilled", foodstuffs: 3, hunger: 20, mood: 12, turns: 0.2, min: 1 },
  };
  for (const [cls, w] of Object.entries(want)) {
    const t = tags[MEAL_CLASSES[cls].slug];
    assert.ok(t, `${MEAL_CLASSES[cls].slug} exists`);
    assert.equal(t.mealClass, cls.toLowerCase());
    assert.deepEqual(t.requirement.skills, [w.skill]);
    assert.deepEqual(t.requirement.items, [{ tag: "foodstuffs", count: w.foodstuffs }]);
    assert.equal(t.mealHunger, w.hunger);
    assert.equal(t.mealMood, w.mood);
    assert.equal(t.requirement.turnsCost, w.turns);
    assert.equal(t.requirement.ingredientSlots.min, w.min);
  }
});
