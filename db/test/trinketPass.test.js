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
    TIERS.slice(1).map((t) => [t.name, t.price]),
    [
      ["Awful", 5],
      ["Poor", 8],
      ["Normal", 14],
      ["Good", 22],
      ["Excellent", 34],
      ["Masterwork", 60],
    ],
  );
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
