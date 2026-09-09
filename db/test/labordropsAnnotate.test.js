// node --test over db/lib/labordropsAnnotate.js. Nothing here touches
// Prisma or the filesystem — annotateLines takes plain rows and lines, so
// the whole cascading-EV/blurb-preservation contract is testable with
// synthetic data. A live-file smoke test (--write against a real db) is a
// second layer, not a replacement (see LABORDROPS.md §6a-§6b).
const test = require("node:test");
const assert = require("node:assert/strict");
const { annotateLines, mechanicalValue, splitBlurb } = require("../lib/labordropsAnnotate");

test("mechanicalValue: obol, a sellable tag, an unsellable tag, and non-tag entries", () => {
  const tagsById = new Map([
    ["t-obol", { slug: "obol", sellable: false, sellablePrice: null }],
    ["t-rope", { slug: "rope", sellable: true, sellablePrice: 4 }],
    ["t-bruised", { slug: "bruised", sellable: false, sellablePrice: null }],
  ]);
  assert.equal(mechanicalValue("obol", tagsById), "the coin itself, worth 1 ⬢");
  assert.equal(mechanicalValue("rope", tagsById), "sells 4 ⬢");
  assert.equal(mechanicalValue("bruised", tagsById), "not sellable");
  assert.equal(mechanicalValue("nothing", tagsById), null);
  assert.equal(mechanicalValue("Nothing", tagsById), null);
  assert.equal(mechanicalValue("+1", tagsById), null);
  assert.equal(mechanicalValue("-2", tagsById), null);
});

test("splitBlurb: preserves author text before ' — '", () => {
  assert.deepEqual(splitBlurb("# a coil left behind at an old camp — sells 4 ⬢", "sells 4 ⬢"), {
    blurb: "a coil left behind at an old camp",
  });
  assert.deepEqual(splitBlurb(null), { blurb: null });
});

test("splitBlurb: a bare comment matching today's mech value is a stale mechanical write, not a blurb", () => {
  assert.deepEqual(splitBlurb("# sells 4 ⬢", "sells 4 ⬢"), { blurb: null });
});

test("splitBlurb: a bare comment with no separator, authored before any mechanical value existed, IS the blurb", () => {
  assert.deepEqual(splitBlurb("# a boar's tusk catches you", "not sellable"), {
    blurb: "a boar's tusk catches you",
  });
  // Also true with no mech at all (a RESOURCES entry never gets one).
  assert.deepEqual(splitBlurb("# a lucky find in the reeds", null), {
    blurb: "a lucky find in the reeds",
  });
});

// A minimal but real tree: global (1 tag, roll 6), laborType.hunting (roll
// 6, one entry), and zone.forest.requiresTag.forester (roll 6) — enough to
// exercise every node kind the walker handles (top, slugStep, rollLevel,
// rollLeaf, requiresTagMarker, skillLevel) in one pass.
function fixture() {
  const tagsById = new Map([
    ["t-obol", { id: "t-obol", slug: "obol", sellable: false, sellablePrice: null }],
    ["t-rope", { id: "t-rope", slug: "rope", sellable: true, sellablePrice: 4 }],
  ]);
  const tagIdBySlug = new Map([["obol", "t-obol"], ["rope", "t-rope"], ["forester", "t-forester"]]);
  const zoneIdBySlug = new Map([["forest", "z-forest"]]);
  const locationIdBySlug = new Map();

  const rows = [
    { roll: 6, laborType: null, zoneId: null, locationId: null, requiredTagId: null, kind: "TAG", tagId: "t-obol", evValue: 1 },
    { roll: 6, laborType: "HUNTING", zoneId: null, locationId: null, requiredTagId: null, kind: "RESOURCES", resourceAmount: 2, evValue: 2 },
    { roll: 6, laborType: null, zoneId: "z-forest", locationId: null, requiredTagId: "t-forester", kind: "TAG", tagId: "t-rope", evValue: 4 },
  ];

  const lines = [
    "global:",
    "  6:",
    "    - obol",
    "",
    "laborType:",
    "  hunting:",
    '    6:',
    '      - "+2"',
    "",
    "zone:",
    "  forest:",
    "    requiresTag:",
    "      forester:",
    "        6:",
    "          - rope  # a coil left behind at an old camp",
    "",
  ];

  return { tagsById, tagIdBySlug, zoneIdBySlug, locationIdBySlug, rows, lines };
}

test("annotateLines: global's own roll comment shows one number (own == combined)", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const globalRoll = out.find((l) => l.trim().startsWith("6:") && !l.includes("hunting"));
  assert.match(globalRoll, /^  6:\s+# EV 1\.00 ⬢ · hit 100%$/);
});

test("annotateLines: hunting's roll 6 shows own AND combined (global's obol pools in)", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const line = out[6]; // '    6:' under laborType.hunting
  assert.match(line, /own EV 2\.00 ⬢ · hit 100%/);
  assert.match(line, /combined EV 1\.50 ⬢ · hit 100%/); // (2 + 1) / 2
});

test("annotateLines: the category rollup is a true per-labor EV — divided by all 6 faces, not the 1 configured one", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const categoryLine = out[5]; // '  hunting:'
  // Roll 6's combined EV is 1.50 (see the test above), rolls 1-5 are
  // unconfigured (0 EV each) — the rollup is 1.50/6, NOT 1.50 itself.
  assert.match(categoryLine, /⬢ EV\/labor 0\.25 · hit 17%/);
});

test("annotateLines: forester's rollup folds in global AND zone.forest — the cascading case", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const forestLine = out[10]; // '  forest:'
  // Only Global(obol=1) pools at plain zone.forest on roll 6 (own EV 1.00);
  // divided across all 6 faces: 1.00 / 6.
  assert.match(forestLine, /⬢ EV\/labor 0\.17 · hit 17%/);
  const foresterLine = out[12]; // '      forester:'
  // Global(1) + zone.forest(nothing) + zone.forest.requiresTag.forester(4)
  // = 2.50 on roll 6 alone; divided across all 6 faces: 2.50 / 6.
  assert.match(foresterLine, /⬢ EV\/labor 0\.42 · hit 17%/);
});

test("annotateLines: preserves the author's blurb and appends the mechanical value", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const ropeLine = out[14];
  assert.equal(ropeLine, "          - rope  # a coil left behind at an old camp — sells 4 ⬢");
});

test("annotateLines: never touches a blank or comment-only line, or an empty-dict bucket", () => {
  const lines = ["global: {}", "", "# a standalone comment"];
  const out = annotateLines(lines, {
    rows: [],
    tagsById: new Map(),
    tagIdBySlug: new Map(),
    zoneIdBySlug: new Map(),
    locationIdBySlug: new Map(),
  });
  assert.deepEqual(out, lines);
});
