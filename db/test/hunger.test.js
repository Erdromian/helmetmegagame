// node --test over db/lib/hunger.js (the Soilery Rework doc). Pure and
// Prisma-free, same as the module it covers. What matters most: the per-turn
// decay is 17 a day TRUNCATED per turn, the three descriptors are separate
// bands at 100-67 / 66-34 / 33-0, the turn close eats just enough Foodstuffs
// to stay out of Starving, and the Consume slider stops where the doc says.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HUNGER_MAX,
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  AUTO_EAT_FLOOR,
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
  planAutoEat,
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

test("planAutoEat: just enough Foodstuffs to reach 34, or all of them", () => {
  assert.equal(AUTO_EAT_FLOOR, 34);
  assert.equal(planAutoEat(34, 10, 4), 0); // still Hungry
  assert.equal(planAutoEat(33, 10, 4), 1); // 37
  assert.equal(planAutoEat(20, 10, 4), 4); // 36
  assert.equal(planAutoEat(0, 20, 4), 9); // 36
  assert.equal(planAutoEat(0, 3, 4), 3); // not enough: eats what there is
  assert.equal(planAutoEat(10, 0, 4), 0);
});

test("planHunger: a character about to drop into Starving eats and lands in Hungry, with no Starving onset", () => {
  const out = planHunger(
    { hungerValue: 40, heldSlugs: [], foodstuffsHeld: 10 },
    { turnLengthHours: 24, turnNumber: 5 },
  );
  assert.equal(out.decay, 17);
  assert.equal(out.afterDecay, 23);
  assert.equal(out.eat, 3);
  assert.equal(out.final, 35);
  assert.equal(out.band, "hungry");
  assert.equal(out.cross.enteredStarving, false);
  assert.deepEqual(out.notice.kinds, ["autoAte"]);
});

test("planHunger: not enough Foodstuffs still eats them all, and says so", () => {
  const out = planHunger({ hungerValue: 45, heldSlugs: [], foodstuffsHeld: 1 }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(out.eat, 1);
  assert.equal(out.final, 32);
  assert.equal(out.band, "starving");
  assert.deepEqual(out.notice.kinds, ["autoAteShort", "starving"]);
});

test("planHunger: Full to Hungry is told on the close it happens, never forecast", () => {
  const out = planHunger({ hungerValue: 70, heldSlugs: [], foodstuffsHeld: 0 }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(out.final, 53);
  assert.deepEqual(out.notice.kinds, ["hungry"]);
  const quiet = planHunger({ hungerValue: 100, heldSlugs: [], foodstuffsHeld: 0 }, { turnLengthHours: 24, turnNumber: 5 });
  assert.equal(quiet.notice, null);
});

test("planHunger: three closes at 0 grants dying", () => {
  const first = planHunger({ hungerValue: 3, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 10 });
  assert.equal(first.zeroSince, 10);
  assert.equal(first.newlyDying, false);
  const third = planHunger({ hungerValue: 0, starvingSinceTurn: 10, heldSlugs: [] }, { turnLengthHours: 24, turnNumber: 10 + STARVING_DEATH_TURNS - 1 });
  assert.equal(third.newlyDying, true);
  assert.equal(third.notice.justDied, true);
});

test("planHunger: the Hungerless are pinned full and hold no descriptor", () => {
  const out = planHunger({ hungerValue: 10, heldSlugs: ["hungerless"] }, { turnLengthHours: 24, turnNumber: 1 });
  assert.equal(out.final, HUNGER_MAX);
  assert.equal(out.band, null);
  assert.equal(out.eat, 0);
});

test("rawFoodMoodTerms: the flat raw penalty plus the food's own mood", () => {
  assert.deepEqual(rawFoodMoodTerms(0), [{ kind: "RAW_FOOD", base: RAW_FOOD_MOOD, noMultiplier: true }]);
  assert.equal(rawFoodMoodTerms(5).length, 2);
  assert.equal(rawFoodMoodTerms(-5)[1].kind, "DISGUST");
});

test("hungerDm: never a number of hunger points, one DM for several lines", () => {
  const text = hungerDm({ kinds: ["autoAte", "hungry"], eaten: 3 });
  assert.match(text, /ate 3 Foodstuffs/);
  assert.match(text, /\*\*Hungry\*\*/);
  assert.match(hungerDm({ kinds: ["autoAte"], eaten: 1 }), /ate 1 Foodstuff /);
  assert.ok(hungerDm({ kind: "recovered" }));
  assert.equal(hungerDm({ kinds: ["nonsense"] }), null);
  for (const kind of ["hungry", "starving"]) assert.doesNotMatch(hungerDm({ kinds: [kind] }), /\d/);
});
