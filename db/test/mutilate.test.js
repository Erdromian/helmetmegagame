const test = require("node:test");
const assert = require("node:assert");
const {
  MUTILATE_PARTS,
  resolveMutilation,
} = require("../lib/mutilate");

test("an untouched subject gives up the first rung", () => {
  const r = resolveMutilation("eye", []);
  assert.equal(r.grantSlug, "missing-eye");
  assert.equal(r.dropSlug, null);
  assert.equal(r.itemSlug, "eye");
  assert.equal(r.lethal, false);
});

test("the second press replaces the first rung", () => {
  const r = resolveMutilation("eye", ["missing-eye"]);
  assert.equal(r.grantSlug, "blind");
  assert.equal(r.dropSlug, "missing-eye");
});

test("a spent ladder refuses", () => {
  assert.equal(resolveMutilation("eye", ["blind"]), null);
  assert.equal(resolveMutilation("foot", ["cripple"]), null);
  assert.equal(resolveMutilation("hand", ["missing-arm"]), null);
});

test("a one-rung ladder refuses after the first press", () => {
  assert.equal(resolveMutilation("tongue", []).grantSlug, "mute");
  assert.equal(resolveMutilation("tongue", ["mute"]), null);
});

test("holding both rungs reads as the top, not the bottom", () => {
  // A GM grant or a creation purchase can put Blind on a sheet that already
  // carries Missing Eye. Counting upward would take a third eye.
  assert.equal(resolveMutilation("eye", ["missing-eye", "blind"]), null);
});

test("the foot and hand ladders walk the tags that already exist", () => {
  assert.equal(resolveMutilation("foot", []).grantSlug, "missing-leg");
  assert.equal(resolveMutilation("foot", ["missing-leg"]).grantSlug, "cripple");
  assert.equal(resolveMutilation("hand", []).grantSlug, "missing-fingers");
  assert.equal(
    resolveMutilation("hand", ["missing-fingers"]).grantSlug,
    "missing-arm",
  );
});

test("the two organs are lethal and one press each", () => {
  for (const key of ["stomach", "heart"]) {
    const r = resolveMutilation(key, []);
    assert.equal(r.lethal, true);
    assert.equal(resolveMutilation(key, [r.grantSlug]), null);
  }
});

test("an unknown part is a refusal, never a partial result", () => {
  assert.equal(resolveMutilation("nose", []), null);
  assert.equal(resolveMutilation(undefined, []), null);
});

test("every part names a distinct item and a non-empty ladder", () => {
  const items = new Set();
  for (const p of MUTILATE_PARTS) {
    assert.ok(p.ladder.length >= 1, `${p.key} has no ladder`);
    assert.ok(!items.has(p.itemSlug), `${p.itemSlug} is used twice`);
    items.add(p.itemSlug);
  }
});
