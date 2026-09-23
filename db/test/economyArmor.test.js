// The armour lens in the economy report (db/scripts/analysis/economy/armor.js): every wearable
// piece gets a row, the four flags fire on a hand-built catalog where each shape is present, and the
// live catalog carries no piece a player can come by that is a twin of, or dominated by, another —
// the rule SMITHING.md §4a sets. The first two tests need no model; the last builds it once.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArmor, STEP, HEAVY_GAP } = require("../scripts/analysis/economy/armor");

const piece = (slug, over = {}) => ({
  slug,
  name: slug,
  category: "items",
  equipSlot: "HEAD",
  pointCost: 2,
  weight: 4,
  melee: 0.3,
  ballistic: 0.1,
  purchasable: true,
  ...over,
});
const build = (list) => buildArmor({ list, get: (slug) => list.find((t) => t.slug === slug) });
const row = (A, slug) => A.rows.find((r) => r.slug === slug);

test("the four flags fire on the shapes they are for, and only those", () => {
  const A = build([
    piece("cap", { pointCost: 1, weight: 1, melee: 0.22, ballistic: 0.04 }),
    // Same numbers as the cap for twice the points: dominated. Also outpriced, since the cap is half the points.
    piece("coif", { pointCost: 2, weight: 4, melee: 0.22, ballistic: 0.04 }),
    piece("helm-a", { melee: 0.31, ballistic: 0.09 }),
    piece("helm-b", { melee: 0.31, ballistic: 0.09 }),
    // A 3-pt shield in another slot that stops as much as a 9-pt helm.
    piece("pavise", { equipSlot: "WEAPON", pointCost: 3, weight: 25, melee: 0.44, ballistic: 0.22 }),
    piece("closed-helm", { pointCost: 9, weight: 6, melee: 0.44, ballistic: 0.13, forcesConceal: true, concealsIdentity: true }),
    // Body: plate at nearly three times the breastplate's weight for a step under half a word.
    piece("breastplate", { equipSlot: "BODY", equipLayer: 2, pointCost: 10, weight: 20, melee: 0.55, ballistic: 0.18 }),
    piece("plate", { equipSlot: "BODY", equipLayer: 2, pointCost: 11, weight: 55, melee: 0.62, ballistic: 0.22 }),
    // Loot: better than everything, and it must flag nothing.
    piece("cataphract", { equipSlot: "BODY", equipLayer: 2, pointCost: 0, weight: 65, melee: 0.86, ballistic: 0.86, purchasable: false }),
  ]);
  assert.deepEqual(row(A, "helm-a").twins, ["helm-b"]);
  assert.deepEqual(row(A, "helm-b").twins, ["helm-a"]);
  assert.equal(row(A, "helm-a").verdict, "no use case");
  assert.deepEqual(row(A, "coif").dominatedBy, ["cap", "helm-a", "helm-b"]);
  assert.deepEqual(row(A, "coif").outpricedBy, ["cap (1 pt)"]);
  assert.deepEqual(row(A, "closed-helm").outpricedBy, ["pavise (3 pt)"]);
  assert.equal(row(A, "closed-helm").verdict, "worth a look");
  assert.deepEqual(row(A, "plate").heavyFor, ["breastplate (20 lb)"]);
  assert.deepEqual(row(A, "breastplate").heavyFor, [], "the cataphract is loot, so it outweighs nothing in play");
  assert.equal(row(A, "cataphract").verdict, "kit or loot");
  assert.equal(row(A, "cataphract").reach, "kit");
  assert.equal(row(A, "cap").verdict, "earns its place");
  assert.ok(row(A, "cap").badges.includes("lightest"));
  assert.deepEqual(row(A, "pavise").badges, [], "alone in its class, so there is nothing to be best of");
  assert.equal(A.counts.noUseCase, 3);
});

test("a perk is a use case, the weight gap has a floor, and the step is strict", () => {
  const A = build([
    piece("cap", { pointCost: 1, weight: 1, melee: 0.22, ballistic: 0.04 }),
    // The cap's numbers, a mining bonus on top: not dominated, since the cap cannot do that.
    piece("lamp", { pointCost: 3, weight: 4, melee: 0.22, ballistic: 0.04, miningBonus: { amount: 1 } }),
    // Twice the cap's weight but only 3 lb more: not "heavy for the step".
    piece("helm", { melee: 0.3, ballistic: 0.09 }),
    // Twice a rival's weight, HEAVY_GAP more, and exactly STEP better: clears, since the step is strict.
    piece("shield", { equipSlot: "WEAPON", pointCost: 2, weight: 10, melee: 0.35, ballistic: 0.13 }),
    piece("tower", { equipSlot: "WEAPON", pointCost: 5, weight: 10 + HEAVY_GAP, melee: 0.35 + STEP, ballistic: 0.13 + STEP }),
  ]);
  assert.deepEqual(row(A, "lamp").dominatedBy, []);
  assert.deepEqual(row(A, "lamp").outpricedBy, [], "a cheaper piece without the perk does not outprice it");
  assert.ok(row(A, "lamp").perks.includes("+1 ⬢ prospecting"));
  assert.deepEqual(row(A, "helm").heavyFor, []);
  assert.deepEqual(row(A, "tower").heavyFor, []);
});

test("the live catalog: every piece a player can come by has a use case", () => {
  const { buildModel } = require("../scripts/analysis/economy/model");
  const A = buildModel({}).armor;
  assert.ok(A.rows.length >= 20, `${A.rows.length} pieces`);
  for (const slug of ["plate-armor", "pavise", "knights-helmet", "energy-shield", "cataphract-armor"]) assert.ok(row(A, slug), `${slug} missing`);
  const bad = A.rows.filter((r) => r.verdict === "no use case").map((r) => `${r.name}: ${[...r.twins.map((x) => `twin of ${x}`), ...r.dominatedBy.map((x) => `dominated by ${x}`)].join(", ")}`);
  assert.deepEqual(bad, [], "SMITHING.md §4a: no twin, and nothing dominated inside its slot");
  const look = A.rows.filter((r) => r.verdict === "worth a look").map((r) => `${r.name}: ${[...r.outpricedBy.map((x) => `outpriced by ${x}`), ...r.heavyFor.map((x) => `heavy over ${x}`)].join(", ")}`);
  assert.deepEqual(look, [], "nothing outpriced at half the points, nothing heavy for its step");
  // Loot never takes part.
  assert.equal(row(A, "cataphract-armor").verdict, "kit or loot");
  // The turret column is the live curve: Light Infantry Armour's 52% from DEPOT.md §0i.
  assert.equal(Math.round(row(A, "light-infantry-armour").turret * 100), 52);
});
