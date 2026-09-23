// The gear valuation in the economy report (db/scripts/analysis/economy/equipment.js): every
// creation-pick Item and Asset gets a row, the ¢ figures are built the way the module's header says,
// and the scale flag does what it claims. Builds the whole model once, since the picks are priced off
// the same sourcing and investments passes the rest of the report reads.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildModel } = require("../scripts/analysis/economy/model");

const model = buildModel({});
const E = model.equipment;
const rows = new Map(E.rows.map((r) => [r.slug, r]));

test("every purchasable Item or Asset with a point price is a row, and nothing else is", () => {
  for (const r of E.rows) {
    assert.ok(r.category === "items" || r.category === "assets", `${r.slug} is ${r.category}`);
    assert.ok(r.points > 0, `${r.slug} has no point price`);
  }
  // A few known picks are present; a status, a skill and a role grant are not.
  for (const slug of ["pickaxe", "plate-armor", "cart", "bird", "starting-wares"]) assert.ok(rows.has(slug), `${slug} missing`);
  for (const slug of ["smithing", "hungry", "courtier", "lucky"]) assert.ok(!rows.has(slug), `${slug} should not be a row`);
});

test("replace ¢ is the cheapest route, never negative, and a shelf price is never beaten by an unpriced crate", () => {
  for (const r of E.rows) {
    if (r.replace == null) continue;
    assert.ok(r.replace >= 0, `${r.slug} replace ${r.replace}`);
    if (r.depot != null) assert.ok(r.replace <= r.depot, `${r.slug}: replace ${r.replace} over its shelf price ${r.depot}`);
  }
  // A single Fertilizer opens into a status nobody prices, so the pick is a bundle of two, worth two
  // shelf prices — never a zero from the unpriced status underneath.
  assert.ok(!rows.has("fertilizer"), "the single is off the shelf");
  assert.equal(rows.get("fertilizer-2-sacks").replaceVia, "contents");
  assert.equal(rows.get("fertilizer-2-sacks").replace, 8);
  assert.equal(rows.get("paper-3-stacks").replace, 6);
  // Starting Wares is a crate of priced goods, worth what it opens into.
  assert.equal(rows.get("starting-wares").replaceVia, "contents");
  assert.ok(rows.get("starting-wares").replace > 50);
  // The Heirloom is neither stocked nor made; the counter's price is its floor.
  assert.equal(rows.get("heirloom").replaceVia, "floor");
  assert.equal(rows.get("heirloom").replace, rows.get("heirloom").sell);
});

test("a craftable's make-it-yourself figure is ⬢ at the import price plus inputs plus Moves at the Move's value", () => {
  const pick = rows.get("pickaxe");
  assert.ok(pick.craft);
  const expected = pick.craft.resources * model.params.rv.buy + pick.craft.items + pick.craft.moves * E.moveValue;
  assert.ok(Math.abs(pick.craft.allIn - expected) < 0.15, `pickaxe all-in ${pick.craft.allIn} vs ${expected}`);
  // A smithed piece the counter buys is priced at what a maker is paid for it when that is cheaper than the anvil.
  const sabre = rows.get("sabre");
  assert.equal(sabre.replace, Math.min(sabre.sell, sabre.craft.allIn));
});

test("the scale: fair points, drift and the verdict agree with each other and with the point value", () => {
  assert.equal(E.pointValue, 7, "the rule in TAGS.md §4a");
  assert.equal(E.pointValueSet, false);
  assert.deepEqual(E.pointValueRange, [6, 8]);
  assert.ok(E.medianRate > 0);
  for (const r of E.rows) {
    if (r.replace == null) {
      assert.equal(r.verdict, null, `${r.slug} unpriced but has a verdict`);
      continue;
    }
    assert.ok(r.fairPoints >= 1, `${r.slug} fair ${r.fairPoints}`);
    assert.equal(r.drift, r.points - r.fairPoints);
    const want = r.rate > 8 ? "a bargain" : r.rate < 6 ? "overpriced" : "on the scale";
    assert.equal(r.verdict, want, `${r.slug} at ${r.rate} ¢/pt`);
  }
  assert.equal(E.counts.bargains + E.counts.onScale + E.counts.overpriced + E.unpriced.length, E.counts.picks);
});

test("--point-value moves the scale and every verdict with it", () => {
  const set = buildModel({ pointValue: 100 }).equipment;
  assert.equal(set.pointValue, 100);
  assert.equal(set.pointValueSet, true);
  assert.deepEqual(set.pointValueRange, [85.7, 114.3], "the 6–8 width scales with the override");
  assert.equal(set.medianRate, E.medianRate, "the catalog's own median is still reported beside the override");
  // At 100 ¢ a point nothing in the catalog buys enough kit to be a bargain.
  assert.equal(set.counts.bargains, 0);
  assert.equal(set.counts.overpriced, set.counts.priced);
});

test("weapons carry a combat ceiling of about 7 points a tier, and armour its two words", () => {
  const bow = rows.get("longbow");
  assert.equal(bow.fightTiers, 0.5);
  assert.equal(bow.fightCeiling, 3.5);
  const plate = rows.get("plate-armor");
  assert.match(plate.armorWords, /^Melee: \w+ \| Ballistic: \w+$/);
  assert.equal(rows.get("rope").fightTiers, null);
});

test("the creation pick itself is never counted as a route to the thing", () => {
  for (const r of E.rows) for (const label of r.routes) assert.ok(!/creation pick|points store/.test(label), `${r.slug}: ${label}`);
  // A pick with no in-play route at all says so, rather than borrowing the pick's own rank.
  assert.equal(rows.get("dog").rankLabel, "None known");
});
