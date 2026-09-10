// node --test over the 2026-09-10 hotfix: Laboring stopped being a gate.
// A character holding no Laboring tag used to be refused outright, on every
// surface, including the Godard Factory floor — where the skill ladder prices
// something (⬢) that a refining shift never pays, so the gate locked the
// Factory's own people out of it for nothing. See docs/systemdocs/LABORING.md
// §1 and §3b.
//
// Nothing here touches Prisma: resolveLaborRateFrom takes a plain ctx, the
// same split db/test/laborProspecting.test.js uses.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLaborRateFrom } = require("../lib/laborAccess");

// The machine format db/lib/resourceDelta.js#rollResourceRange parses. It has
// to be a real "0-0" and not an empty string: a failed parse pays nothing
// SILENTLY, which looks identical to this and is a bug rather than a rule.
const UNPAID = "0-0";

test("laborAccess: no Laboring tag at all still labors, for nothing", () => {
  const ctx = { yields: { HUNTING: 0.8 }, refinery: false, tagSlugs: new Set(), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "unskilled");
  assert.deepEqual([result.min, result.max], [0, 0]);
  assert.equal(result.expression, UNPAID);
});

test("laborAccess: a skill that doesn't reach this ground labors for nothing too", () => {
  // A hunter standing in Town: holds the tags, but nothing here has a row.
  const ctx = {
    yields: {},
    refinery: false,
    tagSlugs: new Set(["laboring-hunting"]),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "unskilled");
});

test("laborAccess: the Factory floor is worked with no Laboring tag — the whole point of the fix", () => {
  const ctx = {
    yields: {},
    refinery: true,
    refineryInput: { id: "godflesh-row" },
    tagSlugs: new Set(),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "refining");
  assert.equal(result.refinery, true);
});

test("laborAccess: an empty Factory floor still refuses, tag or no tag", () => {
  const ctx = { yields: {}, refinery: true, refineryInput: null, tagSlugs: new Set(), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /Godflesh/);
});

// The regression that matters most: opening the skill gate must not open the
// two gates that were never about skill.
test("laborAccess: Exhausted still refuses somebody with no Laboring tag", () => {
  const ctx = { yields: { HUNTING: 0.8 }, refinery: false, tagSlugs: new Set(["exhausted"]), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /Exhausted/);
});

test("laborAccess: an incapacitated character with no Laboring tag still can't work", () => {
  const ctx = { yields: {}, refinery: true, refineryInput: { id: "x" }, tagSlugs: new Set(["bound"]), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
});

test("laborAccess: an unskilled day draws no labor drop", () => {
  // db/lib/laborDrops.js maps the six real tiers and nothing else, and
  // db/lib/moveEffects.js's laborDrop effect returns 0 on an unmapped one. The
  // die is something a skill earns, so the tier is deliberately not in it.
  const { TIER_TO_LABOR_DROP_TYPE } = require("../lib/laborDrops");
  assert.equal(TIER_TO_LABOR_DROP_TYPE.unskilled, undefined);
  assert.equal(TIER_TO_LABOR_DROP_TYPE.basic, "BASIC");
});
