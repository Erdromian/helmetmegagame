// node --test over db/lib/healGambit.js (the pure threshold/margin math) and
// db/lib/healComplications.js (the botch table). Run with `npm test
// --workspace=db`. Nothing here touches Prisma.
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { docsPath } = require("../lib/repoPaths");
const { entriesOf } = require("../lib/yamlEntries");
const { woundRungOf } = require("../lib/mood");
const {
  medicTierOf,
  requiredTierOf,
  healThreshold,
  severityRungOf,
  healOutcome,
} = require("../lib/healGambit");
const { TABLE, pickComplication, allComplicationSlugs } = require("../lib/healComplications");

const skill = (slug) => ({ slug });
const wound = (extra = {}) => ({
  requirementResources: null,
  requirementTurns: 0,
  requirementPerTurn: null,
  requirementGambit: false,
  requirementSkills: [],
  ...extra,
});

// --- medicTierOf / requiredTierOf --------------------------------------

test("medicTierOf reads the highest Medical tier held, 0 for none", () => {
  assert.equal(medicTierOf(new Set()), 0);
  assert.equal(medicTierOf(new Set(["medical-basic"])), 1);
  assert.equal(medicTierOf(new Set(["medical-basic", "medical-skilled"])), 2);
  assert.equal(medicTierOf(new Set(["medical-basic", "medical-skilled", "medical-expert"])), 3);
  // Unrelated held slugs never confuse it.
  assert.equal(medicTierOf(new Set(["fighting-basic", "medical-expert"])), 3);
});

test("requiredTierOf reads the highest Medical tier a tag names, floored at 1", () => {
  assert.equal(requiredTierOf(wound({ requirementSkills: [skill("medical-basic")] })), 1);
  assert.equal(requiredTierOf(wound({ requirementSkills: [skill("medical-skilled")] })), 2);
  assert.equal(requiredTierOf(wound({ requirementSkills: [skill("medical-expert")] })), 3);
  // requirementGambit alone (Dying) still floors at 1, never 0 — a Basic can attempt it.
  assert.equal(requiredTierOf(wound({ requirementSkills: [], requirementGambit: true })), 1);
});

// --- healThreshold -------------------------------------------------------

test("healThreshold matches the documented table", () => {
  const tier6 = wound({ requirementResources: 13, requirementTurns: 1, requirementSkills: [skill("medical-expert")] });
  const tier7 = wound({ ...tier6, requirementGambit: true });
  const dying = wound({ requirementResources: 4, requirementGambit: true, requirementSkills: [skill("medical-basic")] });

  assert.equal(healThreshold(tier7, /* Expert */ 3), 4, "Expert on tier 7: at tier, +1 for the flag");
  assert.equal(healThreshold(dying, /* Basic */ 1), 4, "Basic on Dying: at tier, +1 for the flag");
  assert.equal(healThreshold(dying, /* Expert */ 3), 4, "Dying costs everyone the same — tier can't buy it down below the flag");
  assert.equal(healThreshold(tier6, /* Skilled */ 2), 5, "Skilled on tier 6: one tier short");
  assert.equal(healThreshold(tier7, /* Skilled */ 2), 6, "Skilled on tier 7: one tier short, +1 for the flag");
  assert.equal(healThreshold(tier6, /* Basic */ 1), 7, "Basic on tier 6: two tiers short — practically unreachable");
  assert.equal(healThreshold(tier6, /* Expert */ 3), 3, "Expert at tier: the bare 50/50, no gap, no flag");
});

// --- severityRungOf: must never disagree with mood.js#woundRungOf on the
// arithmetic, only on the group gate -------------------------------------

test("severityRungOf is woundRungOf's own arithmetic with the group gate lifted", () => {
  const yamlPath = docsPath("tags.yaml");
  assert.ok(yamlPath, "docs/tags.yaml must be locatable");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = entriesOf(doc?.tags, "slug").filter(
    (entry) => typeof entry.group === "string" && entry.group.startsWith("health") && entry.requirement,
  );
  assert.ok(entries.length > 20, "sanity: the health catalog should not be empty");

  const disagreements = [];
  for (const entry of entries) {
    const shape = {
      requirementResources: entry.requirement?.resourceCost ?? null,
      requirementTurns: entry.requirement?.turnsCost === 0 ? 0 : 1,
      requirementPerTurn: entry.requirement?.turnsCost === "1/4" ? 4 : null,
      requirementGambit: entry.requirement?.gambit ?? false,
    };
    // Forcing every entry into a wound group is what makes woundRungOf run
    // its real arithmetic regardless of the tag's own group — the group gate
    // is exactly the one thing this test is not checking.
    const asWound = woundRungOf({ ...shape, group: { slug: "health-wounds" } });
    const severity = severityRungOf(shape);
    if (asWound !== severity) disagreements.push(`${entry.slug}: woundRungOf=${asWound}, severityRungOf=${severity}`);
  }
  assert.deepEqual(disagreements, [], `severityRungOf drifted from woundRungOf's arithmetic:\n${disagreements.join("\n")}`);
});

test("severityRungOf: rung 5 direct check, the same one woundRungOracle.test.js pins for woundRungOf", () => {
  assert.equal(severityRungOf(wound({ requirementResources: 6 })), 5);
  assert.equal(severityRungOf(wound({ requirementResources: 7 })), 5);
});

// --- healOutcome: margin -> complication rung, floors and clamps --------

test("healOutcome: clearing the threshold cures, no complication", () => {
  const out = healOutcome({ die: 5, diceModifier: 1, threshold: 6, severityRung: 3 });
  assert.equal(out.total, 6);
  assert.equal(out.succeeded, true);
  assert.equal(out.complicationRung, null);
});

test("healOutcome: a miss's rung is the margin, floored by severity, clamped to [1,6]", () => {
  // Low-severity target (rung 2): margin alone decides, down to 1.
  assert.equal(healOutcome({ die: 3, diceModifier: 0, threshold: 4, severityRung: 2 }).complicationRung, 1);
  assert.equal(healOutcome({ die: 1, diceModifier: 0, threshold: 4, severityRung: 2 }).complicationRung, 3);
  // High-severity target (rung 6): a near-miss still floors at 3, never a bruise.
  assert.equal(healOutcome({ die: 5, diceModifier: 0, threshold: 6, severityRung: 6 }).complicationRung, 3);
  // rung 5 floors at 2.
  assert.equal(healOutcome({ die: 5, diceModifier: 0, threshold: 6, severityRung: 5 }).complicationRung, 2);
  // A catastrophic miss still clamps at the table's ceiling.
  assert.equal(healOutcome({ die: 1, diceModifier: -3, threshold: 7, severityRung: 6 }).complicationRung, 6);
});

test("healOutcome: succeeded is strictly false (not falsy-anything) on a miss", () => {
  const out = healOutcome({ die: 1, diceModifier: 0, threshold: 4, severityRung: 1 });
  assert.equal(out.succeeded, false);
  // margin = 4 - 1 = 3, floor for a rung-1 target is 1 — margin wins.
  assert.equal(out.complicationRung, 3);
});

// --- healComplications: every named slug is real, every rung reachable --

test("every complication slug exists in docs/tags.yaml as a real Health tag", () => {
  const yamlPath = docsPath("tags.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const catalog = new Map(entriesOf(doc?.tags, "slug").map((t) => [t.slug, t]));

  const missing = [];
  const wrongCategory = [];
  for (const slug of allComplicationSlugs()) {
    const entry = catalog.get(slug);
    if (!entry) {
      missing.push(slug);
      continue;
    }
    if (entry.category !== "health") wrongCategory.push(slug);
  }
  assert.deepEqual(missing, [], `complication table names slug(s) not in docs/tags.yaml: ${missing.join(", ")}`);
  assert.deepEqual(wrongCategory, [], `complication table names non-Health tag(s): ${wrongCategory.join(", ")}`);
});

test("pickComplication always returns something for every rung 1-6, every table group", () => {
  for (const group of [...Object.keys(TABLE), "health-minor", "health-recovery", "some-unknown-group"]) {
    for (let rung = 1; rung <= 6; rung++) {
      const slug = pickComplication(group, rung);
      assert.ok(slug, `pickComplication(${group}, ${rung}) returned nothing`);
    }
  }
});

test("pickComplication walks a group's own rungs down before falling back", () => {
  // health-infection has nothing at rung 1 or 3 — rung 1 must fall all the
  // way to health-wounds (its own group has nothing at or below 1 to find),
  // and rung 3 must land on its own rung 2 before ever trying health-wounds.
  assert.ok(TABLE["health-infection"][1] === undefined);
  assert.ok(TABLE["health-infection"][3] === undefined);
  const atOne = pickComplication("health-infection", 1);
  assert.ok(TABLE["health-wounds"][1].includes(atOne), `expected a health-wounds rung-1 slug, got ${atOne}`);
  const atThree = pickComplication("health-infection", 3);
  assert.ok(TABLE["health-infection"][2].includes(atThree), `expected the group's own rung-2 slug, got ${atThree}`);
});

test("pickComplication falls back to health-wounds entirely for a group not in the table", () => {
  const slug = pickComplication("health-minor", 4);
  assert.ok(TABLE["health-wounds"][4].includes(slug));
});
