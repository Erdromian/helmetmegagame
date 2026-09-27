// What the sell tax does to each business.
//
// The Meister sets Depot.sellTaxRate, a whole percent from 0 to 100, and every sale the drop box settles pays it
// on its gross (db/lib/trainDeparturePass.js#taxOn) before the seller is paid; the tax lands in the Vault. It
// touches a counter sale and nothing else: not a Depot purchase, a trade between players, food eaten, or ⬢
// bartered. So each business here is split three ways, per turn:
//   - taxable gross: what it sells at the counter, at what the counter pays. A miner's ⬢ count at the 1 ¢
//     sell-back here, not the barter midpoint the wage table uses, because only a counter sale is taxed;
//   - untaxed inputs: what it buys (⬢, ingredients, seed, stones), which the tax never touches;
//   - untaxed value: anything it makes that never meets the counter (a gatherer's food).
// Net at a rate is gross × (1 − rate) + untaxed value − inputs. The table uses the exact share; the game rounds
// each settled sale, which the lede explains.

const { taxOn } = require("../../../lib/trainDeparturePass");
const { median } = require("./stats");

const RATES = [0, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

function buildSellTax({ activities, baselines, profitRows, trinkets, params, rv }) {
  const byId = (id) => activities.find((a) => a.id === id);
  const rows = [];
  const add = (key, { gross, inputs = 0, untaxed = 0, note = "" }) => {
    if (gross == null || !Number.isFinite(gross)) return;
    const netAt = Object.fromEntries(RATES.map((r) => [r, gross * (1 - r / 100) + untaxed - inputs]));
    // Net hits zero where gross × rate = gross + untaxed − inputs. At 100% the tax has taken all the gross; if
    // the business is still whole then, no rate breaks it.
    const whole = untaxed - inputs >= 0;
    const breakEven = whole || gross <= 0 ? null : Math.max(0, (100 * (gross + untaxed - inputs)) / gross);
    rows.push({ key, gross, inputs, untaxed, netAt, breakEven, note });
  };

  // Miners and the gatherer: ⬢ sold back at the counter, and the drops sold there too.
  const mined = (a) => (a.resourcesPerPress * rv.sell + (a.findsSold ?? a.dropsPerAction)) * a.duty;
  for (const [key, id] of [["Miner, pickaxe only (Caves)", "mine:Caves:unskilled"], ["Prospector (Caves)", "mine:Caves:skilled"]]) {
    const a = byId(id);
    if (a) add(key, { gross: mined(a), note: `⬢ at the ${rv.sell} ¢ sell-back, drops at the counter` });
  }
  const g = activities.find((a) => a.kind === "gather");
  if (g) add(`Gatherer (${g.name.replace(/^Gather — /, "").replace(/, no tool$/, "")})`, { gross: mined(g), untaxed: (g.dropsPerAction - g.findsSold) * g.duty, note: "the food it finds is eaten, not sold" });

  // A craft: its output sold, its ⬢ bought at the Depot and its ingredients bought, a Move at a time.
  const craft = (a) => (a && a.totalMoves > 0 && a.revenue != null ? { gross: a.revenue / a.totalMoves, inputs: a.inputsBuy / a.totalMoves } : null);
  for (const b of baselines) {
    const c = craft(activities.find((a) => a.slug === b.slug && a.kind === "craft" && !a.distilled));
    if (c) add(b.key, { ...c, note: `⬢ bought at ${rv.buy} ¢` });
  }
  for (const family of ["smithing", "brewing"]) {
    const on = profitRows.filter((r) => r.points === 10 && r.family === family).sort((x, y) => x.got - y.got);
    const mid = on.length ? on[Math.floor((on.length - 1) / 2)] : null;
    const c = mid ? craft(activities.find((a) => a.slug === mid.slug && a.kind === "craft" && !a.distilled)) : null;
    if (c) add(`Median 10-point ${family} recipe: ${mid.name}`, { ...c, note: `the middle of ${on.length} on the rung, by raw profit a Move` });
  }

  // Farming pays no sell tax at all now: Foodstuffs never reach the counter, so there is no farm row
  // to add here (there was, briefly, for tobacco — the one crop that ever sold — before the rework).

  // Trinkets: the Trinket sold at its tier's price, the ⬢ and any shelf stones bought, one a Move. Each holder
  // slots the shelf stones that pay it best, so Lucky may pick a different pair from a plain Smithing II smith.
  // The stones are the 0% pick, held at every rate. The Trinket page's picker re-picks them as the tax rises
  // (cheaper stones, then none), so its break-even is later than this row's.
  const stonesOf = (set) => `${set?.stones?.length ? set.stones.join(" + ") : "no stones"} at every rate (the Trinket page re-picks them as the tax rises)`;
  const tr = byId("trinket:shelf:skilled");
  if (tr) add("Smith forging Trinkets (Smithing II, shelf stones)", { gross: tr.rawPerTurnBuy + tr.inputsBuy, inputs: tr.inputsBuy, note: `${stonesOf(trinkets.shelfLoop.bestSkilledWithStones)}; a Trinket's expected price over the die` });
  const lucky = trinkets.shelfLoop.bestSkilledLuckyWithStones;
  if (lucky) {
    const inputs = trinkets.dieCost + lucky.stoneCost;
    add("Smith forging Trinkets (Smithing II + Lucky, shelf stones)", {
      gross: trinkets.expectedProfit("skilled-lucky", lucky.inlay, lucky.stoneCost, false) + inputs,
      inputs,
      note: `${stonesOf(lucky)}; Lucky keeps the better of two dice`,
    });
  }
  // A miner who forges their own stones: the press's ⬢ and the drops they do not forge, sold, plus the Trinkets.
  const pick = byId("mine:Caves:unskilled");
  const forged = trinkets.prospector["caves:plain"]?.apprentice;
  if (pick && forged) {
    add("Miner-smith forging own stones (Caves, pick only)", {
      gross: (pick.resourcesPerPress * rv.sell + pick.dropsPerAction - forged.forgone + forged.revenue) * pick.duty,
      inputs: forged.trinkets * trinkets.dieCost * pick.duty,
      note: "stones forged rather than sold",
    });
  }

  // The Factory: cubes sold, nothing bought.
  const f = byId("factory:solo");
  if (f) add("Factory solo", { gross: f.rawPerTurn, note: "the cubes are the whole sale" });

  // What rounding does: the game rounds each sale row, so a single cheap item dodges a low rate.
  const dodgeBelow = [...Array(100).keys()].map((i) => i + 1).find((r) => taxOn(1, r) > 0) ?? null;
  return {
    rates: RATES,
    runRate: params.sellTaxRate,
    rows,
    dodgeBelow,
    stackExample: { units: 20, rate: 25, tax: taxOn(20, 25) },
    medianBreakEven: median(rows.map((r) => r.breakEven).filter((x) => x != null)),
  };
}

module.exports = { buildSellTax, RATES };
