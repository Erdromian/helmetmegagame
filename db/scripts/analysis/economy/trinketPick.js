// The Trinket page's stone picker: which shelf stones to buy for a given smith and sell tax.
//
// Pure functions with no requires and no outer scope, because report.js ships their own source text to
// the browser (Function.prototype.toString) so the slider re-ranks the table with the SAME arithmetic the
// report used to draw it. Anything they need arrives in `D`, the data trinkets.js#picker builds:
//   D.tiers   [{ base, mult }] for faces 1–6, from db/lib/trinketPass.js
//   D.tierP   { holderId: [p1…p6] }, the chance of each tier for that smith (skilled floor, Lucky)
//   D.dieCost the ¢ a Trinket's ⬢ costs at the Depot
//   D.sets    [{ stones: [names], inlay, cost }], every 0–2 stone set off the Merchant's shelf
//   D.points  { skilled, lucky }, what Smithing II and Lucky cost in skill points
//   D.setups  [{ id, label }], the four smiths the matrix has a column for
//   D.ingots  [{ name, inlay, sell, cracks, ore, smeltMoves }], the stones that also crack into ⬢
//   D.rv      { sell, mid }, the ⬢'s sell-back and the midpoint an ingot kept back is valued at
// The render functions below return HTML strings, so the first view (written by report.js) and every move of
// the slider (in the browser) are drawn by the same code.

// The Meister's cut on one sale, rounded: db/lib/trainDeparturePass.js#taxOn, restated here because this
// file must run in a browser. trinkets.js checks the two agree at every rate before the report is written.
function trinketTaxOn(gross, rate) {
  const pct = Math.max(0, Math.min(100, Math.trunc(rate || 0)));
  if (!pct) return 0;
  return Math.min(gross, Math.round((gross * pct) / 100));
}

// Every shelf set for one smith at one rate, best first: the average sale, the tax on it, and the net a
// Move once the ⬢ and the stones are paid for.
function trinketPick(D, holderId, rate) {
  const p = D.tierP[holderId];
  return D.sets
    .map((s) => {
      let price = 0;
      let tax = 0;
      D.tiers.forEach((t, i) => {
        const sale = Math.round(t.base + t.mult * s.inlay);
        price += p[i] * sale;
        tax += p[i] * trinketTaxOn(sale, rate);
      });
      return { stones: s.stones, inlay: s.inlay, cost: s.cost, price, tax, net: price - tax - D.dieCost - s.cost };
    })
    .sort((a, b) => b.net - a.net);
}

// Smithing II or Lucky, from Smithing I, at one rate: each setup's best set, and what each point bought.
function trinketUpgrade(D, rate) {
  const rows = [
    { id: "apprentice", label: "Smithing I (where a Metalsmith starts)", points: 0 },
    { id: "skilled", label: "+ Smithing II", points: D.points.skilled },
    { id: "apprentice-lucky", label: "+ Lucky", points: D.points.lucky },
    { id: "skilled-lucky", label: "+ both", points: D.points.skilled + D.points.lucky },
  ].map((u) => {
    const best = trinketPick(D, u.id, rate)[0];
    return Object.assign({}, u, { net: best.net, stones: best.stones });
  });
  rows.forEach((u) => {
    u.gain = u.net - rows[0].net;
    u.perPoint = u.points ? u.gain / u.points : null;
  });
  return rows;
}

// The lowest whole-percent tax at which a smith's best set no longer clears anything, or null if none does.
function trinketBreakEven(D, holderId) {
  for (let rate = 0; rate <= 100; rate++) if (trinketPick(D, holderId, rate)[0].net <= 0) return rate;
  return null;
}

function trinketFmt(n) {
  return Number(n).toFixed(1).replace(/\.0+$/, "");
}

function trinketEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// The matrix: every shelf set down the side, every smith across, ¢ a Move at this rate. The best set in each
// column is marked; a set that loses money is in red.
function trinketMatrixBody(D, rate) {
  const byKey = (list) => new Map(list.map((r) => [r.stones.join("+"), r]));
  const cols = D.setups.map((u) => {
    const ranked = trinketPick(D, u.id, rate);
    return { best: ranked[0], rows: byKey(ranked) };
  });
  return D.sets
    .map((s) => {
      const key = s.stones.join("+");
      const cells = cols
        .map((c) => {
          const r = c.rows.get(key);
          const cls = [r === c.best && r.net > 0 ? "best" : "", r.net < 0 ? "neg" : ""].filter(Boolean).join(" ");
          return `<td class="num${cls ? ` ${cls}` : ""}">${trinketFmt(r.net)}</td>`;
        })
        .join("");
      return `<tr><td>${trinketEsc(s.stones.join(" + ") || "no stones")}</td><td class="num">${s.cost}</td>${cells}</tr>`;
    })
    .join("");
}

// One line under the slider: what each smith should buy at this rate.
function trinketMatrixSummary(D, rate) {
  const parts = D.setups.map((u) => {
    const best = trinketPick(D, u.id, rate)[0];
    const what = best.net > 0 ? `${trinketEsc(best.stones.join(" + ") || "no stones")}, ${trinketFmt(best.net)} ¢` : `nothing pays (best ${trinketFmt(best.net)} ¢)`;
    return `<b>${trinketEsc(u.label)}</b>: ${what}`;
  });
  return `At a ${rate}% sell tax, the best buy a Move is ${parts.join("; ")}.`;
}

function trinketUpgradeBody(D, rate) {
  return trinketUpgrade(D, rate)
    .map((u) => {
      const be = trinketBreakEven(D, u.id);
      return `<tr><td>${trinketEsc(u.label)}</td><td class="num">${u.points || "—"}</td><td class="num${u.net < 0 ? " neg" : ""}">${trinketFmt(u.net)}</td><td class="num">${u.points ? trinketFmt(u.gain) : "—"}</td><td class="num">${u.perPoint == null ? "—" : u.perPoint.toFixed(2)}</td><td class="num">${be == null ? "never" : `${be}%`}</td><td>${trinketEsc(u.stones.join(" + ") || "no stones")}</td></tr>`;
    })
    .join("");
}

// Two of your own ingots: forge them into a Trinket, or keep them. Keeping is cracking both for ⬢ (at the
// midpoint) or selling both at the counter (taxed), whichever is worth more; the gain is what forging adds.
function trinketIngots(D, holderId, rate) {
  const p = D.tierP[holderId];
  return D.ingots.map((g) => {
    const keep = Math.max(g.cracks * D.rv.mid, g.sell - trinketTaxOn(g.sell, rate));
    let net = 0;
    D.tiers.forEach((t, i) => {
      const sale = Math.round(t.base + t.mult * 2 * g.inlay);
      net += p[i] * (sale - trinketTaxOn(sale, rate));
    });
    return { name: g.name, keep, crack: g.cracks * D.rv.mid >= g.sell - trinketTaxOn(g.sell, rate), gain: net - D.dieCost - 2 * keep };
  });
}

function trinketIngotBody(D, rate) {
  const cols = D.setups.map((u) => trinketIngots(D, u.id, rate));
  return D.ingots
    .map((g, i) => {
      const k = cols[0][i];
      const cells = cols.map((c) => `<td class="num${c[i].gain < 0 ? " neg" : ""}">${c[i].gain >= 0 ? "+" : ""}${trinketFmt(c[i].gain)}</td>`).join("");
      return `<tr><td>${trinketEsc(g.name)}${g.ore ? ` <span class="mute">(${trinketEsc(g.ore)})</span>` : ""}</td><td class="num">${trinketFmt(2 * k.keep)} ¢ ${k.crack ? "cracked" : "sold"}</td>${cells}</tr>`;
    })
    .join("");
}

module.exports = { trinketTaxOn, trinketPick, trinketUpgrade, trinketBreakEven, trinketFmt, trinketEsc, trinketMatrixBody, trinketMatrixSummary, trinketUpgradeBody, trinketIngots, trinketIngotBody };
