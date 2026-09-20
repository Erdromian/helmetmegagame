// node --test over the pure half of db/lib/cavingLoot.js — the weight columns and
// the two draws. Run with `npm test --workspace=db`. validateCavingLoot's OTHER
// job, checking every slug against the live Tag catalog, needs a database and runs
// at process startup instead (bot/src/index.js, web's instrumentation hook).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROSPECTING_TABLE,
  PROSPECTING_WEIGHTS_BY_ZONE,
  PROSPECTING_SKILLED_WEIGHTS_BY_ZONE,
  drawProspectingLoot,
} = require("../lib/cavingLoot");

const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// The same check validateCavingLoot makes at boot, run here so a bad column fails
// `npm test` rather than waiting for somebody to start the web app.
for (const [name, map] of Object.entries({
  PROSPECTING_WEIGHTS_BY_ZONE,
  PROSPECTING_SKILLED_WEIGHTS_BY_ZONE,
})) {
  for (const [zoneSlug, weights] of Object.entries(map)) {
    test(`${name}["${zoneSlug}"] sums to 1`, () => {
      const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
      assert.ok(Math.abs(sum - 1) < 1e-6, `sums to ${sum}`);
    });
  }
}

// What the skill actually buys on the loot side. Weight at or above `rare` is the
// honest measure — "better" means the good tiers get likelier, not that ultracommon
// merely gets rarer.
test("the skilled column is richer at every good tier, in both zones", () => {
  for (const zone of ["caves", "depths"]) {
    const plain = PROSPECTING_WEIGHTS_BY_ZONE[zone];
    const skilled = PROSPECTING_SKILLED_WEIGHTS_BY_ZONE[zone];
    for (const tier of ["uncommon", "rare", "extremely-rare", "nearly-impossible"]) {
      assert.ok(skilled[tier] > plain[tier], `${zone} ${tier}: ${skilled[tier]} > ${plain[tier]}`);
    }
    assert.ok(skilled.ultracommon < plain.ultracommon, `${zone} ultracommon falls`);
  }
});

test("every tier the weights name has something in it to draw", () => {
  for (const tier of TIERS) {
    assert.ok(Array.isArray(PROSPECTING_TABLE[tier]), `${tier} is a list`);
    assert.ok(PROSPECTING_TABLE[tier].length > 0, `${tier} is not empty`);
  }
});

// The absence IS the rule (see the file header): the Black Hills are minable for ⬢
// and hold nothing worth finding, and the skill does not buy a column where there
// is none. Null rather than a throw, unlike drawLoot's own zone miss.
test("a zone with no column draws nothing rather than throwing, skilled or not", () => {
  assert.equal(drawProspectingLoot("hills"), null);
  assert.equal(drawProspectingLoot("hills", { prospecting: true }), null);
  assert.equal(drawProspectingLoot("town"), null);
});

test("a draw always lands on a real tier and a real slug", () => {
  for (const zone of ["caves", "depths"]) {
    for (const prospecting of [false, true]) {
      for (let i = 0; i < 200; i++) {
        const drawn = drawProspectingLoot(zone, { prospecting });
        assert.ok(TIERS.includes(drawn.tier), `tier ${drawn.tier}`);
        assert.ok(PROSPECTING_TABLE[drawn.tier].includes(drawn.slug), `slug ${drawn.slug}`);
      }
    }
  }
});

test("an unskilled draw defaults to the plain column", () => {
  // Same shape either way — the point of the assertion is that the argument is
  // optional, since moveEffects.js is not the only caller shape this has had.
  const drawn = drawProspectingLoot("caves");
  assert.ok(TIERS.includes(drawn.tier));
});
