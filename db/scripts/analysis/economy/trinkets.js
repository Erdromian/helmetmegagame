// Trinket forging, worked out (docs/systemdocs/TRINKETS.md).
//
// A smith spends a whole Move and 4 ⬢, slots up to two stones, and rolls a d6. The face is a tier and
// the tier sets the price: round(base + mult × the stones' summed inlay). The price is what the Merchant
// pays. Everything here is read from the game: the tier table and the skilled floor from
// db/lib/trinketPass.js, the gate constants from db/lib/constants.js, the stones from docs/tags.yaml, and
// where each stone drops from the loot tables.
//
// Money is ¢. The 4 ⬢ is spent at the Depot's import price. A stone a smith mined is valued at what it
// would have sold for raw (the forgone sale); a stone bought is valued at the shelf price.

const fs = require("fs");
const path = require("path");
const trinketPass = require("../../../lib/trinketPass");
const { taxOn } = require("../../../lib/trainDeparturePass");
const { trinketTaxOn } = require("./trinketPick");
const { TRINKET_RESOURCE_COST, TRINKET_INLAY_SLOTS } = require("../../../lib/constants");

const REPO = path.resolve(__dirname, "../../../..");

// The cost and the slots are db/lib/constants.js's, the same numbers the request action and the
// sheet's button read. The skilled floor still lives in the pass as a literal, so it is read out of
// the file; if that pattern stops matching, the report stops rather than quietly using a stale number.
function readGate() {
  const rel = "db/lib/constants.js";
  const passText = fs.readFileSync(path.join(REPO, "db/lib/trinketPass.js"), "utf8");
  const floor = /face < (\d)/.exec(passText);
  if (!floor) throw new Error("trinkets.js: could not find the skilled floor in db/lib/trinketPass.js#clampFace.");
  return { resources: TRINKET_RESOURCE_COST, slotsMin: 0, slotsMax: TRINKET_INLAY_SLOTS, floorFace: Number(floor[1]), source: rel };
}

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// `tax(gross)` is the model's sell tax at the run's rate: a Trinket is sold at the counter, so its price pays it.
function buildTrinkets({ get, list, rv, rvMined, producerDrops, profitTiers, moveValue, tax = () => 0 }) {
  const gate = readGate();
  const TIERS = trinketPass.TIERS.slice(1);
  const dieCost = gate.resources * rv.buy; // the ¢ a Trinket's ⬢ costs at the Depot

  // ---- the die, for four kinds of smith ------------------------------------------------------------
  const faces = (lucky) => [1, 2, 3, 4, 5, 6].map((k) => (lucky ? (2 * k - 1) / 36 : 1 / 6));
  const holders = [
    { id: "apprentice", label: "Smithing", skilled: false, lucky: false },
    { id: "skilled", label: "Smithing II", skilled: true, lucky: false },
    { id: "apprentice-lucky", label: "Smithing + Lucky", skilled: false, lucky: true },
    { id: "skilled-lucky", label: "Smithing II + Lucky", skilled: true, lucky: true },
  ].map((h) => {
    const p = faces(h.lucky);
    const tierP = TIERS.map(() => 0);
    p.forEach((prob, i) => {
      const face = h.skilled && i + 1 < gate.floorFace ? gate.floorFace : i + 1;
      tierP[face - 1] += prob;
    });
    const eBase = TIERS.reduce((s, t, i) => s + tierP[i] * t.base, 0);
    const eMult = TIERS.reduce((s, t, i) => s + tierP[i] * t.mult, 0);
    // What a bare Trinket clears, before tax and at the run's sell tax, over the tiers the die can give.
    const bare = (net) => TIERS.reduce((sum, t, i) => sum + tierP[i] * (t.base - dieCost - (net ? tax(t.base) : 0)), 0);
    return { ...h, tierP, eBase, eMult, bareRaw: bare(false), bareProfit: bare(true) };
  });
  const H = Object.fromEntries(holders.map((h) => [h.id, h]));

  // ---- the stones ----------------------------------------------------------------------------------
  const rate = (zone, col, slug) => producerDrops.prospecting[zone][col].find((r) => r.slug === slug)?.p ?? 0;
  const cavingRate = (zone, slug) => producerDrops.caving[zone].find((r) => r.slug === slug)?.p ?? 0;
  const stones = list
    .filter((t) => t.inlayValue != null)
    .map((t) => {
      const sold = t.sellablePrice ?? 0;
      const shelf = t.depotPrice ?? null;
      const ruled = t.sellablePrice != null ? 2 * t.sellablePrice + 4 : null;
      const cap = shelf != null ? shelf - 1 : null;
      const expected = ruled == null ? null : cap != null ? Math.min(ruled, cap) : ruled;
      return {
        slug: t.slug,
        name: t.name,
        group: t.group,
        sold,
        shelf,
        inlay: t.inlayValue,
        ruled,
        expected,
        gambitBonus: t.gambitBonus ?? 0,
        cavesPlain: rate("caves", "plain", t.slug),
        cavesSkilled: rate("caves", "skilled", t.slug),
        depthsPlain: rate("depths", "plain", t.slug),
        depthsSkilled: rate("depths", "skilled", t.slug),
        // Lucky's second draw (MINING.md §3b), the same two columns again.
        cavesPlainLucky: rate("caves", "plainLucky", t.slug),
        cavesSkilledLucky: rate("caves", "skilledLucky", t.slug),
        depthsPlainLucky: rate("depths", "plainLucky", t.slug),
        depthsSkilledLucky: rate("depths", "skilledLucky", t.slug),
        cavingCaves: cavingRate("caves", t.slug),
        cavingDepths: cavingRate("depths", t.slug),
        // What forging one adds, over selling it, for a smith of each kind.
        uplift: Object.fromEntries(holders.map((h) => [h.id, h.eMult * t.inlayValue - sold])),
        overShelf: shelf != null && t.inlayValue >= shelf,
      };
    })
    .sort((a, b) => a.inlay - b.inlay);

  // ---- the best stone pairs -------------------------------------------------------------------------------
  // Profit per Move for a Trinket made of these stones: the price it sells for, less the 4 ⬢, less what
  // the stones cost the smith. Own ore counts at its raw sale price; a shelf stone at the shelf price.
  const cost = (s, basis) => (basis === "shelf" ? s.shelf : s.sold);
  const combos = [];
  const eligible = (basis) => stones.filter((s) => (basis === "shelf" ? s.shelf != null : true));
  // Expected profit of one Trinket: each tier prices the stones its own way and is rounded like the game rounds
  // it (`round(base + mult × inlay)`), and the sell tax comes off that tier's sale price.
  const expected = (h, inlay, stoneCost, net) =>
    TIERS.reduce((sum, t, i) => {
      const price = Math.round(t.base + t.mult * inlay);
      return sum + h.tierP[i] * (price - dieCost - stoneCost - (net ? tax(price) : 0));
    }, 0);
  for (const basis of ["own", "shelf"]) {
    const pool = eligible(basis);
    const sets = [[]];
    pool.forEach((a, i) => {
      sets.push([a]);
      pool.slice(i + 1).forEach((b) => sets.push([a, b]));
    });
    for (const ins of sets) {
      const stoneCost = ins.reduce((n, s) => n + cost(s, basis), 0);
      const row = { basis, stones: ins.map((s) => s.name), slugs: ins.map((s) => s.slug), inlay: ins.reduce((n, s) => n + s.inlay, 0), stoneCost };
      for (const h of holders) {
        row[h.id] = expected(h, row.inlay, stoneCost, true);
        row[`${h.id}Raw`] = expected(h, row.inlay, stoneCost, false);
      }
      combos.push(row);
    }
  }
  const best = (basis, holder, n = 10, filter = () => true) =>
    combos.filter((c) => c.basis === basis && filter(c)).sort((a, b) => b[holder] - a[holder]).slice(0, n);
  // An Arkenstone is a quest-grade find (about 1 press in a hundred in the Depths), so the ranked lists
  // leave it to its own line rather than letting it top every table.
  const noArk = (c) => !c.slugs.includes("arkenstone");
  const bestOwn = best("own", "skilled", 12, noArk);
  const bestShelf = best("shelf", "skilled", 8);
  const bestShelfApprentice = best("shelf", "apprentice", 1)[0];
  const ark = combos.filter((c) => c.basis === "own" && c.slugs.includes("arkenstone") && c.slugs.length <= 2).sort((a, b) => b.skilled - a.skilled)[0];

  // ---- a prospector who forges what they dig up ------------------------------------------------------------
  // Per press: every stone that drops is forged in pairs, a Trinket a pair, on the rest turn a miner has
  // anyway (a quarter of a Move a turn at a press every other turn, well under the one Move there is).
  const perPress = (zone, col, h) => {
    const rows = stones.map((s) => ({ s, p: s[`${zone}${col[0].toUpperCase()}${col.slice(1)}`] })).filter((r) => r.p > 0);
    const stoneCount = rows.reduce((n, r) => n + r.p, 0);
    const trinkets = stoneCount / gate.slotsMax;
    const inlay = rows.reduce((n, r) => n + r.p * r.s.inlay, 0);
    const forgone = rows.reduce((n, r) => n + r.p * r.s.sold, 0);
    const revenue = trinkets * h.eBase + h.eMult * inlay;
    const raw = revenue - trinkets * dieCost - forgone;
    // The tax is per Trinket sold, on each tier's own price (as `expected` does), for a Trinket carrying the
    // average stones.
    const inlayEach = trinkets > 0 ? inlay / trinkets : 0;
    const net = raw - trinkets * TIERS.reduce((sum, t, i) => sum + h.tierP[i] * tax(t.base + t.mult * inlayEach), 0);
    return { stones: stoneCount, trinkets, revenue, forgone, raw, net };
  };
  // The Lucky columns are the stones a Lucky miner digs up; which smith forges them is the holder, as before.
  const prospector = {};
  for (const zone of ["caves", "depths"]) {
    for (const col of ["plain", "skilled", "plainLucky", "skilledLucky"]) {
      prospector[`${zone}:${col}`] = Object.fromEntries(holders.map((h) => [h.id, perPress(zone, col, h)]));
    }
  }

  // ---- checks against the doc -----------------------------------------------------------------------------------
  const docTiers = [
    [1, 0.5], [7, 0.75], [15, 1], [19, 1.25], [23, 1.5], [27, 2],
  ];
  const tiersMatchDoc = TIERS.every((t, i) => t.base === docTiers[i][0] && t.mult === docTiers[i][1]);
  const overShelf = stones.filter((s) => s.overShelf);
  const offRule = stones.filter((s) => s.expected != null && s.inlay !== s.expected);
  const topWage = profitTiers.length ? Math.max(...profitTiers.map((t) => t.rate)) : 0;
  // The doc's own hazard is "buy a stone, forge it, sell it at a profit"; the shelf round trip is that.
  // Lucky is one tag anybody may hold, and it keeps the better of two dice, so it belongs on the same round trip:
  // a smith who holds it clears far more a Move than one who does not, off the same shelf.
  const shelfLoop = {
    bestApprentice: bestShelfApprentice,
    bestSkilled: bestShelf[0],
    bestApprenticeLucky: best("shelf", "apprentice-lucky", 1)[0],
    bestSkilledLucky: best("shelf", "skilled-lucky", 1)[0],
    topWage,
  };
  // The best shelf round trip for a Smithing smith can be to slot no stone at all, so the activity rows take the
  // best set that does use one.
  const withStones = (holder) => combos.filter((c) => c.basis === "shelf" && c.stones.length > 0).sort((a, b) => b[holder] - a[holder])[0];
  shelfLoop.bestApprenticeWithStones = withStones("apprentice");
  shelfLoop.bestSkilledWithStones = withStones("skilled");
  shelfLoop.bestSkilledLuckyWithStones = withStones("skilled-lucky");

  // ---- the stone picker's data (trinketPick.js) ------------------------------------------------------------------
  // Every 0–2 stone set off the Merchant's shelf, and what the page's slider needs to re-rank them for any smith
  // and any sell tax. The tax rule is restated in trinketPick.js for the browser, so it is checked against the
  // game's own here, at every rate a slider can reach, before anything is written.
  for (let rate = 0; rate <= 100; rate++) {
    for (let gross = 0; gross <= 600; gross++) {
      if (trinketTaxOn(gross, rate) !== taxOn(gross, rate)) throw new Error(`trinketPick.js#trinketTaxOn disagrees with trainDeparturePass.js#taxOn at ${gross} ¢, ${rate}%.`);
    }
  }
  const pts = (slug) => get(slug)?.pointCost ?? 0;
  const picker = {
    tiers: TIERS.map((t) => ({ base: t.base, mult: t.mult })),
    tierP: Object.fromEntries(holders.map((h) => [h.id, h.tierP])),
    dieCost,
    points: { skilled: pts("smithing-skilled"), lucky: pts("lucky") },
    // The ⬢ a Trinket's die costs is bought; an ingot kept back is worth what it cracks for (⬢ at the midpoint of the
    // Depot's two prices, what it barters for) or what the counter pays, whichever is more.
    rv: { sell: rv.sell, mid: rv.mid },
    // Every stone that also cracks into ⬢: the metals. Smelted ones name their ore and what a smelt takes.
    ingots: stones
      .filter((s) => get(s.slug)?.consumesIntoResources)
      .map((s) => {
        const t = get(s.slug);
        const req = t.craftable ? t.requirement : null;
        const ore = req?.items?.length === 1 ? get(typeof req.items[0] === "string" ? req.items[0] : req.items[0].tag) : null;
        return { name: s.name, inlay: s.inlay, sell: s.sold, cracks: t.consumesIntoResources, ore: ore?.name ?? null, smeltMoves: ore ? req.turnsCost ?? null : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    setups: [
      { id: "apprentice", label: "Smithing I" },
      { id: "skilled", label: "Smithing II" },
      { id: "apprentice-lucky", label: "Smithing I + Lucky" },
      { id: "skilled-lucky", label: "Smithing II + Lucky" },
    ],
    sets: combos.filter((c) => c.basis === "shelf").map((c) => ({ stones: c.stones, inlay: c.inlay, cost: c.stoneCost })),
  };

  return {
    gate,
    dieCost,
    tiers: TIERS,
    holders,
    stones,
    combos: { bestOwn, bestShelf, ark },
    prospector,
    shelfLoop,
    picker,
    checks: { tiersMatchDoc, overShelf, offRule },
    // Expected profit of one Trinket for a smith kind, given the inlay and what the stones cost, at the run's tax by default.
    expectedProfit: (id, inlay, stoneCost = 0, net = true) => expected(H[id], inlay, stoneCost, net),
    moveValue,
  };
}

module.exports = { buildTrinkets };
