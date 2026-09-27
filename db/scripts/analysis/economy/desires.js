// Desires as an income stream: which of them a person can satisfy by buying, making, consuming or owning
// something, what one claim costs, how often it can be claimed, and what a Tag Point is worth.
//
// A Desire is claimed afterwards ("I did this, here is how"), pays its tier in Tag Points, and cannot be
// claimed again until its cooldown has passed (docs/systemdocs/DESIRES.md §2). Two slots each lock for a
// turn after a claim, so however many Desires are open, a character claims at most once a turn. The catalog
// (tier, cooldown, once-per-game, who may claim) is read from docs/desires.yaml. Nothing in it says what a
// Desire COSTS, so the satisfier for each one below is a judgment, written down beside its price; the
// price itself is read from the tag catalog.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { SLOT_COST, SLOT_PAYOUTS } = require("../../../lib/slotText");

const REPO = path.resolve(__dirname, "../../../..");
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// The slot machine (DEPOT.md §0m): the stake and payouts are db/lib/slotText.js's. The ways are how three dice
// fall (6 triples, 12 runs, 90 pairs, 108 nothing, of 216), which db/test/slotMachine.test.js pins.
const SLOT = {
  stake: SLOT_COST,
  table: [
    { ways: 6, pays: SLOT_PAYOUTS.triple },
    { ways: 12, pays: SLOT_PAYOUTS.run },
    { ways: 90, pays: SLOT_PAYOUTS.pair },
    { ways: 108, pays: 0 },
  ],
};

// A Desire's `requires` block in words, following DESIRES.md §3: OR within an `any` list, every tag of `allTags`,
// AND across the lists, except that `combine: or` joins the role and tag lists with OR. The not-clauses are never
// part of that OR. Names come from the catalog and docs/roles.yaml, falling back to the slug.
function describeRequires(req, { roleName, tagName }) {
  if (!req) return "anyone";
  const any = [];
  if (req.anyRoles?.length) any.push(`role: ${req.anyRoles.map(roleName).join(" / ")}`);
  if (req.anyTags?.length) any.push(`tag: ${req.anyTags.map(tagName).join(" / ")}`);
  const parts = [];
  if (any.length) parts.push(req.combine === "or" && any.length > 1 ? `(${any.join(" or ")})` : any.join(" and "));
  if (req.allTags?.length) parts.push(`all of: ${req.allTags.map(tagName).join(" + ")}`);
  const not = [...(req.notRoles ?? []).map(roleName), ...(req.notTags ?? []).map(tagName)];
  if (not.length) parts.push(`not: ${not.join(", ")}`);
  return parts.join(" and ") || "anyone";
}
// What a `requires` block locks a Desire to: a role, a tag, or both.
const lockKinds = (req) => ({
  role: Boolean(req?.anyRoles?.length || req?.notRoles?.length),
  tag: Boolean(req?.anyTags?.length || req?.allTags?.length || req?.notTags?.length),
});

// `inputCost(slug)` is the model's one price for a recipe input (foodValue.js#inputCost).
function buildDesires({ get, list, rv, rvMined, moveValue, gameTurns, slots, lockTurns, cookingDishes, investments, startingPoints, foodFloor, inputCost }) {
  const doc = yaml.load(fs.readFileSync(path.join(REPO, "docs/desires.yaml"), "utf8"));
  const tpl = doc.desires;
  // Role names from docs/roles.yaml (grouped), tag names from the catalog.
  const roleNames = new Map();
  for (const group of Object.values(yaml.load(fs.readFileSync(path.join(REPO, "docs/roles.yaml"), "utf8")).groups ?? {})) {
    for (const [slug, r] of Object.entries(group ?? {})) if (r?.name) roleNames.set(slug, r.name);
  }
  const names = { roleName: (slug) => roleNames.get(slug) ?? slug, tagName: (slug) => get(slug)?.name ?? slug };

  // What one of a thing costs to get: the shelf price if the Depot stocks it, otherwise what it costs to
  // make (its ⬢ at the import price and its inputs), otherwise what it would sell for.
  const unit = (slug, depth = 0) => {
    const t = get(slug);
    if (!t) return { coin: 0, moves: 0, how: "not in the catalog" };
    if (t.depotPrice != null) return { coin: t.depotPrice, moves: 0, how: `${t.depotPrice} ¢ at the Depot${t.manifest && t.manifest !== "merchant" && t.manifest !== "general" ? ` (${t.manifest})` : ""}`, resale: t.sellablePrice ?? 0 };
    if (t.craftable && t.requirement && depth < 3) {
      const r = t.requirement;
      let coin = (r.resourceCost ?? 0) * rv.buy;
      for (const it of r.items ?? []) {
        const s = typeof it === "string" ? it : it.tag ?? it.anyOf?.[0];
        coin += (typeof it === "object" && it.count ? it.count : 1) * unit(s, depth + 1).coin;
      }
      return { coin, moves: r.turnsCost ?? 0, how: `made: ${r.resourceCost ?? 0} ⬢${(r.items ?? []).length ? " and its inputs" : ""}${r.turnsCost ? `, ${r.turnsCost} Move` : ""}`, resale: t.sellablePrice ?? 0 };
    }
    if (t.sellablePrice != null) return { coin: t.sellablePrice, moves: 0, how: `${t.sellablePrice} ¢ of sale value`, resale: 0 };
    return { coin: 0, moves: 0, how: "unpriced" };
  };

  // Cheapest thing the Depot stocks, and the cheapest round trip (buy it, sell it back).
  const shelfItems = list.filter((t) => t.depotPrice != null);
  const cheapestShelf = [...shelfItems].sort((a, b) => a.depotPrice - b.depotPrice)[0];
  const cheapestRoundTrip = [...shelfItems.filter((t) => t.sellablePrice != null)].sort((a, b) => a.depotPrice - a.sellablePrice - (b.depotPrice - b.sellablePrice) || a.depotPrice - b.depotPrice)[0];
  // The Desire verifies against a craft named "Lavish Meal" (docs/desires.yaml), so only that meal class counts.
  const cheapestLavish = (cookingDishes ?? []).filter((d) => d.mealClass === "lavish" && !d.unreachable.length).sort((a, b) => a.cost - b.cost)[0];
  // The slot machine, worked as a cost of getting a payout of at least N in one spin.
  const slotEv = SLOT.table.reduce((s, r) => s + (r.ways / 216) * r.pays, 0);
  const slotLoss = SLOT.stake - slotEv;
  const slotPay = (n) => SLOT.table.filter((r) => r.pays >= n).reduce((s, r) => s + r.ways / 216, 0);
  const slotCost = (n) => (slotPay(n) > 0 ? slotLoss / slotPay(n) : null);

  const S = []; // satisfiers
  const add = (slug, doThis, cost, extra = {}) => {
    const d = tpl[slug];
    if (!d) return;
    const spacing = Math.max(1, d.cooldownTurns ?? d.tier);
    S.push({
      slug,
      name: d.name,
      tier: d.tier,
      cooldown: d.cooldownTurns ?? d.tier,
      cooldownFromLadder: d.cooldownTurns != null,
      spacing,
      once: !!d.oncePerLife,
      who: describeRequires(d.requires, names),
      lock: lockKinds(d.requires),
      // How a GM checks the claim: the template's `verify:` string searched against the audit log, else judgement.
      verify: d.verify ?? null,
      checkedBy: d.verify ? `audit-log search for "${d.verify}"` : "GM judgement",
      open: !d.requires,
      doThis,
      coin: cost.coin,
      moves: cost.moves ?? 0,
      how: cost.how,
      capital: cost.capital ?? 0,
      resale: cost.resale ?? 0,
      note: extra.note ?? "",
      consumable: !!extra.consumable,
      variance: !!extra.variance,
      maxClaims: extra.maxClaims ?? (d.oncePerLife ? 1 : null),
      pointsPerTurn: d.tier / spacing,
      costPerPoint: cost.coin / d.tier,
      netCoin: cost.coin - (cost.resale ?? 0),
    });
  };

  // ---- consumables: every drink, smoke, drug and sweet is a real spend, on a flat 3-turn cooldown ------------
  const a = unit("alcohol");
  // Brewing one instead: its inputs at the model's input price (the cheapest option where the recipe offers a choice).
  const brew = get("alcohol")?.requirement;
  const slugOf = (x) => (typeof x === "string" ? x : x.tag);
  const brewCost = brew
    ? (brew.items ?? []).reduce((n, it) => n + (typeof it === "object" && it.count ? it.count : 1) * (it.anyOf ? Math.min(...it.anyOf.map((o) => inputCost(slugOf(o)))) : inputCost(slugOf(it))), 0) + (brew.resourceCost ?? 0) * rv.buy
    : null;
  const brewUnits = (brew?.items ?? []).reduce((n, it) => n + (typeof it === "object" && it.count ? it.count : 1), 0);
  add("drink-alcohol", "Drink an Alcohol", { coin: a.coin, how: a.how }, { consumable: true, note: brew ? `Or brew it yourself: ${brewUnits} ingredients and ${brew.turnsCost ?? 0} of a Move, about ${round1(brewCost)} ¢.` : "" });
  const rr = unit("ravenheart-red");
  add("drink-ravenheart-red", "Drink a Ravenheart Red", { coin: rr.coin, moves: rr.moves, how: rr.how }, { consumable: true });
  const sake = unit("sake");
  add("drink-sake", "Drink a Sake", { coin: sake.coin, how: sake.how }, { consumable: true });
  const moon = unit("moonshine");
  add("drink-moonshine", "Drink a Moonshine", { coin: 0, moves: 0.25, how: "made from Godflesh, no ⬢" }, { consumable: true, note: "Godflesh has to be got from the Factory." });
  const tea = unit("tea");
  add("drink-tea-or-coffee", "Drink a tea", { coin: tea.coin, how: tea.how }, { consumable: true });
  const cig = unit("cigarette");
  add("smoke-a-cigarette", "Smoke a cigarette", { coin: cig.coin, how: cig.how }, { consumable: true });
  const bliss = unit("bliss");
  add("take-a-drug", "Take a Bliss", { coin: bliss.coin, how: bliss.how }, { consumable: true, note: "Heroin and Changa are 2 ¢ at the Black Market, and addictive." });
  add("try-a-new-drug", "Take a drug you have not taken", { coin: 2.3, how: "about 2–3 ¢ a drug: heroin, changa, bliss" }, { consumable: true, maxClaims: 3, note: "One claim per drug, so about three of them." });
  const candy = unit("sugar-candy");
  add("eat-sweets", "Eat a Sugar Candy", { coin: candy.coin, how: candy.how }, { consumable: true });
  if (cheapestLavish) add("lavish-meal", `Eat a ${cheapestLavish.name}`, { coin: cheapestLavish.cost, moves: cheapestLavish.moves, how: `${cheapestLavish.inputs.join(" + ")}` }, { consumable: true, note: "Needs Cooking II (10 points) and a kitchen to make, or a friend who has both." });

  // ---- buying something ---------------------------------------------------------------------------------------
  add("make-a-merchant-purchase", `Buy ${cheapestShelf?.name}`, { coin: cheapestShelf?.depotPrice ?? 0, how: `${cheapestShelf?.depotPrice} ¢, the cheapest thing on the shelf`, resale: cheapestShelf?.sellablePrice ?? 0 });
  const jew = unit("jewelry");
  add("get-jewelry", "Buy Jewelry, and sell it back", { coin: jew.coin, how: jew.how, resale: jew.resale }, { note: "It has no cooldown of its own, so only the slots throttle it, and the Depot buys it back." });
  const box = unit("boombox");
  add("listen-to-boombox", "Own a Boombox, and play it", { coin: 0, capital: box.coin, how: `${box.coin} ¢ once, then free` }, { note: "One purchase, then a free claim every five turns." });
  add("hold-100", "Carry 100 ¢", { coin: 0, capital: 100, how: "no spend, but 100 ¢ tied up" }, { note: `A gate is not a throttle: it costs nothing to keep 100 ¢ in the pocket, so it takes the free-tap ladder, a ${tpl["hold-100"]?.cooldownTurns ?? tpl["hold-100"]?.tier}-turn cooldown rather than the tier's ${tpl["hold-100"]?.tier}.` });
  // gambling, on the Den's slot machine
  for (const [slug, n, label] of [["win-5-gambling", 5, "a 5 ¢ payout"], ["win-10-gambling", 10, "a 10 ¢ payout"], ["win-25-gambling-one-game", 25, "a 25 ¢ payout in one spin"], ["win-50-gambling-one-game", 50, "a 50 ¢ payout in one spin"]]) {
    const c = slotCost(n);
    if (c != null) add(slug, `Spin the slot machine until it pays ${label}`, { coin: c, how: `about ${Math.round(1 / slotPay(n))} spins of 5 ¢ (${Math.round((1 / slotPay(n)) * 5)} ¢ staked), 5.6% house edge` }, { variance: true, note: "Any payout at least that big counts. Undertown only, while the Exactor is solvent." });
  }

  // ---- role- and tag-gated, still purchasable ----------------------------------------------------------------------
  const pa = get("plate-armor");
  if (pa) {
    const c = unit("plate-armor");
    add("craft-plate-armor", "Craft a Plate Armor", { coin: c.coin, moves: c.moves, how: c.how, resale: pa.sellablePrice ?? 0 }, { note: "The Depot pays back more than it costs." });
  }
  const cyb = get("cybernetic-arm");
  if (cyb) add("install-cybernetic", "Install a Cybernetic Arm", { coin: unit("cybernetic-arm").coin, moves: cyb.requirement?.turnsCost ?? 0, how: unit("cybernetic-arm").how, resale: cyb.sellablePrice ?? 0 });
  const mr = get("motorcycle");
  if (mr) add("metal-ride", "Buy a Motorcycle", { coin: mr.depotPrice, how: `${mr.depotPrice} ¢, and it sells back for ${mr.sellablePrice}`, resale: mr.sellablePrice ?? 0 });
  const sh = get("wayside-shrine");
  if (sh) add("build-wayside-shrine", "Build a Wayside Shrine", { coin: unit("wayside-shrine").coin, moves: sh.requirement?.turnsCost ?? 0, how: unit("wayside-shrine").how });
  const sq = get("squeeze");
  if (sq) add("sell-squeeze-to-the-merchant", "Sell a cube of Squeeze", { coin: -(sq.sellablePrice ?? 0), how: `it pays ${sq.sellablePrice} ¢` });
  const ration = foodFloor?.anyone;
  if (ration) add("feed-the-poor", `Give away a ${ration.name}`, { coin: ration.buy, how: `${ration.buy} ¢, a ${ration.name}` });
  add("sample-every-alcohol", "Drink each of Alcohol, Sake, Moonshine and Ravenheart Red", { coin: a.coin + sake.coin + 0 + rr.coin, how: "one of each, once" });

  // ---- the ceiling ------------------------------------------------------------------------------------------------------
  const claimsPerTurn = slots / (lockTurns + 1);

  // Play the open, repeatable Desires out over a game: one claim a turn, best-paying first.
  const simulate = (label, policy, keep = () => true) => {
    const pool = S.filter((s) => s.open && s.maxClaims !== 1 && s.coin >= 0 && !s.variance && keep(s));
    const last = new Map();
    const uses = new Map();
    let points = 0;
    let coin = 0;
    let capital = 0;
    const capitalSeen = new Set();
    const timeline = [];
    for (let turn = 1; turn <= gameTurns; turn++) {
      const ready = pool.filter((s) => (last.get(s.slug) == null || turn - last.get(s.slug) >= s.spacing) && (s.maxClaims == null || (uses.get(s.slug) ?? 0) < s.maxClaims));
      if (!ready.length) continue;
      const pick = [...ready].sort(
        policy === "cheapest"
          ? (x, y) => x.netCoin / x.tier - y.netCoin / y.tier || y.tier - x.tier
          : (x, y) => y.tier - x.tier || x.netCoin - y.netCoin,
      )[0];
      last.set(pick.slug, turn);
      uses.set(pick.slug, (uses.get(pick.slug) ?? 0) + 1);
      points += pick.tier;
      coin += pick.netCoin;
      if (pick.capital && !capitalSeen.has(pick.slug)) {
        capitalSeen.add(pick.slug);
        capital = Math.max(capital, pick.capital);
      }
      timeline.push(pick.slug);
    }
    return { label, policy, points, coin, capital, claims: timeline.length, perPoint: points ? coin / points : 0, used: [...uses].map(([slug, n]) => ({ slug, n })).sort((x, y) => y.n - x.n) };
  };
  // A: everything open, including the free ones. B: only what a person with no capital and no Godflesh can
  // buy off a shelf, so every point costs coin.
  const plans = [
    simulate("Everything open, best-paying first", "points"),
    simulate("Coin only: shelf-bought goods, nothing held, no Godflesh", "points", (s) => s.capital === 0 && s.coin > 0 && !/Godflesh/.test(s.note) && !/Cooking II/.test(s.note)),
  ];

  // ---- what a point buys ------------------------------------------------------------------------------------------------------
  // The skills and kit a point can be spent on mid-game, from the investment table, per point of cost.
  const buys = investments.rows
    // A consumed thing buys one use, not a point's worth of turns, so it is not a use of a point.
    .filter((r) => r.points > 0 && r.gain > 0 && r.lasts === "durable" && ["skill", "skill + kit", "tool", "consumable", "building"].includes(r.kind))
    .map((r) => ({ name: r.name, points: r.points, gain: r.gain, perPoint: r.gain / r.points, overGame: r.gain * gameTurns / r.points, coin: r.allIn }))
    .sort((x, y) => y.perPoint - x.perPoint);
  // A point's worth in coin over the game: what the best skill it buys returns per point, over the turns left.
  const pointValue = buys.length ? buys[0].overGame : null;
  const cheapOpen = S.filter((s) => s.open && s.maxClaims !== 1 && s.coin > 0).sort((x, y) => x.costPerPoint - y.costPerPoint);

  return {
    slots,
    lockTurns,
    claimsPerTurn,
    startingPoints,
    satisfiers: S,
    plans,
    buys,
    pointValue,
    cheapestOpen: cheapOpen[0] ?? null,
    slot: { stake: SLOT.stake, ev: slotEv, edge: slotLoss / SLOT.stake },
    count: {
      total: Object.keys(tpl).length,
      satisfiable: S.length,
      open: S.filter((s) => s.open).length,
      // Of the satisfiable ones: locked to a role only, to a tag only, and to both.
      roleOnly: S.filter((s) => s.lock.role && !s.lock.tag).length,
      tagOnly: S.filter((s) => s.lock.tag && !s.lock.role).length,
      both: S.filter((s) => s.lock.role && s.lock.tag).length,
      verified: S.filter((s) => s.verify).length,
    },
  };
}

module.exports = { buildDesires };
