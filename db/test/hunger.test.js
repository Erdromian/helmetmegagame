// node --test over db/lib/hunger.js (the Soilery Rework doc). Pure and
// Prisma-free, same as the module it covers. What matters most: the per-turn
// decay is 17 a day TRUNCATED per turn, the three descriptors are separate
// bands at 100-67 / 66-34 / 33-0, the turn close eats just enough Foodstuffs
// to stay out of Starving and anything better only to stay above 0, and the
// Consume slider stops where the doc says.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HUNGER_MAX,
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  AUTO_EAT_FLOOR,
  STAY_ALIVE_FLOOR,
  RAW_FOOD_MOOD,
  STARVING_DEATH_TURNS,
  DESCRIPTORS,
  clampHunger,
  bandOf,
  perTurnDecay,
  decayFor,
  crossings,
  hungerDescriptorFor,
  foodHungerFor,
  unitHungerFor,
  eatMaxFor,
  foodMoodFor,
  autoEdible,
  tastiestFirst,
  AUTO_EAT_MOOD_FLOOR,
  planAutoMeals,
  planHunger,
  rawFoodMoodTerms,
  hungerDm,
} = require("../lib/hunger");

test("clampHunger holds the meter inside 0-100", () => {
  assert.equal(clampHunger(-5), 0);
  assert.equal(clampHunger(0), 0);
  assert.equal(clampHunger(HUNGER_MAX + 3), HUNGER_MAX);
  assert.equal(clampHunger(94.4), 94);
});

test("17 a day, split over the day's turns and truncated", () => {
  assert.equal(perTurnDecay(17, 24), 17);
  assert.equal(perTurnDecay(17, 12), 8); // 8.5
  assert.equal(perTurnDecay(17, 8), 5); // 5.67
  assert.equal(perTurnDecay(17, 6), 4); // 4.25
  assert.equal(perTurnDecay(17, undefined), 17); // no length on the turn reads as a day
});

test("decayFor: Big Appetite burns 24 a day, Hungerless nothing", () => {
  assert.deepEqual([24, 12, 8, 6].map((h) => decayFor([], h)), [17, 8, 5, 4]);
  assert.deepEqual([24, 12, 8, 6].map((h) => decayFor(["fast-metabolism"], h)), [24, 12, 8, 6]);
  assert.equal(decayFor(["hungerless"], 24), 0);
  assert.equal(decayFor(new Set(["hungerless", "fast-metabolism"]), 24), 0);
});

test("turnsPerDay set: the day's 17 splits over that many turns, rounded up, whatever their length", () => {
  assert.deepEqual([1, 2, 3, 4, 24].map((n) => perTurnDecay(17, 24, n)), [17, 9, 6, 5, 1]);
  assert.equal(perTurnDecay(17, 6, 2), 9); // the length no longer matters
  assert.equal(perTurnDecay(17, 12, 0), 8); // 0 is the calendar day, truncated as before
  assert.deepEqual([2, 5].map((n) => decayFor(["fast-metabolism"], 24, n)), [12, 5]);
  assert.equal(decayFor(["hungerless"], 24, 2), 0);
  const out = planHunger({ hungerValue: 100, heldSlugs: [] }, { turnLengthHours: 24, turnsPerDay: 2, turnNumber: 1 });
  assert.equal(out.decay, 9);
  assert.equal(out.final, 91);
});

test("the three bands are separate: Full 100-67, Hungry 66-34, Starving 33-0", () => {
  assert.equal(HUNGRY_THRESHOLD, 66);
  assert.equal(STARVING_THRESHOLD, 33);
  for (const [v, band] of [[100, "full"], [67, "full"], [66, "hungry"], [34, "hungry"], [33, "starving"], [0, "starving"]]) {
    assert.equal(bandOf(v), band, `${v}`);
  }
});

test("the descriptors carry the doc's own words", () => {
  assert.equal(DESCRIPTORS.full.line, "You aren't particularly hungry right now.");
  assert.equal(DESCRIPTORS.hungry.line, "You could really go for something to eat…");
  assert.equal(DESCRIPTORS.starving.line, "You are starving to death! If you do not eat soon, you will perish.");
});

test("hungerDescriptorFor: the held tag wins, the meter is the fallback, the Hungerless get none", () => {
  assert.equal(hungerDescriptorFor({ heldSlugs: ["hungry"], hungerValue: 100 }).word, "Hungry");
  assert.equal(hungerDescriptorFor({ heldSlugs: [], hungerValue: 20 }).word, "Starving");
  assert.equal(hungerDescriptorFor({ heldSlugs: ["hungerless", "full"], hungerValue: 100 }), null);
});

test("crossings: each band fires once, on the close that crosses it", () => {
  assert.deepEqual(crossings(70, 60), { enteredHungry: true, enteredStarving: false, leftHungry: false, leftStarving: false });
  assert.equal(crossings(60, 50).enteredHungry, false);
  assert.equal(crossings(40, 30).enteredStarving, true);
  const both = crossings(70, 20);
  assert.ok(both.enteredHungry && both.enteredStarving);
  assert.ok(crossings(30, 70).leftStarving && crossings(30, 70).leftHungry);
});

test("foodHungerFor: mealHunger, then cooked.hunger, then nothing", () => {
  assert.equal(foodHungerFor({ mealHunger: 15, cooked: { hunger: 4 } }), 15);
  assert.equal(foodHungerFor({ cooked: { hunger: 12 } }), 12);
  assert.equal(foodHungerFor({ consumesInto: ["ate-meal"] }), 0); // no fallback any more
  assert.equal(foodHungerFor({ cooked: { hunger: 0 } }), 0);
  assert.equal(foodHungerFor(null), 0);
});

test("unitHungerFor: a meal is its class figure plus every extra ingredient", () => {
  assert.equal(unitHungerFor({ mealHunger: 20 }, [{ cooked: { hunger: 12 } }, { cooked: { hunger: 6 } }]), 38);
  assert.equal(unitHungerFor({ mealHunger: 4 }), 4);
});

test("eatMaxFor: what you hold, or what fills you, whichever is lower — the last one may overshoot", () => {
  assert.equal(eatMaxFor({ hungerValue: 90, perUnit: 4, held: 10 }), 3); // 90→94→98→102
  assert.equal(eatMaxFor({ hungerValue: 90, perUnit: 4, held: 2 }), 2);
  assert.equal(eatMaxFor({ hungerValue: 99, perUnit: 20, held: 5 }), 1);
  assert.equal(eatMaxFor({ hungerValue: 100, perUnit: 4, held: 5 }), 0);
});

test("eatMaxFor: a Glutton and the Hungerless eat on at 100, and non-food is never capped by hunger", () => {
  assert.equal(eatMaxFor({ hungerValue: 100, perUnit: 4, held: 5, glutton: true }), 5);
  assert.equal(eatMaxFor({ hungerValue: 100, perUnit: 4, held: 5, hungerless: true }), 5);
  assert.equal(eatMaxFor({ hungerValue: 100, perUnit: 0, held: 5 }), 5);
});

// A carried food as the pass hands it to the planner.
const food = (slug, quantity, hunger, mood, name = slug) => ({ tagId: `id-${slug}`, slug, name, quantity, hunger, mood });
const FOODSTUFFS = (n) => food("foodstuffs", n, 4, -5, "Foodstuffs");

test("planAutoMeals: just enough to reach 34, or all there is", () => {
  assert.equal(AUTO_EAT_FLOOR, 34);
  const count = (v, n) => planAutoMeals(v, [FOODSTUFFS(n)]).reduce((a, m) => a + m.count, 0);
  assert.equal(count(34, 10), 0); // still Hungry
  assert.equal(count(33, 10), 1); // 37
  assert.equal(count(20, 10), 4); // 36
  assert.equal(count(0, 20), 9); // 36
  assert.equal(count(0, 3), 3); // not enough: eats what there is
  assert.equal(count(10, 0), 0);
});

test("planAutoMeals: Foodstuffs keep you out of Starving; a meal is left alone while you are alive", () => {
  const lavish = food("lavish", 1, 40, 30, "Lavish Meal");
  const cheese = food("cheese", 2, 12, 5);
  const meals = planAutoMeals(20, [FOODSTUFFS(10), lavish, cheese]);
  assert.deepEqual(meals.map((m) => [m.slug, m.count]), [["foodstuffs", 4]]); // 36
  // No Foodstuffs, starving but above 0: nothing else is touched.
  assert.deepEqual(planAutoMeals(1, [lavish, cheese]), []);
  assert.deepEqual(planAutoMeals(33, [lavish, cheese]), []);
});

test("planAutoMeals: at 0, anything else is eaten, tastiest first, just enough to stay alive", () => {
  assert.equal(STAY_ALIVE_FLOOR, 1);
  const lavish = food("lavish", 1, 40, 30, "Lavish Meal");
  const cheese = food("cheese", 2, 12, 5);
  assert.deepEqual(planAutoMeals(0, [lavish, cheese]).map((m) => [m.slug, m.count]), [["lavish", 1]]);
  assert.deepEqual(planAutoMeals(0, [cheese]).map((m) => [m.slug, m.count]), [["cheese", 1]]);
  // Foodstuffs go first, and only if they run out at 0 does anything else follow.
  assert.deepEqual(planAutoMeals(0, [FOODSTUFFS(20), lavish]).map((m) => [m.slug, m.count]), [["foodstuffs", 9]]);
  assert.deepEqual(planAutoMeals(0, [FOODSTUFFS(3), lavish]).map((m) => [m.slug, m.count]), [["foodstuffs", 3]]); // 12: alive
  assert.deepEqual(planAutoMeals(0, [FOODSTUFFS(0), lavish]).map((m) => [m.slug, m.count]), [["lavish", 1]]);
});

test("planAutoMeals: even starving to death, nothing below the mood floor is eaten", () => {
  assert.ok(AUTO_EAT_MOOD_FLOOR <= -10); // Moldy Bread still counts
  const meals = planAutoMeals(0, [food("human-flesh", 5, 18, -50), food("moldy-bread", 1, 6, -10)]);
  assert.deepEqual(meals.map((m) => m.slug), ["moldy-bread"]);
  assert.deepEqual(planAutoMeals(0, [food("human-flesh", 5, 18, -50)]), []);
});

test("planHunger: a character about to drop into Starving eats and lands in Hungry, with no Starving onset", () => {
  const out = planHunger(
    { hungerValue: 40, heldSlugs: [], foods: [FOODSTUFFS(10)] },
    { turnLengthHours: 24, turnNumber: 5 },
  );
  assert.equal(out.decay, 17);
  assert.equal(out.afterDecay, 23);
  assert.equal(out.eaten, 3);
  assert.equal(out.final, 35);
  assert.equal(out.band, "hungry");
  assert.equal(out.cross.enteredStarving, false);
  assert.deepEqual(out.notice.kinds, ["autoAte"]);
  assert.deepEqual(out.notice.ate, [{ slug: "foodstuffs", name: "Foodstuffs", count: 3 }]);
});

test("planHunger: not enough food still eats it all, and says so", () => {
  const out = planHunger({ hungerValue: 45, heldSlugs: [], foods: [FOODSTUFFS(1)] }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(out.eaten, 1);
  assert.equal(out.final, 32);
  assert.equal(out.band, "starving");
  assert.deepEqual(out.notice.kinds, ["autoAteShort", "starving"]);
});

test("autoEdible: only plain food — nothing that grants, cures or needs a skill", () => {
  const cheese = { consumable: true, consumesInto: [], cooked: { hunger: 12, mood: 15 } };
  assert.equal(autoEdible(cheese), true);
  assert.equal(autoEdible({ ...cheese, consumable: false }), false);
  assert.equal(autoEdible({ consumable: true, consumesInto: [] }), false); // not food
  assert.equal(autoEdible({ ...cheese, consumesInto: ["nauseous"] }), false); // Dustfish
  assert.equal(autoEdible({ ...cheese, cures: ["bruised"] }), false);
  assert.equal(autoEdible({ ...cheese, administerSkill: "medical-expert" }), false);
  const stew = { consumable: true, consumesInto: [], mealHunger: 15, mealMood: 2, cookedFrom: ["x"] };
  assert.equal(autoEdible(stew, [cheese]), true);
  // Human Flesh in a stew: its cooked.into makes the stew nauseating.
  assert.equal(autoEdible(stew, [{ ...cheese, cooked: { hunger: 18, mood: -40, into: [{ oneOf: ["nauseous", "vomiting"] }] } }]), false);
  // A raw ingredient with no cooked.into still carries its own consumesInto into the pot.
  assert.equal(autoEdible(stew, [{ ...cheese, consumesInto: ["dark-inspiration"] }]), false);
  // A curative ingredient only cures in a dish when it opted in.
  assert.equal(autoEdible(stew, [{ ...cheese, cures: ["bruised"] }]), true);
  assert.equal(autoEdible(stew, [{ ...cheese, cures: ["bruised"], cooked: { ...cheese.cooked, cures: true } }]), false);
});

test("foodMoodFor: a dish sums its figures, raw food pays the raw penalty", () => {
  assert.equal(foodMoodFor({ mealMood: 12 }, [{ cooked: { mood: 45 } }, { cooked: { mood: -15 } }]), 42);
  assert.equal(foodMoodFor({ mealMood: -5 }), -5); // Foodstuffs
  assert.equal(foodMoodFor({ cooked: { mood: 28 } }), RAW_FOOD_MOOD + 28); // Fish Roe, raw
});

test("tastiestFirst: most mood, then most filling", () => {
  const order = tastiestFirst([food("a", 1, 10, 5), food("b", 1, 20, 5), food("c", 1, 4, 30), food("gone", 0, 50, 99)]);
  assert.deepEqual(order.map((f) => f.slug), ["c", "b", "a"]);
});

test("planHunger: nobody Hungry or Full eats a meal unasked, Glutton or not", () => {
  const foods = [FOODSTUFFS(5), food("lavish", 1, 40, 30, "Lavish Meal")];
  for (const [hungerValue, heldSlugs] of [[70, []], [100, ["glutton"]], [60, ["glutton"]]]) {
    const out = planHunger({ hungerValue, heldSlugs, foods }, { turnLengthHours: 24, turnNumber: 5 });
    assert.equal(out.eaten, 0);
  }
});

test("planHunger: starving with only a meal, it is eaten the close the meter would reach 0, and not before", () => {
  const foods = [food("lavish", 1, 40, 30, "Lavish Meal")];
  const still = planHunger({ hungerValue: 20, heldSlugs: [], foods }, { turnLengthHours: 24, turnNumber: 10 });
  assert.equal(still.eaten, 0);
  assert.equal(still.final, 3);
  const saved = planHunger({ hungerValue: 3, heldSlugs: [], foods }, { turnLengthHours: 24, turnNumber: 11 });
  assert.deepEqual(saved.meals.map((m) => [m.slug, m.count]), [["lavish", 1]]);
  assert.equal(saved.final, 40);
  assert.equal(saved.newlyDying, false);
  assert.deepEqual(saved.notice.kinds, ["autoAteToLive"]);
});

test("planHunger: Full to Hungry is told on the close it happens, never forecast", () => {
  const out = planHunger({ hungerValue: 70, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(out.final, 53);
  assert.deepEqual(out.notice.kinds, ["hungry"]);
  const quiet = planHunger({ hungerValue: 100, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(quiet.notice, null);
});

test("planHunger: the close that reaches 0 grants dying", () => {
  assert.equal(STARVING_DEATH_TURNS, 1);
  const first = planHunger({ hungerValue: 3, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 10 });
  assert.equal(first.zeroSince, 10);
  assert.equal(first.newlyDying, true);
  assert.equal(first.notice.justDied, true);
  assert.ok(first.notice.kinds.includes("starving"));
  const above = planHunger({ hungerValue: 20, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 10 });
  assert.equal(above.final, 3);
  assert.equal(above.newlyDying, false);
});

test("planHunger: eating off the last Foodstuffs to stay above 0 is not dying", () => {
  const out = planHunger({ hungerValue: 10, heldSlugs: [], foods: [FOODSTUFFS(1)] }, { turnLengthHours: 24, turnNumber: 10 });
  assert.equal(out.final, 4);
  assert.equal(out.newlyDying, false);
});

test("planHunger: the Hungerless are pinned full and hold no descriptor", () => {
  const out = planHunger({ hungerValue: 10, heldSlugs: ["hungerless"] }, { turnLengthHours: 24, turnNumber: 1 });
  assert.equal(out.final, HUNGER_MAX);
  assert.equal(out.band, null);
  assert.equal(out.eaten, 0);
});

test("rawFoodMoodTerms: the flat raw penalty plus the food's own mood", () => {
  assert.deepEqual(rawFoodMoodTerms(0), [{ kind: "RAW_FOOD", base: RAW_FOOD_MOOD, noMultiplier: true }]);
  assert.equal(rawFoodMoodTerms(5).length, 2);
  assert.equal(rawFoodMoodTerms(-5)[1].kind, "DISGUST");
});

test("hungerDm: never a number of hunger points, one DM for several lines", () => {
  const stuffs = (count) => ({ slug: "foodstuffs", name: "Foodstuffs", count });
  const text = hungerDm({ kinds: ["autoAte", "hungry"], ate: [stuffs(3)] });
  assert.match(text, /ate 3 Foodstuffs/);
  assert.match(text, /\*\*Hungry\*\*/);
  assert.match(hungerDm({ kinds: ["autoAte"], ate: [stuffs(1)] }), /ate 1 Foodstuff /);
  assert.equal(
    hungerDm({ kinds: ["autoAte"], ate: [stuffs(3)] }),
    "You were about to starve, so you ate 3 Foodstuffs from your pack.",
  );
  assert.equal(
    hungerDm({ kinds: ["autoAteToLive"], ate: [stuffs(2), { slug: "x", name: "Saffron Stew", count: 1 }, { slug: "c", name: "Cheese", count: 2 }] }),
    "You were starving to death, so you ate 2 Foodstuffs, your Saffron Stew and 2 of your Cheese to stay alive.",
  );
  assert.ok(hungerDm({ kind: "recovered" }));
  assert.equal(hungerDm({ kinds: ["nonsense"] }), null);
  for (const kind of ["hungry", "starving"]) assert.doesNotMatch(hungerDm({ kinds: [kind] }), /\d/);
});
