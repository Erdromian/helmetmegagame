// node --test regression that catches a mood-tier drift M2a's own tests
// cannot: a table generated from the code under test can be uniformly wrong
// and still agree with itself, so this loads docs/tags.yaml fresh, walks the
// REAL normalizeTurnsCost (db/lib/tagShapes.js) to build the shape
// db/lib/mood.js#woundRungOf expects, and checks the result against a FROZEN
// witness captured before the Brewing rework touched the Move ladder — never
// against woundRungOf's own idea of the current catalog.
//
// A new file rather than a block in mood.test.js: mood.test.js exercises
// woundRungOf as a pure unit function against hand-built fixtures; this is a
// whole-catalog sweep against an external oracle, with its own 46-entry table
// and its own two assertions per slug. Keeping the two apart means a failure
// here reads as "the catalog moved" rather than getting lost among mood.test.js's
// dial arithmetic.
//
// Run with `npm test --workspace=db`. Nothing here touches Prisma.
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { docsPath } = require("../lib/repoPaths");
const { entriesOf } = require("../lib/yamlEntries");
const { normalizeTurnsCost } = require("../lib/tagShapes");
const { woundRungOf } = require("../lib/mood");

// FROZEN ORACLE — pasted verbatim from planning/rework-specs/M3-expected.js.
// Every priced health tag mapped to the mood rung it carried BEFORE the
// Brewing rework touched the Move ladder. Captured from docs/tags.yaml at
// commit c8b1086a with woundRungOf as it stood there, then never
// regenerated. null = outside the three mood-bearing groups
// (health-wounds / -maiming / -infection).
//
// DO NOT regenerate this from the current catalog or the current function —
// see M3.md. If an entry here looks wrong, that is a finding to report, not
// a table to edit.
const EXPECTED_WOUND_RUNGS = {
  "appendicitis": null,
  "arterial-bleed": 3.5,
  "blind": null,
  "blunt-force-trauma": 3,
  "broken-bone": 3,
  "broken-jaw": 4,
  "bruised": 1,
  "burned": 2,
  "cave-fever": null,
  "choking": null,
  "consumptive": null,
  "cracked-ribs": 3,
  "crippled-leg": 7,
  "crush-injury": 5,
  "deep-wound": 3,
  "disfigured": 6,
  "dislocated-shoulder": 0.5,
  "dying": 7,
  "envenomated": null,
  "exploded-chest": null,
  "festering": 4,
  "feverish": 5,
  "frostbite": 2,
  "grievous-wound": 5,
  "gut-wound": 6,
  "heatstroke": null,
  "hypothermia": null,
  "infected": 2,
  "lockjaw": 4,
  "mangled-hand": 4,
  "minor-bleeding": 0.5,
  "minor-wound": 2,
  "necrosis": 5,
  "pain-shock": null,
  "parasites": null,
  "phrygian-toxin": null,
  "poisoned": null,
  "pox": null,
  "punctured-lung": 6,
  "rot-lung": null,
  "sepsis": 7,
  "severe-bleeding": 3.5,
  "severe-burns": 4,
  "severe-pain": null,
  "sprained-ankle": 2,
  "stuffed": null,
};

// Every priced health tag in the CURRENT catalog, built into the shape
// woundRungOf expects — real normalizeTurnsCost, not a hand-parse of the raw
// "1/N" string. Walked by `group:`, never file position: the health groups
// are non-contiguous in docs/tags.yaml.
function loadCurrentWoundRungs() {
  const yamlPath = docsPath("tags.yaml");
  if (!yamlPath) throw new Error("Cannot find docs/tags.yaml — see db/lib/repoPaths.js");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = entriesOf(doc?.tags, "slug").filter(
    (entry) => typeof entry.group === "string" && entry.group.startsWith("health") && entry.requirement,
  );
  const bySlug = new Map();
  for (const entry of entries) {
    const { requirementTurns, requirementPerTurn } = normalizeTurnsCost(entry.requirement, {
      slug: entry.slug,
      healable: entry.healable ?? false,
    });
    const shape = {
      groupSlug: entry.group,
      requirementResources: entry.requirement?.resourceCost ?? null,
      requirementTurns,
      requirementPerTurn,
      requirementGambit: entry.requirement?.gambit ?? false,
    };
    bySlug.set(entry.slug, woundRungOf(shape));
  }
  return bySlug;
}

test("every priced health tag's mood rung still matches the pre-rework oracle", () => {
  const current = loadCurrentWoundRungs();
  const oracleSlugs = Object.keys(EXPECTED_WOUND_RUNGS);

  // The catalog must hold exactly the oracle's 46 slugs — neither more nor
  // fewer. A future priced health tag SHOULD fail here: the fix is a
  // deliberate oracle update with a reason, not silently absorbing it.
  const currentSlugs = [...current.keys()].sort();
  const missing = oracleSlugs.filter((slug) => !current.has(slug));
  const added = currentSlugs.filter((slug) => !EXPECTED_WOUND_RUNGS.hasOwnProperty(slug));
  assert.deepEqual(
    missing,
    [],
    `oracle names ${missing.length} slug(s) no longer in the catalog: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    added,
    [],
    `catalog has ${added.length} priced health tag(s) the oracle does not name: ${added.join(", ")} — ` +
      `this is expected to fail for a genuinely new tag; the fix is a deliberate update to ` +
      `planning/rework-specs/M3-expected.js (and this test's pasted copy) with a reason, not silently ignoring it`,
  );

  // Per-slug, including the nulls, so a tag that accidentally gains or loses
  // a mood rung fails by name.
  const disagreements = [];
  for (const slug of oracleSlugs) {
    const expected = EXPECTED_WOUND_RUNGS[slug];
    const actual = current.get(slug);
    if (actual !== expected) disagreements.push(`${slug}: expected rung ${expected}, got ${actual}`);
  }
  assert.deepEqual(disagreements, [], `wound(s) changed mood tier:\n${disagreements.join("\n")}`);
});

test("rung 5 (the 6-7 ⬢ band) has a direct woundRungOf assertion, not just catalog coverage", () => {
  const wound = (extra = {}) => ({
    groupSlug: "health-wounds",
    requirementResources: null,
    requirementTurns: null,
    requirementGambit: false,
    ...extra,
  });
  assert.equal(woundRungOf(wound({ requirementResources: 6 })), 5);
  assert.equal(woundRungOf(wound({ requirementResources: 7 })), 5);
});
