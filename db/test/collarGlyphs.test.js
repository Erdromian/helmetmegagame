// db/lib/collarGlyphs.js: the glyph a bomb collar carries from neck to neck
// (docs/systemdocs/COLLAR.md §2). The remote lists collars by this and
// nothing else, so two collars reading alike, or one losing its glyph on the
// way through a slug, is a trick the game played on the Exactor by accident.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GLYPHS,
  glyphFor,
  glyphIndexOf,
  glyphOf,
  looseSlugFor,
  lockedSlugFor,
  isLooseCollarSlug,
  isLockedCollarSlug,
  nextGlyphIndex,
  collarName,
} = require("../lib/collarGlyphs");

test("no glyph appears twice in the alphabet", () => {
  assert.equal(new Set(GLYPHS).size, GLYPHS.length);
});

test("every index up to a crowded game gets its own glyph", () => {
  const seen = new Set();
  for (let i = 0; i < GLYPHS.length * (GLYPHS.length + 1) + 50; i += 1) {
    const g = glyphFor(i);
    assert.ok(g, `index ${i} has a glyph`);
    assert.ok(!seen.has(g), `index ${i} repeats ${g}`);
    seen.add(g);
  }
});

test("the first collars get single glyphs, then pairs", () => {
  assert.equal(glyphFor(0), GLYPHS[0]);
  assert.equal(glyphFor(GLYPHS.length - 1), GLYPHS[GLYPHS.length - 1]);
  assert.equal(glyphFor(GLYPHS.length), GLYPHS[0] + GLYPHS[0]);
  assert.equal(glyphFor(-1), null);
  assert.equal(glyphFor(1.5), null);
});

test("a glyph survives the trip through both slugs", () => {
  for (const i of [0, 7, 25, 26, 300]) {
    assert.equal(glyphIndexOf(looseSlugFor(i)), i);
    assert.equal(glyphIndexOf(lockedSlugFor(i)), i);
    assert.equal(glyphOf(lockedSlugFor(i)), glyphFor(i));
  }
});

test("a blank catalog collar has no glyph", () => {
  assert.equal(glyphIndexOf("bomb-collar"), null);
  assert.equal(glyphIndexOf("bomb-collar-locked"), null);
  assert.equal(glyphOf("custom-collar-loose-"), null);
  assert.equal(glyphOf(null), null);
});

test("loose and shut never answer for each other", () => {
  assert.equal(isLooseCollarSlug("bomb-collar"), true);
  assert.equal(isLooseCollarSlug(looseSlugFor(3)), true);
  assert.equal(isLooseCollarSlug(lockedSlugFor(3)), false);
  assert.equal(isLooseCollarSlug("bomb-collar-locked"), false);

  assert.equal(isLockedCollarSlug("bomb-collar-locked"), true);
  assert.equal(isLockedCollarSlug(lockedSlugFor(3)), true);
  assert.equal(isLockedCollarSlug(looseSlugFor(3)), false);
  assert.equal(isLockedCollarSlug("bomb-collar"), false);

  assert.equal(isLooseCollarSlug("collar-key"), false);
  assert.equal(isLockedCollarSlug(undefined), false);
});

test("the next glyph is one past the highest ever handed out, never a gap", () => {
  assert.equal(nextGlyphIndex([]), 0);
  assert.equal(nextGlyphIndex(["bomb-collar", "paper"]), 0);
  // Glyph 1's collar went up with its wearer, and its rows were never minted
  // again — 1 stays spent rather than coming back on a new neck.
  assert.equal(nextGlyphIndex([looseSlugFor(0), looseSlugFor(2)]), 3);
  assert.equal(nextGlyphIndex([lockedSlugFor(9), looseSlugFor(4)]), 10);
});

test("the name carries the glyph, and says when it is shut", () => {
  assert.equal(collarName("Ж"), "Bomb Collar Ж");
  assert.equal(collarName("Ж", { locked: true }), "Bomb Collar Ж (Locked)");
});
