// node --test over db/lib/vampireBloodAbilities.js. Pure and Prisma-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ABILITIES,
  abilityByKey,
  abilityCooldownTurns,
  cooldownReadyTurn,
  isOnCooldown,
} = require("../lib/vampireBloodAbilities");

test("the catalog carries exactly the design doc's ten abilities, each with a positive blood cost", () => {
  assert.equal(ABILITIES.length, 10);
  const keys = ABILITIES.map((a) => a.key);
  assert.deepEqual(
    [...keys].sort(),
    [
      "bat-form",
      "blood-strength",
      "celerity",
      "corrupt",
      "enthral",
      "nourish",
      "obfuscate",
      "regeneration",
      "resilience",
      "solidarity",
    ].sort(),
  );
  for (const ability of ABILITIES) {
    assert.ok(ability.bloodCost > 0, `${ability.key} needs a positive blood cost`);
    assert.ok(ability.cooldownConstant > 0, `${ability.key} needs a positive cooldown constant`);
  }
});

test("abilityByKey finds a real entry and returns null for an unknown one", () => {
  assert.equal(abilityByKey("blood-strength").name, "Blood Strength");
  assert.equal(abilityByKey("not-a-real-ability"), null);
});

test("abilityCooldownTurns multiplies the ability's own constant by the dev-panel variable, rounded", () => {
  const blood = abilityByKey("blood-strength"); // constant 4
  assert.equal(abilityCooldownTurns(blood, 5), 20);
  assert.equal(abilityCooldownTurns(blood, 0), 0);
  const regen = abilityByKey("regeneration"); // constant 2
  assert.equal(abilityCooldownTurns(regen, 5), 10);
  assert.equal(abilityCooldownTurns(regen, 3), 6);
});

test("cooldownReadyTurn/isOnCooldown read the per-character JSON map", () => {
  const cooldowns = { "blood-strength": 42 };
  assert.equal(cooldownReadyTurn(cooldowns, "blood-strength"), 42);
  assert.equal(cooldownReadyTurn(cooldowns, "regeneration"), 0);
  assert.equal(cooldownReadyTurn(null, "blood-strength"), 0);
  assert.equal(isOnCooldown(cooldowns, "blood-strength", 41), true);
  assert.equal(isOnCooldown(cooldowns, "blood-strength", 42), false);
  assert.equal(isOnCooldown(cooldowns, "blood-strength", 43), false);
});

test("Corrupt is the one ability with an item cost, and it names the heart tag", () => {
  const corrupt = abilityByKey("corrupt");
  assert.deepEqual(corrupt.itemCost, { slug: "heart", quantity: 1 });
  assert.equal(corrupt.requiredTagSlug, "corruptor");
});

test("Bat Form is the one ability gated on capacity (ACT)", () => {
  const abilitiesRequiringAct = ABILITIES.filter((a) => a.requiresAct === true);
  assert.deepEqual(abilitiesRequiringAct.map((a) => a.key), ["bat-form"]);
});
