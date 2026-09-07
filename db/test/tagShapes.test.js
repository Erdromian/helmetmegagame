// node --test over the medical-pass tag-shape validators in db/lib/tagShapes.js
// (cures, curesInto, administerSkill, resists — M1/M2, docs/systemdocs/
// TAGS.md §5c). Run with `npm test --workspace=db`. Nothing here touches
// Prisma; every validator is pure, taking its "does this slug/category exist"
// answer as a plain Set/Map rather than a live catalog — same posture as
// fear.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCures,
  validateCures,
  normalizeCuresInto,
  validateCuresInto,
  validateAdministerSkill,
  normalizeResists,
  validateResists,
  normalizeTurnsCost,
  validateHealableRequirement,
} = require("../lib/tagShapes");

const knownSlugs = new Set([
  "leeches",
  "bruised",
  "infected",
  "cleaning-powder",
  "medical-expert",
  "iron-constitution",
  "poisoned",
  "shell-shocked",
  "sword",
]);

const categoryBySlug = new Map([
  ["bruised", "Health"],
  ["infected", "Health"],
  ["shell-shocked", "Health"],
  ["poisoned", "Health"],
  ["leeches", "Items"],
  ["cleaning-powder", "Items"],
  ["medical-expert", "Skills"],
  ["sword", "Items"],
]);

test("normalizeCures accepts a list of slugs, dedupes, and rejects garbage shapes", () => {
  assert.equal(normalizeCures(null), null);
  assert.equal(normalizeCures([]), null);
  assert.deepEqual(normalizeCures(["bruised", "bruised", "infected"]), ["bruised", "infected"]);
  assert.throws(() => normalizeCures("bruised"), /cures must be a list/);
  assert.throws(() => normalizeCures([1]), /cures must be a list/);
  assert.throws(() => normalizeCures([""]), /cures must be a list/);
});

test("validateCures refuses an unknown cures target", () => {
  assert.throws(
    () =>
      validateCures(["nonexistent"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: true,
      }),
    /cures references unknown tag "nonexistent"/,
  );
});

test("validateCures refuses a cures target that isn't category Health", () => {
  assert.throws(
    () =>
      validateCures(["sword"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: true,
      }),
    /cures "sword", which isn't a Health tag/,
  );
});

test("validateCures refuses a non-consumable carrier", () => {
  assert.throws(
    () =>
      validateCures(["bruised"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: false,
      }),
    /declares cures but is not consumable/,
  );
});

test("validateCures passes a consumable curing a real Health tag — shell-shocked included, cures is deliberately not gated on healable", () => {
  assert.doesNotThrow(() =>
    validateCures(["bruised", "shell-shocked"], {
      selfSlug: "leeches",
      knownSlugs,
      categoryBySlug,
      consumable: true,
    }),
  );
  // null (no cures declared) is always a no-op, consumable or not.
  assert.doesNotThrow(() => validateCures(null, { selfSlug: "sword", knownSlugs, categoryBySlug, consumable: false }));
});

test("normalizeCuresInto accepts a cured-slug -> aftermath-slug mapping and rejects garbage shapes", () => {
  assert.equal(normalizeCuresInto(null), null);
  assert.equal(normalizeCuresInto({}), null);
  assert.deepEqual(normalizeCuresInto({ "missing-leg": "peg-leg" }), { "missing-leg": "peg-leg" });
  assert.throws(() => normalizeCuresInto(["missing-leg"]), /curesInto must be a mapping/);
  assert.throws(() => normalizeCuresInto({ "missing-leg": 1 }), /must map a cured slug to an aftermath slug/);
  assert.throws(() => normalizeCuresInto({ "": "peg-leg" }), /must map a cured slug to an aftermath slug/);
});

test("validateCuresInto refuses a key outside the tag's own cures list", () => {
  assert.throws(
    () =>
      validateCuresInto(
        { infected: "cleaning-powder" },
        { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
      ),
    /curesInto key "infected" isn't in its own cures list/,
  );
});

test("validateCuresInto refuses an unknown aftermath slug", () => {
  assert.throws(
    () =>
      validateCuresInto(
        { bruised: "nonexistent" },
        { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
      ),
    /curesInto references unknown tag "nonexistent"/,
  );
});

test("validateCuresInto passes a key that IS in cures, mapping to a real tag", () => {
  assert.doesNotThrow(() =>
    validateCuresInto(
      { bruised: "cleaning-powder" },
      { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
    ),
  );
});

test("validateAdministerSkill: null is a no-op, a known slug passes, an unknown slug or a non-string is refused", () => {
  assert.doesNotThrow(() => validateAdministerSkill(null, { knownSlugs, selfSlug: "wooden-leg" }));
  assert.doesNotThrow(() => validateAdministerSkill("medical-expert", { knownSlugs, selfSlug: "wooden-leg" }));
  assert.throws(
    () => validateAdministerSkill("nonexistent", { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill references unknown tag "nonexistent"/,
  );
  assert.throws(
    () => validateAdministerSkill(3, { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill must be a single tag slug/,
  );
  assert.throws(
    () => validateAdministerSkill("", { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill must be a single tag slug/,
  );
});

test("normalizeResists accepts a list of slugs, dedupes, and rejects garbage shapes", () => {
  assert.equal(normalizeResists(null), null);
  assert.equal(normalizeResists([]), null);
  assert.deepEqual(normalizeResists(["poisoned", "poisoned"]), ["poisoned"]);
  assert.throws(() => normalizeResists("poisoned"), /resists must be a list/);
  assert.throws(() => normalizeResists([1]), /resists must be a list/);
});

test("validateResists refuses an unknown slug and passes a known one or null", () => {
  assert.throws(
    () => validateResists(["nonexistent"], { selfSlug: "iron-constitution", knownSlugs }),
    /resists references unknown tag "nonexistent"/,
  );
  assert.doesNotThrow(() => validateResists(["poisoned"], { selfSlug: "iron-constitution", knownSlugs }));
  assert.doesNotThrow(() => validateResists(null, { selfSlug: "iron-constitution", knownSlugs }));
});

// normalizeTurnsCost (M2, the arithmetic the whole Move economy rests on):
// a whole-number turnsCost, the "1/N" fraction encoding (requirementTurns 1
// + requirementPerTurn N), the perTurn/0-turn-ration pairing rule, and the
// healable-must-author-one guard added in the round-3 review.
test("normalizeTurnsCost accepts a whole-number turnsCost, and null when unset", () => {
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 0 }, { slug: "infected" }), {
    requirementTurns: 0,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 1 }, { slug: "sepsis" }), {
    requirementTurns: 1,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 3 }, { slug: "phrygian-tears" }), {
    requirementTurns: 3,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({}, { slug: "sword" }), {
    requirementTurns: null,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost(null, { slug: "sword" }), {
    requirementTurns: null,
    requirementPerTurn: null,
  });
});

test("normalizeTurnsCost parses the 1/N fraction into requirementTurns 1 + requirementPerTurn N", () => {
  assert.deepEqual(normalizeTurnsCost({ turnsCost: "1/3" }, { slug: "deep-wound" }), {
    requirementTurns: 1,
    requirementPerTurn: 3,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: "1/2" }, { slug: "feverish" }), {
    requirementTurns: 1,
    requirementPerTurn: 2,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: "1/8" }, { slug: "x" }), {
    requirementTurns: 1,
    requirementPerTurn: 8,
  });
  // Whitespace-tolerant, same as every other YAML scalar this sync reads.
  assert.deepEqual(normalizeTurnsCost({ turnsCost: " 1/4 " }, { slug: "x" }), {
    requirementTurns: 1,
    requirementPerTurn: 4,
  });
});

test("normalizeTurnsCost refuses a garbage turnsCost and a 1/1 or 1/0-shaped fraction", () => {
  assert.throws(
    () => normalizeTurnsCost({ turnsCost: "half" }, { slug: "x" }),
    /turnsCost must be a whole number of Moves or a "1\/N" fraction/,
  );
  assert.throws(() => normalizeTurnsCost({ turnsCost: "1/1" }, { slug: "x" }), /turnsCost must be/);
  assert.throws(() => normalizeTurnsCost({ turnsCost: "1/0" }, { slug: "x" }), /turnsCost must be/);
  assert.throws(() => normalizeTurnsCost({ turnsCost: -1 }, { slug: "x" }), /turnsCost must be/);
});

test("normalizeTurnsCost's perTurn is a 0-turn ration only — pairing it with a Move cost is refused", () => {
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 0, perTurn: 4 }, { slug: "x" }), {
    requirementTurns: 0,
    requirementPerTurn: 4,
  });
  assert.throws(
    () => normalizeTurnsCost({ turnsCost: 1, perTurn: 3 }, { slug: "x" }),
    /sets perTurn on a recipe that costs a Move/,
  );
  assert.throws(
    () => normalizeTurnsCost({ perTurn: 0 }, { slug: "x" }),
    /requirement.perTurn must be a positive integer/,
  );
});

test("normalizeTurnsCost refuses a healable tag with no turnsCost at all, and passes one authored explicitly", () => {
  assert.throws(
    () => normalizeTurnsCost({}, { slug: "new-wound", healable: true }),
    /"new-wound" is healable but requirement\.turnsCost is missing/,
  );
  assert.throws(
    () => normalizeTurnsCost(null, { slug: "new-wound", healable: true }),
    /is healable but requirement\.turnsCost is missing/,
  );
  // A non-healable tag with no turnsCost is unaffected — that's the ordinary
  // "no Move cost at all" case most of the catalog uses.
  assert.doesNotThrow(() => normalizeTurnsCost({}, { slug: "sword", healable: false }));
  assert.doesNotThrow(() => normalizeTurnsCost({}, { slug: "sword" }));
  // Explicit 0 satisfies the guard just as well as a real cost.
  assert.doesNotThrow(() => normalizeTurnsCost({ turnsCost: 0 }, { slug: "new-wound", healable: true }));
  assert.doesNotThrow(() => normalizeTurnsCost({ turnsCost: "1/3" }, { slug: "new-wound", healable: true }));
});

test("validateHealableRequirement mirrors normalizeTurnsCost's guard for the GM form's already-parsed requirementTurns", () => {
  assert.throws(
    () => validateHealableRequirement(null, { healable: true, selfSlug: "custom-wound" }),
    /"custom-wound" is healable but requirementTurns is blank/,
  );
  assert.doesNotThrow(() => validateHealableRequirement(0, { healable: true, selfSlug: "custom-wound" }));
  assert.doesNotThrow(() => validateHealableRequirement(2, { healable: true, selfSlug: "custom-wound" }));
  assert.doesNotThrow(() => validateHealableRequirement(null, { healable: false, selfSlug: "custom-sword" }));
});
