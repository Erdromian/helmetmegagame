// node --test over the pure half of db/lib/trinketPass.js — the tier table
// and the skilled floor. Run with `npm test --workspace=db`. Nothing here
// touches Prisma; the mint/DM/audit half of the pass needs a database and is
// exercised by hand per LOCAL-DEV.md, same as db/test/mood.test.js's own note
// on the rest of that module.
const test = require("node:test");
const assert = require("node:assert/strict");
const { clampFace, tierFor, TIERS } = require("../lib/trinketPass");
const { SMITHING_SKILLED_SLUG } = require("../lib/constants");

test("the tier table matches TRINKETS.md §1", () => {
  assert.deepEqual(
    TIERS.slice(1).map((t) => [t.name, t.base, t.mult]),
    [
      ["Awful", 1, 0.5],
      ["Poor", 7, 0.75],
      ["Normal", 15, 1],
      ["Good", 19, 1.25],
      ["Excellent", 23, 1.5],
      ["Masterwork", 27, 2],
    ],
  );
});

// Both halves rise with the face, which is the whole reason the tier multiplies the
// stones instead of sitting beside them: a better smith must never be worth LESS on
// better materials.
test("base and multiplier both climb with the die", () => {
  for (let face = 2; face <= 6; face++) {
    assert.ok(TIERS[face].base > TIERS[face - 1].base, `base rises at face ${face}`);
    assert.ok(TIERS[face].mult > TIERS[face - 1].mult, `mult rises at face ${face}`);
  }
});

test("tierFor maps every face 1-6 to its own tier", () => {
  for (let face = 1; face <= 6; face++) {
    assert.equal(tierFor(face).name, TIERS[face].name);
  }
});

test("an unskilled smith's roll is never clamped", () => {
  const unskilled = new Set(["smithing"]);
  for (let face = 1; face <= 6; face++) {
    assert.equal(clampFace(face, unskilled), face);
  }
});

test("a skilled smith's 1 or 2 clamps up to 3 — never worse than Normal", () => {
  const skilled = new Set(["smithing", SMITHING_SKILLED_SLUG]);
  assert.equal(clampFace(1, skilled), 3);
  assert.equal(clampFace(2, skilled), 3);
});

test("a skilled smith's 3 and above are left alone", () => {
  const skilled = new Set(["smithing", SMITHING_SKILLED_SLUG]);
  for (let face = 3; face <= 6; face++) {
    assert.equal(clampFace(face, skilled), face);
  }
});

test("clampFace tolerates a missing held-slugs set", () => {
  assert.equal(clampFace(1, undefined), 1);
  assert.equal(clampFace(6, null), 6);
});
