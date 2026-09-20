// node --test over what Brewing (Distilling) doubles. Run with `npm test --workspace=db`.
//
// The doubling itself lives in web/app/(app)/character/actions/crafting.js#grantCrafted, which
// needs a database and a session, so what is guarded here is the SET it reads — the thing that
// decides the tag's whole value, and the thing a future edit is most likely to widen without
// pricing it (BREWING.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { DISTILLING_DOUBLES_SLUGS, BREWING_DISTILLING_SLUG } = require("../lib/constants");

const tags = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8")).tags;

test("Distilling doubles the two drinks and nothing else", () => {
  assert.deepEqual([...DISTILLING_DOUBLES_SLUGS].sort(), ["alcohol", "moonshine"]);
});

test("every slug it names is a real craftable recipe", () => {
  for (const slug of DISTILLING_DOUBLES_SLUGS) {
    const tag = tags[slug];
    assert.ok(tag, `docs/tags.yaml has no "${slug}"`);
    assert.ok(tag.craftable, `"${slug}" is not craftable, so nothing would ever double it`);
    assert.ok(tag.stackable, `"${slug}" is not stackable — addToStack pins it to 1 and the doubling is lost`);
  }
});

// The narrowing this file exists to hold. Before 2026-09-20 the test was
// `craftFamily(recipeTag) === "brewing"`, which caught every one of these.
test("the expensive brews are NOT doubled", () => {
  for (const slug of ["pure-luck", "dreamers-draught", "cybernetic-arm", "cybernetic-leg", "antidote", "mercy"]) {
    assert.ok(tags[slug], `docs/tags.yaml has no "${slug}" — update this list rather than deleting the check`);
    assert.ok(!DISTILLING_DOUBLES_SLUGS.has(slug), `"${slug}" must not be doubled by one 3-point tag`);
  }
});

// Widening the set is a balance decision, not a refactor. If this number moves, the price in
// docs/tags.yaml and the note in TAGS.md §4a have to move with it.
test("the set stays small enough for its 3-point price", () => {
  assert.ok(DISTILLING_DOUBLES_SLUGS.size <= 2, "more slugs means Distilling needs repricing — see BREWING.md");
  assert.equal(tags[BREWING_DISTILLING_SLUG].pointCost, 3);
  assert.ok(!tags[BREWING_DISTILLING_SLUG].mastery, "it left the mastery band to be the Innkeeper's starting pick");
});

test("its description names exactly what it doubles", () => {
  const desc = tags[BREWING_DISTILLING_SLUG].description.toLowerCase();
  for (const slug of DISTILLING_DOUBLES_SLUGS) assert.match(desc, new RegExp(slug));
});
