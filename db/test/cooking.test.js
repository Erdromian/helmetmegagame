// node --test over the pure half of the cooking rework (COOKING.md): the
// `cooked` / `ingredientSlots` / `custom` normalizers in db/lib/tagShapes.js
// and dishMoodTerms in db/lib/mood.js. web/lib/cooking.js is not reachable
// from this workspace, so tasteLine is exercised by hand instead.
// Run with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COOKED_TASTE_MAX,
  INGREDIENT_SLOTS_MAX,
  normalizeCooked,
  validateCooked,
  normalizeIngredientSlots,
  validateIngredientSlots,
  normalizeCustom,
} = require("../lib/tagShapes");
const { dishMoodTerms, MOOD_MAX, MOOD_MIN } = require("../lib/mood");

// The sync hands its own consumesInto parser in; this stands in for it, in
// the same normalised quad shape validateCooked reads.
const intoStub = (entries) =>
  (entries ?? []).map((e) =>
    typeof e === "string"
      ? { slug: e, oneOf: null }
      : Array.isArray(e?.oneOf)
        ? { slug: e.oneOf[0], oneOf: [...e.oneOf] }
        : { slug: e.slug, oneOf: null },
  );

const cook = (cooked, slug = "onion") => normalizeCooked(cooked, { slug, normalizeInto: intoStub });

// --- cooked ---------------------------------------------------------------

test("a cooked block normalises to a taste, a mood and an optional into", () => {
  assert.deepEqual(cook({ taste: "onions", mood: 8 }), {
    taste: "onions",
    mood: 8,
    into: null,
  });
  // An absent mood is 0, not a refusal: rock salt tastes of something and
  // moves nobody's dial.
  assert.deepEqual(cook({ taste: "salt" }), { taste: "salt", mood: 0, into: null });
  // No block at all stays null — most of the catalog is not an ingredient.
  assert.equal(cook(null), null);
});

test("into runs through the caller's own consumesInto parser", () => {
  const { into } = cook({ taste: "meat", mood: -40, into: [{ oneOf: ["nauseous", "vomiting"] }] });
  assert.deepEqual(into, [{ slug: "nauseous", oneOf: ["nauseous", "vomiting"] }]);
});

test("an absent into is inheritance, not emptiness", () => {
  // The distinction the whole medical hand-off rests on: null means "use my
  // own consumesInto, live, at the moment somebody eats this", and an
  // authored [] means "contribute nothing". They must not collapse.
  assert.equal(cook({ taste: "medicine", mood: 15 }).into, null);
  assert.deepEqual(cook({ taste: "deep morel", mood: 18, into: [] }).into, []);
});

test("a cooked block without a taste is refused", () => {
  assert.throws(() => cook({ mood: 8 }), /needs a taste/);
  assert.throws(() => cook({ taste: 3, mood: 8 }), /needs a taste/);
});

test("an empty taste is legal, and is the undetectable poison", () => {
  // Phrygian Tears. The key is still required, so `taste: ""` is a claim
  // somebody made rather than a field somebody forgot.
  assert.deepEqual(cook({ taste: "", mood: 0 }), { taste: "", mood: 0, into: null });
  assert.deepEqual(cook({ taste: "   ", mood: 0 }).taste, "");
});

test("a taste longer than the line it sits in is refused", () => {
  assert.throws(() => cook({ taste: "x".repeat(COOKED_TASTE_MAX + 1) }), /keep it under/);
  assert.doesNotThrow(() => cook({ taste: "x".repeat(COOKED_TASTE_MAX) }));
});

test("a ‡ in a taste is refused — the composed line wears the mark", () => {
  assert.throws(() => cook({ taste: "onions ‡", mood: 8 }), /composed line/);
});

test("a cooked mood off either end of the dial is refused", () => {
  assert.throws(() => cook({ taste: "x", mood: MOOD_MAX + 1 }), /the dial runs/);
  assert.throws(() => cook({ taste: "x", mood: MOOD_MIN - 1 }), /the dial runs/);
  assert.throws(() => cook({ taste: "x", mood: "lots" }), /must be a number/);
  assert.doesNotThrow(() => cook({ taste: "x", mood: MOOD_MAX }));
  assert.doesNotThrow(() => cook({ taste: "x", mood: MOOD_MIN }));
});

test("cookable and edible are different claims", () => {
  // Nobody gnaws a raw hand, and a hand in a stew is very much a thing that
  // can happen. The six body parts are not consumable and carry cooked
  // blocks; refusing that would have meant making them edible off the sheet.
  const c = cook({ taste: "meat", mood: -40 }, "hand");
  assert.doesNotThrow(() => validateCooked(c, { selfSlug: "hand", tagSlugs: new Set() }));
});

test("every slug a cooked block grants must exist", () => {
  const c = cook({ taste: "meat", mood: -40, into: [{ oneOf: ["nauseous", "vomiting"] }] });
  assert.throws(
    () => validateCooked(c, { selfSlug: "foot", tagSlugs: new Set(["nauseous"]), consumable: true }),
    /unknown tag "vomiting"/,
  );
  assert.doesNotThrow(() =>
    validateCooked(c, { selfSlug: "foot", tagSlugs: new Set(["nauseous", "vomiting"]) }),
  );
});

// --- cooked.cures (the medical hand-off, COOKING.md §5) --------------------

test("cooked.cures is opt-in, stored only when true", () => {
  // Absent and false are the same claim, so only true is written out — a
  // column of `cures: false` across fifty blocks that will never carry a
  // cure is noise.
  assert.equal("cures" in cook({ taste: "x", mood: 0 }), false);
  assert.equal("cures" in cook({ taste: "x", mood: 0, cures: false }), false);
  assert.equal(cook({ taste: "medicine", mood: 15, cures: true }).cures, true);
});

test("cooked.cures must be a boolean, not a list of cures", () => {
  // The near-miss worth catching: it says WHETHER this ingredient's own
  // cures survive the pot, never WHICH — the cures themselves live on
  // Tag.cures and are the medical pass's to author.
  assert.throws(() => cook({ taste: "x", mood: 0, cures: ["poisoned"] }), /must be true or false/);
});

test("a cure a doctor has to fit does not travel in a stew", () => {
  // administerSkill is exactly the set of cures somebody puts ON or INTO a
  // patient — the prosthetics, the autoinjectors. Cooking a wooden leg into
  // dinner ruins the dinner.
  const c = cook({ taste: "wood", mood: -20, cures: true }, "wooden-leg");
  assert.throws(
    () =>
      validateCooked(c, {
        selfSlug: "wooden-leg",
        tagSlugs: new Set(),
        entry: { cures: ["missing-leg"], administerSkill: "medical-expert" },
      }),
    /does not travel in a stew/,
  );
});

test("cooked.cures on something that cures nothing is a slip", () => {
  const c = cook({ taste: "onions", mood: 5, cures: true }, "onion");
  assert.throws(
    () => validateCooked(c, { selfSlug: "onion", tagSlugs: new Set(), entry: {} }),
    /cures nothing/,
  );
});

test("a drunk tonic opts in cleanly", () => {
  const c = cook({ taste: "medicine", mood: 15, cures: true }, "white-honey");
  assert.doesNotThrow(() =>
    validateCooked(c, {
      selfSlug: "white-honey",
      tagSlugs: new Set(),
      entry: { cures: ["poisoned", "envenomated", "phrygian-toxin"] },
    }),
  );
});

test("an ingredient that never opts in is validated as before", () => {
  // No `entry` at all is still legal — the body parts and every ordinary
  // ingredient reach validateCooked with nothing to say about cures.
  const c = cook({ taste: "leeches", mood: -10 }, "leeches");
  assert.doesNotThrow(() => validateCooked(c, { selfSlug: "leeches", tagSlugs: new Set() }));
});

// --- ingredientSlots ------------------------------------------------------

const slots = (s, slug = "lavish-meal") => normalizeIngredientSlots(s, { slug });

test("ingredient slots normalise to a min and a max", () => {
  assert.deepEqual(slots({ min: 1, max: 2 }), { min: 1, max: 2 });
  // The Fine Meal: optional, one at most.
  assert.deepEqual(slots({ min: 0, max: 1 }), { min: 0, max: 1 });
  // An absent max is the min — a recipe that takes exactly one.
  assert.deepEqual(slots({ min: 1 }), { min: 1, max: 1 });
  assert.equal(slots(null), null);
});

test("nonsense slot counts are refused", () => {
  assert.throws(() => slots({ min: 2, max: 1 }), /below its min/);
  assert.throws(() => slots({ min: 0, max: 0 }), /should not declare slots/);
  assert.throws(() => slots({ min: -1, max: 2 }), /whole number/);
  assert.throws(() => slots({ min: 1, max: 1.5 }), /whole number/);
  assert.throws(() => slots({ min: 1, max: INGREDIENT_SLOTS_MAX + 1 }), /draws at most/);
});

test("slots are refused anywhere the Craft path would never read them", () => {
  const s = slots({ min: 1, max: 2 });
  const base = { selfSlug: "lavish-meal", craftable: true };
  assert.throws(() => validateIngredientSlots(s, { ...base, craftable: false }), /not craftable/);
  assert.throws(() => validateIngredientSlots(s, { ...base, placement: { kind: "x" } }), /build site/);
  assert.doesNotThrow(() => validateIngredientSlots(s, base));
});

test("slots are refused on a multi-turn project", () => {
  // The mint happens on the finishing turn, days later; the picked slugs
  // would have to survive on CraftProject.custom and nothing carries them.
  const s = slots({ min: 1, max: 2 });
  const base = { selfSlug: "x", craftable: true };
  assert.throws(() => validateIngredientSlots(s, { ...base, turnsCost: 2 }), /finishing turn/);
  assert.doesNotThrow(() => validateIngredientSlots(s, { ...base, turnsCost: 1 }));
  // A "1/N" fraction is a string and is still one turn's work — never a project.
  assert.doesNotThrow(() => validateIngredientSlots(s, { ...base, turnsCost: "1/3" }));
});

// --- custom ---------------------------------------------------------------

test("an absent custom block means the standard surcharge and a description box", () => {
  assert.deepEqual(normalizeCustom(null, { slug: "painting", customizable: true }), {
    customCost: null,
    customDescribable: true,
  });
});

test("the meals buy their words for nothing, and the Fine Meal takes no description", () => {
  assert.deepEqual(
    normalizeCustom({ cost: 0, describable: false }, { slug: "fine-meal", customizable: true }),
    { customCost: 0, customDescribable: false },
  );
  assert.deepEqual(
    normalizeCustom({ cost: 0, describable: true }, { slug: "lavish-meal", customizable: true }),
    { customCost: 0, customDescribable: true },
  );
});

test("a custom block on a tag nothing can customise is refused", () => {
  assert.throws(
    () => normalizeCustom({ cost: 0 }, { slug: "rock", customizable: false }),
    /not customizable/,
  );
  assert.throws(
    () => normalizeCustom({ cost: -1 }, { slug: "painting", customizable: true }),
    /positive whole number/,
  );
});

// --- dishMoodTerms --------------------------------------------------------

test("a dish sums its ingredients rather than taking the largest", () => {
  // Two delicacies in a Lavish Meal are worth both — which is the only thing
  // that makes a second slot mean anything.
  assert.deepEqual(dishMoodTerms(8, [45, 20]), [{ kind: "MEAL", base: 73 }]);
});

test("a dish with no ingredient is worth its own small figure", () => {
  assert.deepEqual(dishMoodTerms(5, []), [{ kind: "MEAL", base: 5 }]);
  // And a meal with no figure at all says nothing rather than saying zero.
  assert.deepEqual(dishMoodTerms(null, []), []);
  assert.deepEqual(dishMoodTerms(0, []), []);
});

test("harm and relief come back as two terms, never netted", () => {
  // Saffron must not cancel the feces: only the harm half is ever scaled, so
  // netting them first would charge a scaled -2 instead of an unscaled +53
  // and an unscaled -55.
  assert.deepEqual(dishMoodTerms(8, [45, -55]), [
    { kind: "MEAL", base: 53 },
    { kind: "DISGUST", base: -55, noMultiplier: true },
  ]);
});

test("disgust is never scaled by a held tag", () => {
  // Revulsion at what you just swallowed is not a fright. Without this, Rage
  // and an equipped Heartforged Blade would each make feces free.
  const [term] = dishMoodTerms(0, [-40]);
  assert.equal(term.kind, "DISGUST");
  assert.equal(term.noMultiplier, true);
});

test("a dish ignores an ingredient with no figure at all", () => {
  assert.deepEqual(dishMoodTerms(8, [20, undefined, null, NaN]), [{ kind: "MEAL", base: 28 }]);
});
