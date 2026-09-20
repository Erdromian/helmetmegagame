#!/usr/bin/env node
// Renders the economic model (./model.js) as a report you can open.
//
//   npm run economy:report                    # -> economy-report/index.html
//   npm run economy:report -- --players 150   # a bigger town
//   npm run economy:report -- --out /tmp/x    # somewhere else
//
// Read-only: touches no database and posts nothing. The output directory is
// gitignored on purpose — a report checked in is a second copy of the numbers,
// which is exactly the drift this exists to prevent. Regenerate it instead.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { buildModel } = require("./model");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const REPO = path.resolve(__dirname, "../../../..");
const outDir = path.resolve(flag("out", path.join(REPO, "economy-report")));
const players = Number(flag("players", 100));

const model = buildModel({ players });
const { params } = model;

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim();
} catch {
  /* not a git checkout; fine */
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(d).replace(/\.0+$/, ""));
const FAMILIES = [...new Set(model.activities.map((a) => a.family))];
const famIndex = (f) => FAMILIES.indexOf(f) % 10;
const famColor = (f) => `var(--c${famIndex(f)})`;

function table({ cols, rows, id, sortable = true }) {
  const head = cols.map((c, i) => `<th data-i="${i}" class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const v = c.get(r);
            const sortVal = c.sort ? c.sort(r) : c.num ? v : String(v ?? "");
            const style = c.style ? c.style(r) : "";
            return `<td class="${c.num ? "num" : ""}" data-v="${esc(sortVal ?? "")}"${style ? ` style="${style}"` : ""}>${
              c.raw ? v : esc(v ?? "—")
            }</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table${sortable ? ' class="sortable"' : ""}${id ? ` id="${id}"` : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// charts (inline SVG, colours from the page's CSS variables)
// ---------------------------------------------------------------------------
// Round tick values (1, 2 or 5 times a power of ten) between lo and hi.
function niceTicks(lo, hi, want = 5) {
  const raw = (hi - lo) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

function barChart({ rows, unit = "", width = 720, max = null, labelW = 200, fmtVal = (v) => fmt(v, 1) }) {
  const rowH = 26;
  const top = 6;
  const hi = max ?? Math.max(...rows.map((r) => r.value), 1);
  const plotW = width - labelW - 70;
  const h = top + rows.length * rowH + 6;
  const bars = rows
    .map((r, i) => {
      const y = top + i * rowH;
      const w = Math.max(1, (Math.max(r.value, 0) / hi) * plotW);
      return `<text x="${labelW - 8}" y="${y + 17}" text-anchor="end" class="lbl">${esc(r.label)}</text>
<rect x="${labelW}" y="${y + 3}" width="${w}" height="${rowH - 8}" rx="2" style="fill:${r.color ?? "var(--c0)"}"><title>${esc(r.label)}: ${fmtVal(r.value)}${unit}</title></rect>
<text x="${labelW + w + 6}" y="${y + 17}" class="val">${fmtVal(r.value)}${unit}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${h}" role="img" class="chart">${bars}</svg>`;
}

function stripPlot({ groups, width = 760, unit = "¢/turn" }) {
  const rowH = 30;
  const labelW = 110;
  const plotW = width - labelW - 20;
  const all = groups.flatMap((g) => g.points.map((p) => p.value));
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all) * 1.05;
  const x = (v) => labelW + ((v - lo) / (hi - lo)) * plotW;
  const h = 26 + groups.length * rowH + 22;
  const grid = niceTicks(lo, hi).map((v) => {
    return `<line x1="${x(v)}" x2="${x(v)}" y1="14" y2="${h - 22}" class="grid"/><text x="${x(v)}" y="${h - 6}" text-anchor="middle" class="tick">${fmt(v, 0)}</text>`;
  }).join("");
  const rows = groups
    .map((g, gi) => {
      const y = 26 + gi * rowH;
      const dots = g.points
        .map(
          (p) =>
            `<circle cx="${x(p.value)}" cy="${y + rowH / 2 - 4}" r="4.5" style="fill:${famColor(g.family)}" fill-opacity=".55" stroke="${famColor(g.family)}"><title>${esc(p.label)}: ${fmt(p.value)} ${unit}</title></circle>`,
        )
        .join("");
      return `<text x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" class="lbl">${esc(g.family)} <tspan class="tick">(${g.points.length})</tspan></text>${dots}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${h}" role="img" class="chart">${grid}${rows}</svg>`;
}

function scatter({ points, width = 760, height = 360 }) {
  const m = { l: 46, r: 16, t: 14, b: 40 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xHi = Math.max(...xs) * 1.05 || 1;
  const yLo = Math.min(0, ...ys);
  const yHi = Math.max(...ys) * 1.05;
  const X = (v) => m.l + (v / xHi) * (width - m.l - m.r);
  const Y = (v) => height - m.b - ((v - yLo) / (yHi - yLo)) * (height - m.t - m.b);
  const gy = niceTicks(yLo, yHi, 5)
    .map((v) => `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const gx = niceTicks(0, xHi, 6)
    .map((v) => `<text x="${X(v)}" y="${height - m.b + 16}" text-anchor="middle" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const labelled = new Set();
  for (const kind of new Set(points.filter((p) => p.big).map((p) => p.kind))) {
    const top = points.filter((p) => p.big && p.kind === kind).sort((a, b) => b.y - a.y)[0];
    labelled.add(top);
  }
  const dots = points
    .map(
      (p) =>
        `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.big ? 7 : 4}" style="fill:${famColor(p.family)}" fill-opacity="${p.big ? 0.9 : 0.5}" stroke="${famColor(p.family)}"><title>${esc(p.label)} — ${p.x} pt, ${fmt(p.y)} ¢/turn</title></circle>${
          labelled.has(p) ? `<text x="${X(p.x) + 10}" y="${Y(p.y) + 4}" class="lbl">${esc(p.short)}</text>` : ""
        }`,
    )
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="chart">${gy}${gx}<text x="${(width + m.l) / 2}" y="${height - 4}" text-anchor="middle" class="tick">cumulative skill points</text><text transform="translate(12 ${height / 2}) rotate(-90)" text-anchor="middle" class="tick">¢ per turn</text>${dots}</svg>`;
}

const legend = () =>
  `<p class="legend">${FAMILIES.map((f) => `<span><i style="background:${famColor(f)}"></i>${esc(f)}</span>`).join("")}</p>`;

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------
const money = (a) => a.netPerTurnSell;
const ranked = model.activities.filter((a) => money(a) != null).sort((a, b) => money(b) - money(a));
const wage = (key) => model.wages.find((w) => w.key === key)?.value;
const floorW = wage("Unskilled miner (Caves)");
const proW = wage("Prospector (Caves)");
const farmW = wage("Farmer (potato, sold)");
const factW = wage("Factory solo");
const smithW = wage("Smith (median rung)");
const potatoFood = model.foodSupply.find((f) => f.crop === "potato");
const failing = model.claims.filter((c) => !c.ok);

const headlines = [
  `Money a turn is worth: an unskilled miner earns about <b>${fmt(floorW)} ¢</b>, a Prospector <b>${fmt(proW)} ¢</b>, a farmer selling potatoes <b>${fmt(farmW)} ¢</b>, a median smith <b>${fmt(smithW)} ¢</b>, and a solo Factory worker <b>${fmt(factW)} ¢</b>. The Factory pays about ${fmt(factW / proW, 0)} times what the skilled miner does.`,
  `Mining is the only source of ⬢ (${fmt(params.minerResourcesPerTurn)} ⬢/turn for a Prospector at the Caves) yet a median smithing recipe burns <b>${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.medianBurn)} ⬢/turn</b> — roughly ${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.minersPerCrafter, 1)} miners per smith just to keep one forge fed.`,
  `Food demand is small and steady: ${players} players burn ${players * params.hungerDecay} hunger a turn. One Farm action makes ~${fmt(potatoFood.personTurnsPerFarm, 0)} person-turns of food, so about <b>${fmt(potatoFood.farmersNeeded, 0)} farmers</b> feed the whole town.`,
  `${failing.length} of ${model.claims.length} figures the docs quote do not match what the catalog and code produce (see “Docs against the model”).`,
];

function sectionWages() {
  const rows = model.wages.map((w) => ({ label: w.key, value: w.value, color: "var(--c0)" }));
  return `<section><h2>What a turn is worth</h2>
<p class="lede">Net ¢ per turn for a typical holder of each occupation. Mining is halved for the fatigue duty cycle and farming is spread over its lockout. ⬢ is valued at what the Depot pays for it (${params.rv.sell} ¢).</p>
${barChart({ rows })}</section>`;
}

function sectionSpread() {
  const groups = FAMILIES.map((family) => ({
    family,
    points: model.activities
      .filter((a) => a.family === family && money(a) != null)
      .map((a) => ({ label: a.name, value: money(a) })),
  })).filter((g) => g.points.length);
  const pts = model.activities
    .filter((a) => money(a) != null)
    .map((a) => ({
      x: a.skillPoints,
      y: money(a),
      family: a.family,
      label: a.name,
      big: a.kind !== "craft",
      kind: a.family,
      short: { mining: "Mine", farming: "Farm", factory: "Factory" }[a.family] ?? a.family,
    }));
  return `<section><h2>Every activity, by family</h2>
<p class="lede">One dot per activity, net ¢ per turn after materials. Hover a dot for its name. Brewing and smithing sit close together; mining sits alone at the bottom.</p>
${legend()}${stripPlot({ groups })}
<h2>Does skill investment pay?</h2>
<p class="lede">Cumulative point cost of the skills an activity needs, against what it pays. Mining, farming and the Factory are the large dots. Starting budget is ${params.startingTagPoints} points.</p>
${scatter({ points: pts })}</section>`;
}

function sectionActivities() {
  const cols = [
    { h: "Activity", get: (a) => a.name },
    { h: "Family", get: (a) => a.family, style: (a) => `border-left:4px solid ${famColor(a.family)}` },
    { h: "Skill", get: (a) => a.skill },
    { h: "Pts", num: true, get: (a) => a.skillPoints },
    { h: "Moves", num: true, get: (a) => fmt(a.moves, 2), sort: (a) => a.moves },
    { h: "Revenue", num: true, get: (a) => fmt(a.revenue), sort: (a) => a.revenue ?? -1 },
    { h: "Inputs", num: true, get: (a) => fmt(a.inputs), sort: (a) => a.inputs },
    { h: "¢/turn (⬢ at sell)", num: true, get: (a) => fmt(money(a)), sort: (a) => money(a) ?? -1e9 },
    { h: "¢/turn (⬢ at buy)", num: true, get: (a) => fmt(a.netPerTurnBuy), sort: (a) => a.netPerTurnBuy ?? -1e9 },
    { h: "Notes", get: (a) => a.flags.join("; ") },
  ];
  return `<section><h2>The full table</h2>
<p class="lede">${model.activities.length} activities. Click a heading to sort. “Inputs” prices ⬢ at the sell figure and ingredients at their sale price (or purchase price if unsellable).</p>
${table({ cols, rows: ranked })}</section>`;
}

function sectionBalance() {
  const cols = [
    { h: "Family", get: (r) => r.family },
    { h: "Recipes", num: true, get: (r) => r.recipes },
    { h: "Median ⬢ burned / turn", num: true, get: (r) => fmt(r.medianBurn) },
    { h: "Heaviest recipe", num: true, get: (r) => fmt(r.maxBurn) },
    { h: "Miners per crafter", num: true, get: (r) => fmt(r.minersPerCrafter, 1), sort: (r) => r.minersPerCrafter },
  ];
  return `<section><h2>The ⬢ balance</h2>
<p class="lede">Mining is the faucet and recipes are the sink. A Prospector at the Caves brings in ${fmt(params.minerResourcesPerTurn)} ⬢ a turn (average of the ${fmt(params.productionCoefficient, 1)} production dial, the base range and the every-other-turn fatigue). “Miners per crafter” is how many of them one crafter of that family needs, working flat out. Gambit recipes are excluded. The Depot sells ⬢ at ${params.rv.buy} ¢, so a shortfall can be bought rather than mined.</p>
${table({ cols, rows: model.resourceBalance })}</section>`;
}

function sectionLadder() {
  const keys = model.wages.map((w) => w.key);
  const cols = [
    { h: "Ware", get: (r) => r.name },
    { h: "Shelf", get: (r) => r.manifest },
    { h: "Price ¢", num: true, get: (r) => r.price },
    { h: "Sells back", num: true, get: (r) => r.sellBack ?? "—", sort: (r) => r.sellBack ?? -1 },
    ...keys.map((k) => ({
      h: `Turns: ${k}`,
      num: true,
      get: (r) => fmt(r.turns[k], r.turns[k] < 1 ? 2 : r.turns[k] < 10 ? 1 : 0),
      sort: (r) => r.turns[k],
      style: (r) => {
        const pct = Math.max(0, Math.min(100, (Math.log10(Math.max(r.turns[k], 1)) / 3) * 100));
        return `background:color-mix(in srgb, var(--accent) ${pct.toFixed(0)}%, transparent)`;
      },
    })),
  ];
  return `<section><h2>How long to afford it</h2>
<p class="lede">Every Depot ware’s price in turns of work at each benchmark wage. Darker means longer; full colour is a thousand turns. Nothing to do with how long the game lasts — read the bottom of a column against the game’s length.</p>
${table({ cols, rows: model.priceLadder })}</section>`;
}

function sectionFood() {
  const supply = model.foodSupply.map((f) => ({
    label: f.crop,
    value: f.farmersNeeded,
    color: "var(--c3)",
  }));
  const cheap = model.foods
    .filter((f) => f.costPerPersonTurn != null)
    .slice(0, 16)
    .map((f) => ({ label: f.name, value: f.costPerPersonTurn, color: "var(--c1)" }));
  const cols = [
    { h: "Food", get: (f) => f.name },
    { h: "Kind", get: (f) => f.kind },
    { h: "Hunger", num: true, get: (f) => f.hunger },
    { h: "Weight lb", num: true, get: (f) => fmt(f.weight, 1), sort: (f) => f.weight },
    { h: "Buy ¢", num: true, get: (f) => f.buy ?? "—", sort: (f) => f.buy ?? -1 },
    { h: "Sell ¢", num: true, get: (f) => f.sell ?? "—", sort: (f) => f.sell ?? -1 },
    { h: "Moves", num: true, get: (f) => (f.moves == null ? "—" : fmt(f.moves, 2)), sort: (f) => f.moves ?? -1 },
    { h: "¢ per person-turn", num: true, get: (f) => fmt(f.costPerPersonTurn, 2), sort: (f) => f.costPerPersonTurn ?? 1e9 },
    { h: "lb per person-turn", num: true, get: (f) => fmt(f.lbPerPersonTurn, 2), sort: (f) => f.lbPerPersonTurn },
  ];
  const sup = model.foodSupply
    .map(
      (f) =>
        `<tr><td>${esc(f.crop)}</td><td class="num">${fmt(f.harvest, 1)}</td><td class="num">${fmt(f.personTurnsPerFarm, 0)}</td><td class="num">${fmt(f.lbPerFarm, 1)}</td><td class="num">${fmt(f.farmersNeeded, 1)}</td></tr>`,
    )
    .join("");
  return `<section><h2>Food</h2>
<p class="lede">A person burns ${params.hungerDecay} hunger a turn, so a food that restores 12 feeds them for a little over a turn. One Farm action sows up to ${params.farmMaxCrops} plants and about 1 in ${params.witherIn} wither. It locks you out for ${params.farmCycle} turns in all.</p>
<h3>Farmers needed to feed ${players} players</h3>
${barChart({ rows: supply, unit: " farmers", fmtVal: (v) => fmt(v, 0) })}
<div class="tablewrap"><table><thead><tr><th>Crop</th><th class="num">Harvest / farm</th><th class="num">Person-turns / farm</th><th class="num">lb / farm</th><th class="num">Farmers needed</th></tr></thead><tbody>${sup}</tbody></table></div>
<h3>Cheapest ways to be fed (¢ per person-turn)</h3>
<p class="lede">Uses the buy price where the Depot sells it, otherwise the sell price. Dishes show the recipe’s own restore only; extra ingredients add more.</p>
${barChart({ rows: cheap, unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 190 })}
${table({ cols, rows: model.foods })}</section>`;
}

function sectionChecks() {
  const cols = [
    { h: "Where", get: (c) => c.doc },
    { h: "The docs say", get: (c) => c.claim },
    { h: "Doc figure", get: (c) => c.docValue },
    { h: "Model", get: (c) => c.model },
    { h: "", get: (c) => (c.ok ? "matches" : "differs"), style: (c) => `color:var(--${c.ok ? "good" : "bad"});font-weight:600` },
    { h: "Note", get: (c) => c.note ?? "" },
  ];
  const off = model.priceRule
    .filter((r) => Math.abs(r.off) > 1 || r.arbitrage)
    .map((r) => ({ ...r }));
  const cols2 = [
    { h: "Ware", get: (r) => r.name },
    { h: "Buy", num: true, get: (r) => r.buy },
    { h: "Sells back", num: true, get: (r) => r.sell },
    { h: "60% rule gives", num: true, get: (r) => r.expected },
    { h: "Craftable", get: (r) => (r.craftable ? "yes (wage floor?)" : "no") },
    { h: "Buy ≤ sell?", get: (r) => (r.arbitrage ? "ARBITRAGE" : "") , style: () => "color:var(--bad);font-weight:600" },
  ];
  return `<section><h2>Docs against the model</h2>
<p class="lede">Each row is a number a system doc states, checked against what the catalog and code produce now. A “differs” is either a stale doc or a real bug, and only a person can say which.</p>
${table({ cols, rows: model.claims, sortable: false })}
<h3>Wares off the 60% sell-back rule</h3>
<p class="lede">Most are the wage-floor recipes <code>DEPOT.md</code> §3 names. Anything else, and any row marked ARBITRAGE (sells back for at least the buy price), is worth a look.</p>
${table({ cols: cols2, rows: off })}</section>`;
}

function sectionAssumptions() {
  const rows = model.assumptions.map((a) => `<tr><td><code>${esc(a.key)}</code></td><td>${esc(a.value)}</td><td>${esc(a.why)}</td></tr>`).join("");
  const p = Object.entries(params)
    .filter(([, v]) => typeof v !== "object")
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(fmt(v, 2))}</td></tr>`)
    .join("");
  return `<section><h2>What this leans on</h2>
<p class="lede">Read live from the repo (schema defaults, <code>db/lib</code> constants, the YAML masters):</p>
<div class="tablewrap"><table><tbody>${p}</tbody></table></div>
<p class="lede">Assumed, because no file states them as a number:</p>
<div class="tablewrap"><table><tbody>${rows}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------
const css = `
:root{--bg:#f6f4ef;--fg:#1d1b18;--mute:#6b665c;--card:#fffdf8;--line:#d9d3c6;--accent:#b0342c;--good:#2c7a3f;--bad:#b0342c;
--c0:#1f6f8b;--c1:#c98a1b;--c2:#7b4b94;--c3:#4a8a3f;--c4:#b0342c;--c5:#2a2a2a;--c6:#0f8b8d;--c7:#d16ba5;--c8:#8a6d3b;--c9:#5b6cc0}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece7dc;--mute:#a49e91;--card:#1e1c19;--line:#3a3630;--accent:#e0645a;--good:#6cc27f;--bad:#e0645a;
--c0:#5fb4d0;--c1:#e6b04a;--c2:#b58fce;--c3:#84c477;--c4:#e0645a;--c5:#cfcabe;--c6:#52c0c2;--c7:#e59bc4;--c8:#c9a96b;--c9:#8e9ce0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:0 0 6px}h3{font-size:16px;margin:22px 0 6px}
.sub{color:var(--mute);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 18px 12px;margin:0 0 18px}
.lede{color:var(--mute);margin:0 0 12px}
.head li{margin:6px 0}
.chart{width:100%;height:auto;display:block}
.chart .lbl{font-size:12px;fill:var(--fg)}.chart .val{font-size:12px;fill:var(--mute)}.chart .tick{font-size:11px;fill:var(--mute)}
.chart .grid{stroke:var(--line);stroke-width:1}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px;font-size:13px}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}
.tablewrap{overflow-x:auto;margin:6px 0 4px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--card);font-weight:600;white-space:nowrap}
th.sort-asc::after{content:" ▲"}th.sort-desc::after{content:" ▼"}
.sortable th{cursor:pointer}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code{font-size:12px}
`;
const js = `
document.querySelectorAll('table.sortable').forEach(t=>{
  t.querySelectorAll('th').forEach(th=>th.addEventListener('click',()=>{
    const i=+th.dataset.i,asc=!th.classList.contains('sort-asc');
    t.querySelectorAll('th').forEach(x=>x.classList.remove('sort-asc','sort-desc'));
    th.classList.add(asc?'sort-asc':'sort-desc');
    const rows=[...t.tBodies[0].rows];
    rows.sort((a,b)=>{const x=a.cells[i].dataset.v,y=b.cells[i].dataset.v,nx=parseFloat(x),ny=parseFloat(y);
      const r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return asc?r:-r});
    rows.forEach(r=>t.tBodies[0].appendChild(r));
  }));
});`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bascinet economy</title><style>${css}</style></head><body><main>
<h1>Bascinet economy</h1>
<p class="sub">Generated from commit ${esc(commit)} · ${players} players · ${model.counts.tags} tags, ${model.counts.craftable} craftable · <code>npm run economy:report</code></p>
<section><h2>The short version</h2><ul class="head">${headlines.map((h) => `<li>${h}</li>`).join("")}</ul></section>
${sectionWages()}${sectionSpread()}${sectionBalance()}${sectionActivities()}${sectionLadder()}${sectionFood()}${sectionChecks()}${sectionAssumptions()}
</main><script>${js}</script></body></html>`;

// ---------------------------------------------------------------------------
// markdown + csv + json
// ---------------------------------------------------------------------------
const md = [
  `# Bascinet economy (commit ${commit}, ${players} players)`,
  "",
  ...headlines.map((h) => `- ${h.replace(/<[^>]+>/g, "")}`),
  "",
  "## Wages, ¢ per turn",
  "",
  "| Occupation | ¢/turn |",
  "|---|---:|",
  ...model.wages.map((w) => `| ${w.key} | ${fmt(w.value)} |`),
  "",
  "## Docs against the model",
  "",
  "| Where | Claim | Doc | Model | |",
  "|---|---|---|---|---|",
  ...model.claims.map((c) => `| ${c.doc} | ${c.claim} | ${c.docValue} | ${c.model} | ${c.ok ? "ok" : "**differs**"} |`),
  "",
].join("\n");

const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = [
  ["id", "name", "family", "skill", "skillPoints", "moves", "revenue", "inputs", "netPerTurnSell", "netPerTurnBuy", "gambit", "flags"].join(","),
  ...ranked.map((a) =>
    [a.id, a.name, a.family, a.skill, a.skillPoints, a.moves, a.revenue, a.inputs, money(a), a.netPerTurnBuy, a.gambit, a.flags.join("; ")]
      .map(csvCell)
      .join(","),
  ),
].join("\n");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, "report.md"), md);
fs.writeFileSync(path.join(outDir, "activities.csv"), csv);
fs.writeFileSync(path.join(outDir, "model.json"), JSON.stringify(model, null, 2));
console.log(`economy report -> ${path.join(outDir, "index.html")}`);
console.log(`  ${model.activities.length} activities, ${model.priceLadder.length} priced wares, ${model.foods.length} foods`);
console.log(`  ${failing.length} of ${model.claims.length} doc figures differ from the model`);
