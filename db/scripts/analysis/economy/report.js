#!/usr/bin/env node
// Renders the economic model (./model.js) as a report you can open.
//
//   npm run economy:report                    # -> economy-report/index.html
//   npm run economy:report -- --players 150   # a bigger town
//   npm run economy:report -- --turns 40      # a longer game (fatigue over N turns)
//   npm run economy:report -- --free-moves 2  # free zone crossings a turn (2 with a mount)
//   npm run economy:report -- --resource-value sell   # value ⬢ at the 1 ¢ sell-back (default: the Depot's buy price)
//   npm run economy:report -- --mined-value buy      # value a Prospector's ⬢ at the 3 ¢ import price (default: the midpoint of the Depot's two prices)
//   npm run economy:report -- --obols off     # preview the game with obol payment for smithing removed (default: read the source)
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
const gameTurns = Number(flag("turns", 30));
const freeMoves = flag("free-moves", null) == null ? null : Number(flag("free-moves", null));
const resourceValue = flag("resource-value", "buy");
const minedValue = flag("mined-value", "mid");
const obolPath = flag("obols", "auto");
const moveValueFlag = flag("move-value", null) == null ? null : Number(flag("move-value", null));

const model = buildModel({ players, gameTurns, freeMoves, resourceValue, minedValue, obolPath, moveValue: moveValueFlag });
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

let tableSeq = 0;
// `filters` is [{ label, get }]: a dropdown per entry built from the values the rows actually have, plus
// a text search. Rows carry their values as data attributes so the page can hide them without a rebuild.
function table({ cols, rows, id, sortable = true, filters = null }) {
  const tid = id ?? (filters ? `t${++tableSeq}` : null);
  const head = cols.map((c, i) => `<th data-i="${i}" class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("");
  const body = rows
    .map((r) => {
      const fattrs = filters ? filters.map((f, i) => ` data-f${i}="${esc(f.get(r) ?? "")}"`).join("") : "";
      return `<tr${fattrs}>${cols
        .map((c) => {
          const v = c.get(r);
          // A sort key only when it differs from what is shown; the sorter reads the text otherwise.
          const sortAttr = c.sort ? ` data-v="${esc(c.sort(r) ?? "")}"` : "";
          const style = c.style ? c.style(r) : "";
          return `<td${c.num ? ' class="num"' : ""}${sortAttr}${style ? ` style="${style}"` : ""}>${c.raw ? v : esc(v ?? "—")}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  const bar = filters
    ? `<div class="filterbar" data-for="${tid}">${filters
        .map((f, i) => {
          const values = [...new Set(rows.map((r) => String(f.get(r) ?? "")))].sort();
          return `<label>${esc(f.label)} <select data-i="${i}"><option value="">All</option>${values.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>`;
        })
        .join("")}<input type="search" placeholder="Search rows"><span class="count"></span></div>`
    : "";
  return `${bar}<div class="tablewrap"><table${sortable ? ' class="sortable"' : ""}${tid ? ` id="${tid}"` : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
const money = (a) => a.netPerTurn;
const ranked = model.activities.filter((a) => money(a) != null).sort((a, b) => money(b) - money(a));
const allRanked = [...model.activities].sort((a, b) => (money(b) ?? -1e9) - (money(a) ?? -1e9) || (b.perAction ?? -1e9) - (a.perAction ?? -1e9));

const RANK = model.sources.ranks;
const rankChip = (r) =>
  r === 0 ? `<span class="rk r0">none</span>` : `<span class="rk r${r}">${RANK.find((x) => x.id === r)?.label}</span>`;
const wage = (key) => model.wages.find((w) => w.key === key)?.value;
const floorW = wage("Miner, pickaxe only (Caves)");
const proW = wage("Prospector (Caves)");
const farmW = wage("Farmer (potato, sold)");
const factW = wage("Factory solo");
const baselineOf = (role) => model.baselines.find((b) => b.role === role);
const potatoFood = model.foodSupply.find((f) => f.crop === "potato");
const failing = model.claims.filter((c) => !c.ok);

const headlines = [
  `Money a turn is worth: a miner with just a pickaxe earns about <b>${fmt(floorW)} ¢</b>, a Prospector <b>${fmt(proW)} ¢</b>, a farmer selling potatoes <b>${fmt(farmW)} ¢</b>, and a solo Factory worker <b>${fmt(factW)} ¢</b>. The Factory pays about ${fmt(factW / proW, 0)} times what the skilled miner does.`,
  `The easy-craft baselines, with ⬢ bought at the Depot: a starter smith ${fmt(baselineOf("Starter smith")?.value)} ¢ a turn (${baselineOf("Starter smith")?.key.split(": ")[1]}), a skilled smith ${fmt(baselineOf("Skilled smith")?.value)} ¢ (${baselineOf("Skilled smith")?.key.split(": ")[1]}), a crafter ${fmt(baselineOf("Crafter")?.value)} ¢, a skilled brewer ${fmt(baselineOf("Skilled brewer")?.value)} ¢. A cook earns nothing from the counter, since no dish can be sold there, but feeds ${fmt(model.cheapestMeal?.personTurnsPerMove, 0)} person-turns per Move for ${fmt(model.cheapestMeal?.costPerPersonTurn, 2)} ¢ each.`,
  `Mining is the only source of ⬢ (${fmt(params.minerResourcesPerTurn)} ⬢/turn for a Prospector at the Caves) yet a median smithing recipe burns <b>${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.medianBurn)} ⬢/turn</b> — roughly ${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.minersPerCrafter, 1)} miners per smith just to keep one forge fed.`,
  `Food demand is small and steady: ${players} players burn ${players * params.hungerDecay} hunger a turn. One Farm action makes ~${fmt(potatoFood.personTurnsPerFarm, 0)} person-turns of food, so about <b>${fmt(potatoFood.farmersNeeded, 0)} farmers</b> feed the whole town.`,
  (() => {
    const at8 = model.combos.loadouts.filter((l) => l.points <= params.startingTagPoints).sort((x, y) => y.withFactory.rate - x.withFactory.rate || x.points - y.points)[0];
    const refAlone = model.combos.alone.find((a) => /^Refine/.test(a.label));
    return `The best mix at the starting budget (${params.startingTagPoints} points) is <b>${esc(at8.skills.join(" + "))}</b>, worked as <span class="mono">${esc(at8.withFactory.pattern.split(" ").slice(0, 8).join(" "))}</span> (R refine, C craft, F farm, M mine), for <b>${fmt(at8.withFactory.rate)} ¢ a turn</b>, against ${fmt(refAlone.rate)} refining alone. Refining tires you the way mining does, so a crafter fills the off turns. Only ${params.refinerySeats} people can refine in a turn; with a crowd the mix falls back on crafts and farming.`;
  })(),
  `Fatigue: ${model.fatigue.rows.filter((r) => r.tires).map((r) => `${r.label.toLowerCase().replace(/ \(.*\)/, "")} can be pressed ${r.steady >= 0.999 ? "every turn" : `1 turn in ${fmt(1 / r.steady, 0)}`}`).join(", ")}. ${model.fatigue.rows.filter((r) => !r.tires).map((r) => r.label.toLowerCase().replace(/ \(.*\)/, "")).join(", ")} never tire you.`,
  `A Prospector at the Caves brings up ${fmt(params.minerResourcesPerTurn)} ⬢ a turn plus ${fmt(model.prospectorValue[0].dropsPerTurn, 2)} ¢ of drops: worth <b>${fmt(model.prospectorValue[0].atMid)} ¢ a turn</b> with ⬢ bartered at the midpoint (${fmt(params.rv.mid, 1)} ¢), ${fmt(model.prospectorValue[0].atBuy)} ¢ at the Depot's ${params.rv.buy} ¢ buy price and ${fmt(model.prospectorValue[0].atSell)} ¢ at the ${params.rv.sell} ¢ sell-back. ${params.obolFamilies.length ? `A smith can pay a recipe's ⬢ in obols, one for one, so a smith will pay a Prospector no more than ${params.rv.sell} ¢ a ⬢; only brewers, crafters and the like, who must hold real ⬢, will pay up to ${params.rv.buy} ¢.` : `No craft can be paid in obols, so every crafter must hold real ⬢ and will pay a Prospector up to ${params.rv.buy} ¢ a ⬢, the Depot's import price.`}`,
  `${model.sources.summary.special} of ${model.sources.summary.recipes} recipes need a special item (${model.sources.summary.copies} of those only copy a key). Of the rest, ${model.sources.summary.byHardest[4]} are held back by a Scarce item and ${model.sources.summary.byHardest[5]} by an item with no known source.`,
  `${failing.length} of ${model.claims.length} figures the docs quote do not match what the catalog and code produce (see “Docs against the model”).`,
];

function sectionWages() {
  const rows = model.wages.map((w) => ({ label: w.key, value: w.value, color: w.baseline ? "var(--c1)" : "var(--c0)" }));
  return `<section><h2>What a turn is worth</h2>
<p class="lede">Net ¢ per turn for a typical holder of each occupation, with every ⬢ a crafter spends valued at the Depot's <b>${resourceValue === "buy" ? `buy price (${params.rv.buy} ¢)` : `sell-back (${params.rv.sell} ¢)`}</b>: what a ⬢ costs somebody who needs one and holds none. A ⬢ a Prospector brings up is valued at the <b>${params.minedValue === "mid" ? `midpoint (${fmt(params.rv.mid, 1)} ¢)` : `${params.minedValue === "buy" ? "buy price" : "sell-back"} (${fmt(params.rvMined, 1)} ¢)`}</b>, what it should barter for. <code>--resource-value ${resourceValue === "buy" ? "sell" : "buy"}</code> and <code>--mined-value buy|sell</code> move them. The gold bars are the <b>easy-craft baselines</b> (next section). Mining is halved for the fatigue duty cycle and farming is spread over its lockout.</p>
${barChart({ rows })}</section>`;
}

const recBy = new Map(model.sources.recipes.map((r) => [r.slug, r]));
// Recipes that take the same inputs and pay the same are one line, not fifteen. `sigOf` gives a row's
// identity (null keeps it on its own); the merged row keeps the first one's figures and lists every name.
function collapse(rows, sigOf) {
  const at = new Map();
  const out = [];
  for (const r of rows) {
    const k = sigOf(r);
    if (k == null) {
      out.push(r);
    } else if (at.has(k)) {
      const i = at.get(k);
      out[i] = out[i].names ? out[i] : { ...out[i], names: [out[i].name] };
      out[i].names.push(r.name);
    } else {
      at.set(k, out.length);
      out.push(r);
    }
  }
  return out;
}
const sigOfRecipe = (r) => r.sig ?? null;
const sigOfSlug = (r) => recBy.get(r.slug)?.sig ?? null;
// Up to three names in the cell; the rest sit behind "+N more" and stay searchable.
const nameCell = (r) => {
  const n = r.names ?? [r.name];
  if (n.length <= 3) return esc(n.join(", "));
  return `${esc(n.slice(0, 3).join(", "))} <span class="via" title="${esc(n.slice(3).join(", "))}">+${n.length - 3} more</span><span class="hid">, ${esc(n.slice(3).join(", "))}</span>`;
};
const same = (rows) => rows.reduce((sum, r) => sum + (r.names ? r.names.length - 1 : 0), 0);
const needsCell = (slug) => {
  const r = recBy.get(slug);
  if (!r || !r.items.length) return "nothing";
  return r.items.map((i) => `${esc(i.label)} <span class="via">${esc(i.easy ?? i.route)}</span>`).join("<br>");
};
const craftCols = () => [
  { h: "Recipe", raw: true, get: nameCell, sort: (a) => a.name },
  { h: "Skill", get: (a) => `${a.skill.replace(/, fundamentalist/, "")} (${a.skillPoints} pt)`, sort: (a) => a.skillPoints },
  { h: "Moves", num: true, get: (a) => fmt(a.totalMoves, 2), sort: (a) => a.totalMoves },
  { h: "⬢", num: true, get: (a) => fmt(a.resourceCost, 0) },
  { h: "Sells ¢", num: true, get: (a) => a.revenue },
  { h: "Also needs", raw: true, get: (a) => needsCell(a.slug), sort: (a) => (recBy.get(a.slug)?.items.length ?? 0) },
  { h: "Forge?", get: (a) => (a.workshop ? "yes" : "no") },
  { h: "¢/turn, ⬢ bought", num: true, get: (a) => fmt(a.netPerTurnBuy), sort: (a) => a.netPerTurnBuy },
  { h: "¢/turn, ⬢ mined", num: true, get: (a) => fmt(a.netPerTurnSell), sort: (a) => a.netPerTurnSell },
  ...(params.obolFamilies.length ? [{ h: "¢/turn, ⬢ paid in obols", num: true, get: (a) => (a.parPayable ? fmt(a.netPerTurnObols) : "no"), sort: (a) => a.netPerTurnObols ?? -1e9 }] : []),
  {
    h: "Note",
    get: (a) =>
      [
        ...(a.madeAtHome.length ? [`makes its own ${a.madeAtHome.join(", ")}`] : []),
        ...a.oreNeeds.filter((o) => o.prospectors > 2).map((o) => `ore-limited: ${fmt(o.prospectors, 0)} Prospectors per crafter`),
      ].join("; "),
  },
];

function sectionBaselines() {
  const L = model.shortlists;
  const ws = model.sources.items.find((i) => i.slug === "workshop-equipment");
  const weAct = model.activities.find((a) => a.slug === "workshop-equipment");
  const cookCols = [
    { h: "Dish", raw: true, get: nameCell, sort: (c) => c.name },
    { h: "Skill", get: (c) => `${c.skill} (${c.skillPoints} pt)`, sort: (c) => c.skillPoints },
    { h: "Moves / dish", num: true, get: (c) => fmt(c.moves, 2), sort: (c) => c.moves },
    { h: "Hunger", num: true, get: (c) => c.hunger },
    { h: "Mood", num: true, get: (c) => c.mood },
    { h: "Made from", raw: true, get: (c) => c.ingredients.map(esc).join(", ") || "nothing" },
    { h: "Cost ¢ / dish", num: true, get: (c) => fmt(c.costPerDish, 1), sort: (c) => c.costPerDish },
    { h: "¢ per person-turn", num: true, get: (c) => fmt(c.costPerPersonTurn, 2), sort: (c) => c.costPerPersonTurn ?? 1e9 },
    { h: "Person-turns / Move", num: true, get: (c) => fmt(c.personTurnsPerMove, 0), sort: (c) => c.personTurnsPerMove ?? 0 },
  ];
  const top = L.cooking.find((c) => c.costPerPersonTurn != null);
  const topRec = recBy.get(top?.slug);
  const unitsPerDish = (topRec?.items ?? []).reduce((sum, i) => sum + (i.count ?? 1), 0);
  const cropsPerFarm = params.farmMaxCrops * (1 - 1 / params.witherIn);
  const baseCols = [
    { h: "Role", get: (b) => b.role },
    { h: "Best easy recipe", get: (b) => b.key.split(": ")[1] },
    { h: "Skill points", num: true, get: (b) => b.skillPoints },
    { h: "¢/turn, ⬢ bought", num: true, get: (b) => fmt(b.value), sort: (b) => b.value },
    { h: "¢/turn, ⬢ mined", num: true, get: (b) => fmt(b.valueMined), sort: (b) => b.valueMined },
  ];
  return `<section><h2>Baselines: the easy crafts</h2>
<p class="lede">What somebody can earn from a standing start, using only what is easy to get. A recipe is <b>easy</b> when every input is on the Depot's general shelf, is farmed, is an ore on at least ${fmt(100 * 0.1, 0)}% of Prospecting presses, is a cave find on at least 1 in 50 arrivals, or is a craft from those. ⬢ comes from the Depot at ${params.rv.buy} ¢, and the second column shows the pay if the crafter mined it instead. Recipes that need an ore supply of more than two Prospectors per crafter are flagged and left out of the baselines. ${params.obolFamilies.length ? `<b>Smithing recipes can pay their ⬢ in obols, one for one</b> (the game refuses this for every other craft), so a smith does not have to import ⬢ at all: the “paid in obols” column is a smith's real wage, and the “bought” column is what a smith would earn by importing anyway.` : `No craft can be paid in obols, so the “bought” column is every crafter's real wage.`} These baselines are what the rest of the report compares against.</p>
<h3>What skill points pay</h3>
<p class="lede">The catalog is priced from one wage table (<code>DEPOT.md</code> §4): a maker who buys every ⬢ at the Depot's ${params.rv.buy} ¢, crafts, and sells to the Depot clears a set profit per Move for each rung of skill points, and more points always pay more. The floor is meant to be thin. ${model.profitRows.length} smithing, crafting and brewing recipes that work no input are on the table (prices stayed and the ⬢ cost was fitted to them); another ${model.workedRows.length} work an input, and are priced off it instead: their wage, their ⬢, and nearly twice a raw input's sell price (bars, potions from cave finds and organs, gear from ore); ${model.profitTiers.length ? "the Pickaxe and the Autoinjector are held back, because the shelf prices they are fitted to leave no whole-⬢ recipe that lands on the rung" : ""}.</p>
${table({
    cols: [
      { h: "Skill points", num: true, get: (t) => t.points },
      { h: "Rate ¢ / Move", num: true, get: (t) => t.rate },
      { h: "Recipes", num: true, get: (t) => t.n },
      { h: "Lowest", num: true, get: (t) => fmt(t.min), sort: (t) => t.min },
      { h: "Median", num: true, get: (t) => fmt(t.median), sort: (t) => t.median },
      { h: "Highest", num: true, get: (t) => fmt(t.max), sort: (t) => t.max },
      { h: "Families", get: (t) => t.families.join(", ") },
    ],
    rows: model.profitTiers,
  })}
<h3>The easy crafts</h3>
${table({ cols: baseCols, rows: model.baselines })}

<h3>Smithing</h3>
<p class="lede">Every smithing recipe needs Workshop Equipment within reach. Rows are sorted by ¢ a turn with ⬢ bought at the Depot: the Gunpowder rung leads, then the 10-point gear, then the 5-point gear and the ore smelts, which now sit level with the rest of their rung. A recipe with the same inputs and price as another is one line.</p>
${table({ cols: craftCols(), rows: collapse(L.smithing, sigOfSlug).slice(0, 30), filters: [{ label: "Skill", get: (a) => a.skill }] })}

<h3>Crafting (the basic skill)</h3>
<p class="lede">Crafting costs 2 points and needs no forge. The quarter-Move pieces (Sling, Quarterstaff, Padded Armor and the rest) sell for what their ⬢ costs at the Depot, so a round trip earns nothing; the one-Move pieces (Longbow, Shield, Pavise) clear ${fmt(model.profitTiers.find((t) => t.points === 2)?.rate, 0)} ¢ a Move. Crafting pays the least because it takes the fewest points.</p>
${table({ cols: craftCols(), rows: collapse(L.crafting, sigOfSlug).slice(0, 30), filters: [{ label: "Skill", get: (a) => a.skill }] })}

<h3>Brewing</h3>
<p class="lede">Brewing needs no forge. Most brews need 10 points (Brewing II). Cave Fungus, the one cave find these use, turns up on ${fmt((model.sources.items.find((i) => i.slug === "cave-fungus")?.routes[0] ?? "").match(/([\d.]+)%/)?.[1] ?? 0, 1)}% of arrivals. Alcohol is a 0.25-Move recipe, so the brews that use it include that work.</p>
${table({ cols: craftCols(), rows: collapse(L.brewing, sigOfSlug).slice(0, 30), filters: [{ label: "Skill", get: (a) => a.skill }] })}

<h3>Cooking</h3>
<p class="lede">No dish can be sold to the Depot, so a cook has no wage. What a cook makes is food and mood, so the table ranks dishes by what a person-turn of food costs in ingredients (crops priced at what the counter pays). One person burns ${params.hungerDecay} hunger a turn. ${top ? `The cheapest is ${esc(top.name)}: ${top.hunger} hunger from ingredients worth ${fmt(top.costPerDish, 1)} ¢, against ${fmt(model.foods.find((f) => f.slug === "wheat")?.costPerPersonTurn, 2)} ¢ a person-turn for raw wheat, which also costs mood and nauseates, and ${fmt(model.foodFloor.anyone?.costPerPersonTurn, 2)} ¢ for a Depot Ration Box, the cheapest thing anyone can simply order, at a mood of ${fmt(model.foodFloor.anyone?.mood, 1)}. A Move of ${esc(top.name)} is ${fmt(top.dishesPerMove, 0)} dishes and needs about ${fmt(top.dishesPerMove * unitsPerDish, 0)} ingredient units, roughly one Farm action's harvest (${fmt(cropsPerFarm, 0)}), so the crop supply binds long before the Move does.` : ""}</p>
${table({ cols: cookCols, rows: collapse(L.cooking, sigOfSlug).slice(0, 40), filters: [{ label: "Skill", get: (c) => c.skill }] })}

<h3>Without Workshop Equipment</h3>
<p class="lede">Brewing, cooking and Crafting never need a forge. Only smithing does, so the question is what the smithing family can do without one. The answer is the crafting-skill recipes plus Workshop Equipment itself, which is exempt from its own requirement.</p>
${table({ cols: craftCols(), rows: collapse(L.noWorkshop, sigOfSlug).slice(0, 20), filters: [{ label: "Skill", get: (a) => a.skill }, { label: "Family", get: (a) => a.family }] })}
<p class="lede">Best without a forge: <b>${esc(L.noWorkshop[0]?.name)}</b> at ${fmt(L.noWorkshop[0]?.netPerTurnBuy)} ¢ a turn (${fmt(L.noWorkshop[0]?.netPerTurnSell)} ¢ with mined ⬢), against ${fmt(baselineOf("Skilled smith")?.value)} ¢ for a skilled smith with one. Where the forge comes from: ${ws ? ws.routes.map(esc).join("; ") : "n/a"}. A Smithing II smith can make their own: ${weAct ? `${fmt(weAct.resourceCost, 0)} ⬢ and ${fmt(weAct.totalMoves, 0)} Moves, worth ${weAct.revenue} ¢ if sold` : ""}. The Metalsmith starts with the Smithy Key to the Storeroom's, and the Engineer starts with Smithing II, so the forge is a small blocker for the main smiths and a real one for everybody else.</p>
</section>`;
}

function sectionInvestments() {
  const I = model.investments;
  const all = I.rows;
  const payable = all.filter((r) => r.paybackTurns != null && r.coin > 0).sort((a, b) => a.paybackTurns - b.paybackTurns);
  const efficient = all.filter((r) => r.perPoint != null && r.points > 0).sort((a, b) => b.perPoint - a.perPoint);
  const cols = [
    { h: "Investment", get: (r) => r.name },
    { h: "Group", get: (r) => r.group },
    { h: "Kind", get: (r) => r.kind },
    { h: "What it does", get: (r) => r.does },
    { h: "Cost", get: (r) => r.coinHow },
    { h: "All-in ¢", num: true, get: (r) => (r.allIn > 0 ? fmt(r.allIn, 0) : "0"), sort: (r) => r.allIn },
    { h: "Points", num: true, get: (r) => (r.points ? r.points : "—"), sort: (r) => r.points },
    { h: "Pays ¢ / turn", num: true, get: (r) => (r.gain == null ? "once" : fmt(r.gain, 1)), sort: (r) => r.gain ?? -1e9 },
    { h: "Pays back in", num: true, get: (r) => (r.paybackTurns == null ? "—" : r.paybackTurns === 0 ? "at once" : `${fmt(r.paybackTurns, 1)} turns`), sort: (r) => r.paybackTurns ?? 1e9 },
    { h: `Net over ${params.gameTurns} turns`, num: true, get: (r) => (r.netOverGame == null ? "—" : fmt(r.netOverGame, 0)), sort: (r) => r.netOverGame ?? -1e9 },
    { h: "¢ / turn per point", num: true, get: (r) => (r.perPoint == null ? "—" : fmt(r.perPoint, 2)), sort: (r) => r.perPoint ?? -1e9 },
    { h: "How it is worked out", get: (r) => r.gainHow ?? "" },
    { h: "Caveat", get: (r) => r.note ?? "" },
  ];
  const paybackBars = payable.map((r) => ({ label: r.name, value: r.paybackTurns, color: r.paybackTurns <= 3 ? "var(--good)" : r.paybackTurns <= 20 ? "var(--c1)" : "var(--c0)" }));
  const pointBars = efficient.map((r) => ({ label: r.name, value: r.perPoint, color: r.perPoint < 0 ? "var(--bad)" : "var(--c3)" }));
  const scanned = I.scanned
    .map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.resources} ⬢${s.moves ? `, ${fmt(s.moves, 0)} Moves` : ""}</td><td>${esc(s.effect)}</td></tr>`)
    .join("");
  return `<section><h2>What each investment pays back</h2>
<p class="lede">Every tool, skill, consumable, building and animal that raises somebody's output, costed and paid back from the same catalog the rest of the report reads. A ⬢ you make is valued at ${fmt(params.rvMined, 1)} ¢ (the midpoint of the Depot's prices), a ⬢ you spend at the Depot's ${params.rv.buy} ¢, and a Move given up at <b>${fmt(I.moveValue, 1)} ¢</b>, an average mining turn (<code>--move-value</code> changes it). Skill points are a different budget, so they are shown beside the payoff and as ¢ a turn per point, never converted to coin. The gain is one person's, working alone and every turn they can; nothing here is saturated, so read the last column as a ceiling.</p>
<h3>Pays back fastest, for what costs coin</h3>
${barChart({ rows: paybackBars, unit: " turns", fmtVal: (v) => (v < 0.05 ? "at once" : fmt(v, 1)), labelW: 210 })}
<h3>Best use of a skill point</h3>
${barChart({ rows: pointBars, unit: " ¢/turn", fmtVal: (v) => fmt(v, 2), labelW: 210 })}
<h3>All of it</h3>
${table({ cols, rows: all, filters: [{ label: "Group", get: (r) => r.group }, { label: "Kind", get: (r) => r.kind }] })}
<h3>Buildings that raise nothing</h3>
<p class="lede">Every other structure type in the catalog, scanned for anything that changes what somebody makes. None does. Their cost is the price of what they are for.</p>
<div class="tablewrap"><table><thead><tr><th>Building</th><th class="num">Cost</th><th>What it does</th></tr></thead><tbody>${scanned}</tbody></table></div>
<p class="lede">Also scanned and left out: ${model.counts?.carryTags ?? 30} tags carry a <code>carryBonus</code> (a Cart, a Pack Mule) and raise how much you can move, which matters to hauling but is not counted here, and <code>gambitBonus</code> perks change a roll's odds and no output.</p>
</section>`;
}

function sectionCaving() {
  const C = model.caving;
  const pct = (v, d = 1) => `${fmt(v * 100, d)}%`;
  const tierLabel = { ultracommon: "Ultracommon", common: "Common", uncommon: "Uncommon", rare: "Rare", "extremely-rare": "Extremely rare", "nearly-impossible": "Nearly impossible" };
  const zoneRowsBy = (z) => new Map(C.zones[z].rows.map((r) => [r.slug, r]));
  const cavesBy = zoneRowsBy("caves");
  const depthsBy = zoneRowsBy("depths");
  const slugs = [...new Set([...cavesBy.keys(), ...depthsBy.keys()])];
  const items = slugs
    .map((slug) => {
      const c = cavesBy.get(slug);
      const d = depthsBy.get(slug);
      const any = c ?? d;
      return { slug, name: any.name, tier: any.tier, value: any.value, basis: any.basis, estimated: any.estimated, cP: c?.pArrival ?? 0, dP: d?.pArrival ?? 0, cEv: c?.evArrival ?? 0, dEv: d?.evArrival ?? 0, cEvEst: (c?.evFindEstimated ?? 0) / 6, dEvEst: (d?.evFindEstimated ?? 0) / 6 };
    })
    .sort((a, b) => b.dEv + b.dEvEst + b.cEv - (a.dEv + a.dEvEst + a.cEv));
  const summaryCols = [
    { h: "", get: (r) => r.label },
    { h: "Caves", num: true, get: (r) => r.caves },
    { h: "Depths", num: true, get: (r) => r.depths },
  ];
  const Z = C.zones;
  const P = C.perZone;
  const summary = [
    { label: "Loot worth, per find (¢)", caves: fmt(Z.caves.evFind, 2), depths: fmt(Z.depths.evFind, 2) },
    { label: "Plus estimated, per find (¢)", caves: fmt(Z.caves.evFindEstimated, 2), depths: fmt(Z.depths.evFindEstimated, 2) },
    { label: "Loot worth, per arrival (¢), a find on 1 in 6", caves: fmt(Z.caves.evArrival, 2), depths: fmt(Z.depths.evArrival, 2) },
    { label: "Finds with no price at all", caves: pct(Z.caves.unpricedShare, 0), depths: pct(Z.depths.unpricedShare, 0) },
    { label: "Assumed cost of a 1 (¢), the wound mix priced at its cure", caves: fmt(P.caves.troubleCost, 1), depths: fmt(P.depths.troubleCost, 1) },
    { label: "Danger, per arrival (¢), a 1 on 1 in 6", caves: fmt(P.caves.base.danger, 2), depths: fmt(P.depths.base.danger, 2) },
    { label: "Net per arrival (¢)", caves: fmt(P.caves.base.net, 2), depths: fmt(P.depths.base.net, 2) },
    { label: "A trouble that costs this much cancels the loot (¢)", caves: fmt(P.caves.breakEvenWound, 1), depths: fmt(P.depths.breakEvenWound, 1) },
    { label: "Deaths per 100 arrivals (assumed mix)", caves: fmt(P.caves.base.deathsPerArrival * 100, 2), depths: fmt(P.depths.base.deathsPerArrival * 100, 2) },
    { label: "With Lucky: net per arrival (¢)", caves: fmt(P.caves.lucky.net, 2), depths: fmt(P.depths.lucky.net, 2) },
    { label: "With Lucky: deaths per 100 arrivals", caves: fmt(P.caves.lucky.deathsPerArrival * 100, 2), depths: fmt(P.depths.lucky.deathsPerArrival * 100, 2) },
  ];
  const tierBars = (z, color) =>
    Z[z].byTier.filter((t) => t.pFind > 0).map((t) => ({ label: `${tierLabel[t.tier]} (${pct(t.pFind, t.pFind < 0.01 ? 2 : 0)})`, value: t.evFind, color }));
  const lootCols = [
    { h: "Item", get: (r) => r.name },
    { h: "Tier", get: (r) => tierLabel[r.tier] ?? r.tier },
    { h: "Worth ¢", num: true, get: (r) => (r.value ? fmt(r.value, 1) : "—"), sort: (r) => r.value },
    { h: "How it is worth that", get: (r) => r.basis },
    { h: "Caves, per arrival", num: true, get: (r) => (r.cP ? pct(r.cP, 2) : "—"), sort: (r) => r.cP },
    { h: "Depths, per arrival", num: true, get: (r) => (r.dP ? pct(r.dP, 2) : "—"), sort: (r) => r.dP },
    { h: "Caves ¢ / arrival", num: true, get: (r) => fmt(r.cEv, 3), sort: (r) => r.cEv },
    { h: "Depths ¢ / arrival", num: true, get: (r) => fmt(r.dEv, 3), sort: (r) => r.dEv },
  ];
  const woundCols = [
    { h: "Trouble becomes", get: (w) => w.label },
    { h: "Priced as", get: (w) => w.what },
    { h: "Materials ¢", num: true, get: (w) => fmt(w.materials, 1) },
    { h: "Medic's Moves", num: true, get: (w) => (w.moves ? fmt(w.moves, 2) : "—") },
    { h: "All-in ¢", num: true, get: (w) => (w.kind === "death" ? "not priced" : fmt(w.total, 1)), sort: (w) => w.total },
    { h: "Caves share", num: true, get: (w) => pct(P.caves.mix[w.kind], 0) },
    { h: "Depths share", num: true, get: (w) => pct(P.depths.mix[w.kind], 0) },
  ];
  const scen = [];
  for (const zone of ["caves", "depths"])
    for (const n of C.arrivalsScenarios)
      for (const who of ["base", "lucky"]) {
        const r = P[zone][who];
        scen.push({ zone: zone === "caves" ? "Caves" : "Depths", arrivals: n, who: who === "base" ? "no Lucky" : "Lucky", loot: r.loot * n, danger: r.danger * n, net: r.net * n, deaths: r.deathsPerArrival * n * 100 });
      }
  const scenCols = [
    { h: "Where", get: (r) => r.zone },
    { h: "Arrivals a turn", num: true, get: (r) => r.arrivals },
    { h: "", get: (r) => r.who },
    { h: "Loot ¢", num: true, get: (r) => fmt(r.loot, 2), sort: (r) => r.loot },
    { h: "Wound cost ¢", num: true, get: (r) => fmt(r.danger, 2), sort: (r) => r.danger },
    { h: "Net ¢ a turn", num: true, get: (r) => fmt(r.net, 2), sort: (r) => r.net },
    { h: "Deaths per 100 turns", num: true, get: (r) => fmt(r.deaths, 1), sort: (r) => r.deaths },
  ];
  const diceCols = [
    { h: "Die", get: (d) => d.die },
    { h: "What it is", get: (d) => d.what },
    { h: "Where it lives", get: (d) => d.file },
  ];
  const tagCols = [
    { h: "Tag", get: (t) => t.name },
    { h: "Points", num: true, get: (t) => t.points },
    { h: "What it does", get: (t) => t.effect },
    { h: "On which dice", get: (t) => t.dice },
  ];
  return `<section><h2>The Caving Die</h2>
<p class="lede">The die rolls once on every arrival in the Caves or the Depths and there is no cap. In the code a <b>6 is a find</b> (a draw off the loot table) and a <b>1 is trouble</b> (a GM decides what happens, and nothing applies by itself); 2 to 5 is nothing. Your brief had the danger on a 6, so I have priced the danger on the trouble face, the 1, at the same 1 in 6. If you meant the 6 to carry both, every net figure below is the loot without its find chance.</p>
<h3>What a find is worth</h3>
<p class="lede">Each item is valued at the better of what the Depot pays or what it gives when opened or consumed (a Supply Kit is 8 ⬢, a Purse is 3 obols). An item the Depot only sells is <b>estimated</b> at 60% of its shelf price and kept out of the headline, so one key cannot carry a table. The ${fmt(Z.caves.unpricedShare * 100, 0)}% (Caves) and ${fmt(Z.depths.unpricedShare * 100, 0)}% (Depths) of finds with no price at all (rocks, curiosities, tools, keys, a mastery tag) count as nothing, so the loot figures are a floor.</p>
${table({ cols: summaryCols, rows: summary, id: "cavsum" })}
<h3>Where the value sits</h3>
<p class="lede">Expected ¢ per find, by tier, with the tier's share of finds beside it. The Caves live off the two ultracommon finds (Cave Fungus and Saltpeter) and cheap gear; the Depths' value comes from the rare tiers.</p>
${barChart({ rows: tierBars("caves", "var(--c1)"), unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 230 })}
${barChart({ rows: tierBars("depths", "var(--c3)"), unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 230 })}
<h3>Every item that can drop</h3>
${table({ cols: lootCols, rows: items, filters: [{ label: "Tier", get: (r) => tierLabel[r.tier] ?? r.tier }, { label: "Valued", get: (r) => r.basis.replace(/\s*\(.*\)/, "") }] })}
<h3>A note on danger</h3>
<p class="lede"><b>This part is the GM's call</b> (the <code>cavingmonsters</code> document and the Caving lens), so what follows is an assumption written down. A 1 costs what it takes to heal what the GM lets happen, read off the cure ladder (<code>TAGS.md</code> §5c), and the medic's Moves are priced at ${fmt(C.moveValue, 1)} ¢. In the Caves at least a minor wound, mostly; in the Depths a major wound, a lost limb or death is the likely outcome. Death has no cure and is counted, not priced. A 1 also costs −10 mood (tripled by Teratophobia) and pins you in the zone until the turn ends.</p>
${table({ cols: woundCols, rows: Object.values(C.wounds), id: "cavwounds" })}
<p class="lede">The result is that the loot does not pay for the danger. At the Caves a find is worth about ${fmt(Z.caves.evArrival, 2)} ¢ an arrival against ${fmt(P.caves.base.danger, 2)} ¢ of wound, so even an all-minor mix (${fmt(C.wounds.minor.total, 1)} ¢ a trouble) loses; the loot would need every trouble to cost under ${fmt(P.caves.breakEvenWound, 1)} ¢. The Depths are ${fmt(Z.depths.evArrival / Z.caves.evArrival, 1)} times richer but their trouble is dearer, and only a mostly-minor mix breaks even. Anybody who heals for free (a friend who is a medic) sees the loot alone, which is a small positive.</p>
<h3>Per turn, walking</h3>
<p class="lede">Arrivals are rationed only by the 3-second cool-down between walks, so a player can take several a turn. Loot and danger both scale with the number, and so does the chance of a death.</p>
${table({ cols: scenCols, rows: scen, filters: [{ label: "Where", get: (r) => r.zone }] })}
<h2>Extra rolls, and everything that bends a die</h2>
<p class="lede">The source is scanned for every place a character's die goes through the advantage helper (${C.rolls.dice.length} files), and this report fails a claim if one appears that it has not labelled. <b>No tag gives an extra draw on either loot table.</b> The Caving Die's loot draw and the prospecting draw are each made once. The only ways to change them are Lucky (a better die on the Caving Die, so more finds and fewer 1s) and Prospecting (a richer column on the prospecting table, not an extra roll). Lucky's description also says it covers "the laboring die", but mining rolls no die now, so that phrase is stale (the claims table lists it).</p>
${table({ cols: diceCols, rows: C.rolls.dice, id: "cavdice" })}
${table({ cols: tagCols, rows: C.rolls.tags, id: "cavtags" })}
</section>`;
}

function sectionTrinkets() {
  const T = model.trinkets;
  const pct = (v) => `${fmt(v * 100, 0)}%`;
  const tierName = T.tiers.map((t) => t.name);
  const holderCols = [
    { h: "Smith", get: (h) => h.label },
    ...T.tiers.map((t, i) => ({ h: t.name, num: true, get: (h) => (h.tierP[i] ? pct(h.tierP[i]) : "—"), sort: (h) => h.tierP[i] })),
    { h: "Average base ¢", num: true, get: (h) => fmt(h.eBase, 1), sort: (h) => h.eBase },
    { h: "Average multiplier", num: true, get: (h) => fmt(h.eMult, 2), sort: (h) => h.eMult },
    { h: `A bare Trinket, less its ${T.dieCost} ¢ of ⬢`, num: true, get: (h) => fmt(h.bareProfit, 1), sort: (h) => h.bareProfit },
  ];
  const tierCols = [
    { h: "Face", num: true, get: (r) => r.face },
    { h: "Tier", get: (r) => r.name },
    { h: "Bare price ¢", num: true, get: (r) => r.base },
    { h: "× the stones", num: true, get: (r) => r.mult },
  ];
  const stoneRate = (r) => {
    const parts = [];
    if (r.cavesPlain) parts.push(`Caves ${fmt(r.cavesPlain * 100, 1)}%`);
    if (r.depthsPlain) parts.push(`Depths ${fmt(r.depthsPlain * 100, 1)}%`);
    if (r.cavingCaves || r.cavingDepths) parts.push(`Die ${fmt(Math.max(r.cavingCaves, r.cavingDepths) * 100, 2)}%`);
    return parts.join(", ") || "not mined";
  };
  const stoneCols = [
    { h: "Stone", get: (r) => r.name },
    { h: "Group", get: (r) => r.group },
    { h: "Sells ¢", num: true, get: (r) => r.sold, sort: (r) => r.sold },
    { h: "Shelf ¢", num: true, get: (r) => r.shelf ?? "—", sort: (r) => r.shelf ?? -1 },
    { h: "Inlay", num: true, get: (r) => r.inlay, sort: (r) => r.inlay },
    { h: "Rule says", num: true, get: (r) => r.expected ?? "—", sort: (r) => r.expected ?? -1 },
    { h: "Forging adds, Smithing", num: true, get: (r) => fmt(r.uplift.apprentice, 1), sort: (r) => r.uplift.apprentice },
    { h: "Forging adds, Smithing II", num: true, get: (r) => fmt(r.uplift.skilled, 1), sort: (r) => r.uplift.skilled },
    { h: "Where it drops (a press, pick only)", get: stoneRate },
  ];
  const comboCols = (extra = []) => [
    { h: "Stones", get: (c) => c.stones.join(" + ") || "none" },
    { h: "Inlay", num: true, get: (c) => c.inlay, sort: (c) => c.inlay },
    { h: "Stones cost ¢", num: true, get: (c) => fmt(c.stoneCost, 0), sort: (c) => c.stoneCost },
    { h: "Smithing ¢/Move", num: true, get: (c) => fmt(c.apprentice, 1), sort: (c) => c.apprentice },
    { h: "Smithing II ¢/Move", num: true, get: (c) => fmt(c.skilled, 1), sort: (c) => c.skilled },
    { h: "Smithing II + Lucky", num: true, get: (c) => fmt(c["skilled-lucky"], 1), sort: (c) => c["skilled-lucky"] },
    ...extra,
  ];
  const wageTop = T.shelfLoop.topWage;
  const shelf = T.combos.bestShelf;
  const proRows = [];
  for (const [key, label] of [["caves:plain", "Caves, pick only"], ["caves:skilled", "Caves, Prospecting"], ["depths:plain", "Depths, pick only"], ["depths:skilled", "Depths, Prospecting"]])
    for (const h of [T.holders[0], T.holders[1]]) {
      const r = T.prospector[key][h.id];
      proRows.push({ where: label, smith: h.label, stones: r.stones, trinkets: r.trinkets, revenue: r.revenue, forgone: r.forgone, net: r.net, perTurn: r.net * 0.5 });
    }
  const proCols = [
    { h: "Mining", get: (r) => r.where },
    { h: "Smith", get: (r) => r.smith },
    { h: "Stones a press", num: true, get: (r) => fmt(r.stones, 2), sort: (r) => r.stones },
    { h: "Trinkets a press", num: true, get: (r) => fmt(r.trinkets, 2), sort: (r) => r.trinkets },
    { h: "They sell for ¢", num: true, get: (r) => fmt(r.revenue, 1), sort: (r) => r.revenue },
    { h: "Raw sale forgone ¢", num: true, get: (r) => fmt(r.forgone, 1), sort: (r) => r.forgone },
    { h: "Net a press ¢", num: true, get: (r) => fmt(r.net, 1), sort: (r) => r.net },
    { h: "Net a turn ¢ (a press every other turn)", num: true, get: (r) => fmt(r.perTurn, 1), sort: (r) => r.perTurn },
  ];
  const ark = T.combos.ark;
  return `<section><h2>Trinket forging</h2>
<p class="lede">A smith spends <b>a whole Move and ${T.gate.resources} ⬢</b> (${T.dieCost} ¢ at the Depot's import price), slots up to ${T.gate.slotsMax} stones, and rolls a d6. The face is a tier, and the Merchant pays <code>round(base + multiplier × the stones' summed inlay)</code>. A Smithing II smith never rolls below face ${T.gate.floorFace}. Lucky rolls twice and keeps the better. Nothing else touches the die (no hunger or mood modifier), so the four smiths below are the whole story.</p>
${table({ cols: holderCols, rows: T.holders, id: "trinholders" })}
${table({ cols: tierCols, rows: T.tiers.map((t, i) => ({ face: i + 1, ...t })), id: "trintiers" })}
<p class="lede">A Trinket with no stones at all nets a Smithing smith ${fmt(T.holders[0].bareProfit, 1)} ¢ a Move and a Smithing II smith ${fmt(T.holders[1].bareProfit, 1)}, against a wage table that pays ${fmt(model.profitTiers.find((t) => t.points === 5)?.rate, 0)} and ${fmt(model.profitTiers.find((t) => t.points === 10)?.rate, 0)}. The floor is worth ${fmt(T.holders[1].bareProfit - T.holders[0].bareProfit, 1)} ¢ a Move bare, and Lucky ${fmt(T.holders[2].bareProfit - T.holders[0].bareProfit, 1)}.</p>
<h3>What each stone is worth forged</h3>
<p class="lede">Every stone inlays for <code>2 × its sell price + 4</code>, held one under the shelf price where the Merchant stocks it, so a smith turns a 1 ¢ ore into about ${fmt(T.holders[0].eMult * 6, 0)} ¢ of price. The right-hand columns are what forging adds over selling the stone raw, at the average multiplier.</p>
${table({ cols: stoneCols, rows: T.stones, filters: [{ label: "Group", get: (r) => r.group }] })}
<h3>The best Trinkets from stones you dug up</h3>
<p class="lede">Profit a Move, the stones counted at what they would have sold for. The Arkenstone is left out of the ranking (it drops on about one Depths press in a hundred); with a Black Diamond it makes a Trinket worth about <b>${fmt(ark?.skilled, 0)} ¢</b> a Move to Smithing II over selling both raw.</p>
${table({ cols: comboCols(), rows: T.combos.bestOwn })}
<h3>Forging what you bought at the shelf</h3>
<p class="lede">The doc says a stone that inlays for at least the shelf price could be bought, forged and sold at a profit forever, and holds each one a coin under. <b>That does not close the loop</b>: a Trinket also pays its tier's bare price and a multiplier above 1, so a round trip through the Merchant pays even with every stone capped. The best is <b>${fmt(T.shelfLoop.bestApprentice?.apprentice, 1)} ¢ a Move</b> for a Smithing smith and <b>${fmt(T.shelfLoop.bestSkilled?.skilled, 1)} ¢</b> for Smithing II (${fmt(T.shelfLoop.bestSkilled?.["skilled-lucky"], 1)} with Lucky), against a wage table whose top rung is ${wageTop} ¢. It needs a Merchant's licence for the shelf and nothing else.</p>
${table({ cols: comboCols(), rows: shelf })}
<h3>A prospector who forges what they dig up</h3>
<p class="lede">Every stone that drops is forged in pairs on the rest turn a miner has anyway. The net is what the Trinkets sell for, less the ⬢ they cost and the raw sale of the stones. It is the best use of a miner's spare Move in this report: about <b>${fmt(T.prospector["caves:plain"].apprentice.net, 1)} ¢ a press</b> at the Caves with only a pick, on top of the ${fmt(model.activities.find((a) => a.id === "mine:Caves:unskilled")?.perAction, 1)} ¢ the press itself pays.</p>
${table({ cols: proCols, rows: proRows, filters: [{ label: "Mining", get: (r) => r.where }] })}
</section>`;
}

function sectionCooking() {
  const C = model.cooking;
  const cropOnly = C.cropOnly.filter((d) => d.tier === "Basic");
  const raw = C.strategies.find((x) => x.id === "raw-potato");
  const rawWheat = C.strategies.find((x) => x.id === "raw-wheat");
  const cooked = C.strategies.find((x) => x.id === "cooked");
  const fert = C.strategies.find((x) => x.id === "cooked-fert");
  const A = C.cookAdds;
  const stratCols = [
    { h: "How the town eats", get: (r) => r.label },
    { h: "Hunger a crop", num: true, get: (r) => fmt(r.hungerPerCrop, 1), sort: (r) => r.hungerPerCrop },
    { h: "Crops a turn", num: true, get: (r) => fmt(r.cropsPerTurn, 0), sort: (r) => r.cropsPerTurn },
    { h: "Farm actions a turn", num: true, get: (r) => fmt(r.farmActionsPerTurn, 1), sort: (r) => r.farmActionsPerTurn },
    { h: "Farmers needed", num: true, get: (r) => fmt(r.farmers, 1), sort: (r) => r.farmers },
    { h: "Cook Moves a turn", num: true, get: (r) => (r.cookMoves ? fmt(r.cookMoves, 1) : "—"), sort: (r) => r.cookMoves },
    { h: "Free Moves the farmers already have", num: true, get: (r) => fmt(r.freeFarmerMoves, 1), sort: (r) => r.freeFarmerMoves },
    { h: "Bites a person-turn", num: true, get: (r) => fmt(r.bitesPerPersonTurn, 1), sort: (r) => r.bitesPerPersonTurn },
    { h: "Mood a person-turn", num: true, get: (r) => fmt(r.moodPerPersonTurn, 1), sort: (r) => r.moodPerPersonTurn },
    { h: "Note", get: (r) => r.note },
  ];
  const dishCols = [
    { h: "Dish", get: (d) => d.name },
    { h: "Tier", get: (d) => d.tier },
    { h: "Made from", get: (d) => d.inputs.join(" + ") },
    { h: "Hunger", num: true, get: (d) => d.hunger, sort: (d) => d.hunger },
    { h: "Mood", num: true, get: (d) => d.mood, sort: (d) => d.mood },
    { h: "Hunger an input", num: true, get: (d) => fmt(d.hungerPerUnit, 1), sort: (d) => d.hungerPerUnit },
    { h: "Same inputs raw", num: true, get: (d) => d.rawHunger, sort: (d) => d.rawHunger },
    { h: "Cooking gives", num: true, get: (d) => (d.multiplier == null ? "—" : `×${fmt(d.multiplier, 2)}`), sort: (d) => d.multiplier ?? 0 },
    { h: "Moves a dish", num: true, get: (d) => fmt(d.moves, 2), sort: (d) => d.moves },
    { h: "Inputs cost ¢", num: true, get: (d) => fmt(d.cost, 1), sort: (d) => d.cost },
    { h: "Worth at the box's price ¢", num: true, get: (d) => fmt(d.value, 1), sort: (d) => d.value ?? 0 },
    { h: "Margin a Move ¢", num: true, get: (d) => (d.marginPerMove == null ? "—" : fmt(d.marginPerMove, 0)), sort: (d) => d.marginPerMove ?? -1e9 },
    { h: "Hardest input to get", get: (d) => (d.hardestRank >= 5 ? `no way in: ${d.unreachable.join(", ")}` : `rank ${d.hardestRank}`) },
  ];
  const bars = C.dishes.slice(0, 22).map((d) => ({ label: `${d.name}${d.tier === "Skilled" ? " *" : ""}`, value: d.hungerPerUnit, color: d.unreachable.length ? "var(--bad)" : d.farmOnly ? "var(--c3)" : "var(--c1)" }));
  const inCols = [
    { h: "Ingredient", get: (r) => r.name },
    { h: "Raw", get: (r) => (r.rawHunger > 0 ? `${r.rawHunger} hunger, ${r.rawMood} mood, ${r.rawEffect}` : r.rawEffect) },
    { h: "Comes from", get: (r) => r.source },
    { h: "Becomes", get: (r) => (r.bestDish ? `${r.bestDish}: ${r.dishHunger} hunger, ${r.dishMood} mood${r.via ? ` (via ${r.via})` : ""}` : "no recipe takes it") },
    { h: "Every dish it goes in", get: (r) => r.dishes.join(", ") || "—" },
  ];
  const slotCols = [
    { h: "Slot it in", get: (a) => a.name },
    { h: "Adds hunger", num: true, get: (a) => a.hunger, sort: (a) => a.hunger },
    { h: "Adds mood", num: true, get: (a) => a.mood, sort: (a) => a.mood },
    { h: "Costs ¢", num: true, get: (a) => a.cost ?? "—", sort: (a) => a.cost ?? -1 },
    { h: "Where it comes from", get: (a) => a.source },
  ];
  return `<section><h2>Cooks against farmers</h2>
<p class="lede">A person burns ${params.hungerDecay} hunger a turn, so ${players} players need <b>${fmt(C.need, 0)} hunger</b> a turn. One Farm action harvests about ${fmt(C.harvest, 1)} crops, every third turn. <b>Yes, a cook is worth more than another farmer at the margin</b>: cooking a pair of crops into ${esc(C.cropDish?.name ?? "a dish")} gives ${fmt(C.cropDish?.hungerPerUnit, 1)} hunger a crop against ${fmt(raw.hungerPerCrop, 0)} for a raw potato (×${fmt(C.cropDish?.hungerPerUnit / raw.hungerPerCrop, 2)}) and ${fmt(rawWheat.hungerPerCrop, 0)} for raw wheat (×${fmt(C.cropDish?.hungerPerUnit / rawWheat.hungerPerCrop, 1)}), for 0.05 of a Move a dish. That takes the farmers needed from ${fmt(raw.farmers, 0)} to <b>${fmt(cooked.farmers, 1)}</b> (${fmt(fert.farmers, 1)} with Fertilizer), and the cooking fits in the Moves a farmer has spare between Farm actions (${fmt(cooked.cookMoves, 1)} needed, ${fmt(cooked.freeFarmerMoves, 1)} spare), so a farmer-cook adds no headcount. What cooking cannot do is replace the fields: it multiplies a harvest and never makes one.</p>
${table({ cols: stratCols, rows: C.strategies, id: "cookstrat" })}
${C.boxStrategy ? `<p class="lede">${esc(C.boxStrategy.note)} A Ration Box eater needs no farmer, so the Depot is the third way to be fed.</p>` : ""}
<p class="lede">Per Move, farming still wins: one Farm action is ${fmt(A.farmPersonTurnsPerMove, 1)} person-turns of food for a Move, and the cooking on that harvest adds ${fmt(A.gainPersonTurns, 1)} person-turns for ${fmt(A.movesPerAction, 2)} Moves, ${fmt(A.cookPersonTurnsPerMove, 1)} a Move. But Moves are not what limits a farmer (the lockout is), and the raw diet costs −10 mood a bite: ${fmt(raw.bitesPerPersonTurn, 1)} bites a person-turn is <b>${fmt(raw.moodPerPersonTurn, 0)} mood</b>, against ${fmt(cooked.moodPerPersonTurn, 0)} for one cooked bite.</p>
<h3>How much food an input makes</h3>
<p class="lede">Hunger per input unit, best first (a * marks a Skilled dish). Green is made from crops alone, red needs something the game gives no way to get, blue needs something farmed or dug up. The ${cropOnly.length} crop-only Basic dishes all make 35 from two crops and differ only in mood (${Math.min(...cropOnly.map((d) => d.mood))} to ${Math.max(...cropOnly.map((d) => d.mood))}); the Skilled dishes buy mood, not food.</p>
${barChart({ rows: bars, unit: " hunger", fmtVal: (v) => fmt(v, 1), labelW: 170 })}
<h3>Every dish</h3>
<p class="lede">"Worth at the box's price" is what the same hunger costs from a Ration Box, the price a buyer with coin will not pay more than, so the margin is what a cook could ask above the inputs. Dishes cannot be sold to the Depot, so a cook's pay is whatever another player agrees to.</p>
${table({ cols: dishCols, rows: C.dishes, filters: [{ label: "Tier", get: (d) => d.tier }, { label: "Made from", get: (d) => (d.farmOnly ? "crops only" : d.unreachable.length ? "needs something with no source" : "other inputs") }] })}
<h3>Turning what nobody eats into food</h3>
<p class="lede">Yes, for a few. Wheat makes you sick raw and is Bread. Purring Maggot, an ultracommon cave find that poisons you, brews into Maggot Milk and that is Pancakes and Fondue. Deep Morel is a Merchant's shelf item that makes you sick and is the Soaked Truffles (48 hunger, +38 mood). Rock Salt, another ultracommon find, cannot be eaten and seasons Salo and Caviar. Cave Fungus, Saltpeter and Rock go in no recipe, though a Cave Fungus can be slotted into any dish for nothing.</p>
${table({ cols: inCols, rows: C.inedible, id: "cookinedible" })}
<p class="lede">${C.ratGap.fixed ? `<b>The cave rat cooks.</b> The rat the caves drop is <code>${esc(C.ratGap.caveRatSlug)}</code>, and ${C.ratGap.dishes.map(esc).join(", ")} take that same tag, so a common cave find (about one find in six in the Caves) is a Ratato, a Fried Rat or a Poached Rat.` : `<b>The rat is a broken link.</b> The cave loot table drops <code>${esc(C.ratGap.caveRatSlug)}</code>, but ${C.ratGap.dishes.map(esc).join(", ")} take <code>${esc(C.ratGap.recipeRatSlug)}</code>, which nothing in the game produces (${esc(C.ratGap.recipeRatSource)}).`} ${C.unreachableDishes.length} of ${C.dishes.length} dishes need an input with no way into the game (${[...new Set(C.unreachableDishes.flatMap((d) => d.unreachable))].map(esc).join(", ")}).</p>
<h3>What a cook can slot in</h3>
<p class="lede">Any dish takes up to four extra ingredients, each adding its own hunger and, if positive, its mood. A slot never beats the base for food (12 hunger a crop is what eating it raw gives) but it is where a cook buys mood, and the raw −10 does not apply. The meter tops out at ${params.hungerMax}, so a Bread with four slots is at most 83.</p>
${table({ cols: slotCols, rows: C.addIns.slice(0, 14) })}
</section>`;
}

function sectionDesires() {
  const D = model.desires;
  const open = D.satisfiers.filter((r) => r.open && !r.once).sort((a, b) => a.netCoin / a.tier - b.netCoin / b.tier);
  const gated = D.satisfiers.filter((r) => !r.open && !r.once).sort((a, b) => a.netCoin / a.tier - b.netCoin / b.tier);
  const bigTicket = D.satisfiers.filter((r) => r.once).sort((a, b) => b.netCoin - a.netCoin);
  const cols = (who) => [
    { h: "Desire", get: (r) => r.name },
    { h: "Tier", num: true, get: (r) => r.tier, sort: (r) => r.tier },
    { h: "Cooldown", num: true, get: (r) => `${r.cooldown} ${r.cooldownFromLadder ? "" : "(the tier)"}`.trim(), sort: (r) => r.cooldown },
    { h: "To satisfy it", get: (r) => r.doThis },
    { h: "Costs ¢", num: true, get: (r) => (r.capital && !r.coin ? `${r.capital} held` : fmt(r.coin, 1)), sort: (r) => r.coin },
    { h: "After resale ¢", num: true, get: (r) => (r.resale ? fmt(r.netCoin, 1) : "—"), sort: (r) => r.netCoin },
    { h: "¢ a point", num: true, get: (r) => fmt(r.netCoin / r.tier, 1), sort: (r) => r.netCoin / r.tier },
    { h: "Points a turn if repeated", num: true, get: (r) => fmt(r.pointsPerTurn, 2), sort: (r) => r.pointsPerTurn },
    ...(who ? [{ h: "Who can claim", get: (r) => r.who }] : []),
    { h: "Notes", get: (r) => [r.how, r.note].filter(Boolean).join(". ") },
  ];
  const planCols = [
    { h: "Play", get: (p) => p.label },
    { h: `Points over ${params.gameTurns} turns`, num: true, get: (p) => p.points, sort: (p) => p.points },
    { h: "Coin spent ¢", num: true, get: (p) => fmt(p.coin, 0), sort: (p) => p.coin },
    { h: "¢ a point", num: true, get: (p) => fmt(p.perPoint, 1), sort: (p) => p.perPoint },
    { h: "Coin held ¢", num: true, get: (p) => p.capital, sort: (p) => p.capital },
    { h: "What it claimed", get: (p) => p.used.slice(0, 5).map((u) => `${(D.satisfiers.find((s) => s.slug === u.slug)?.name ?? u.slug).replace(/^(Drink|Eat|Smoke|Take|Have|Make) /, "$1 ")} ×${u.n}`).join(", ") },
  ];
  const buyCols = [
    { h: "A point buys", get: (b) => b.name },
    { h: "Points", num: true, get: (b) => b.points, sort: (b) => b.points },
    { h: "Pays ¢ / turn", num: true, get: (b) => fmt(b.gain, 1), sort: (b) => b.gain },
    { h: "¢ / turn per point", num: true, get: (b) => fmt(b.perPoint, 2), sort: (b) => b.perPoint },
    { h: `Over ${params.gameTurns} turns, per point ¢`, num: true, get: (b) => fmt(b.overGame, 0), sort: (b) => b.overGame },
  ];
  const best = D.plans[0];
  const cheap = D.plans[1];
  return `<section><h2>Desires as an income</h2>
<p class="lede">A Desire pays its <b>tier in Tag Points</b> and is claimed afterwards. Of ${D.count.total} in the catalog, <b>${D.count.satisfiable}</b> can be satisfied by buying, making, consuming or owning something, and ${D.count.open} of those are open to anybody. What limits a person is not the catalog but the slots: ${D.slots} slots that each lock for ${D.lockTurns} turn after a claim allow at most <b>${fmt(D.claimsPerTurn, 0)} claim a turn</b>, so the ceiling is one Desire a turn at the highest tier that is off cooldown. A character starts with ${D.startingPoints} points to spend.</p>
<p class="lede">The catalog does not price its Desires, so the satisfier beside each one is my reading of its wording and the price comes from the tag catalog. <b>The gate is a claim a GM reviews</b> (the player must say how they did it and a GM can reject it), so what follows is what the rules allow, not what a GM would let stand.</p>
<h3>What it turns into</h3>
<p class="lede">Played out over ${params.gameTurns} turns with one claim a turn and the gambling left out, the open Desires pay <b>${best.points} points for ${fmt(best.coin, 0)} ¢</b> if a person will carry ${best.capital} ¢ and can get Godflesh, and <b>${cheap.points} points for ${fmt(cheap.coin, 0)} ¢</b> (${fmt(cheap.perPoint, 1)} ¢ a point) if all they do is buy consumables off a shelf. Set that against what a point buys: <b>${D.buys[0]?.name}</b> pays ${fmt(D.buys[0]?.perPoint, 1)} ¢ a turn for every point spent, and ${D.buys.find((b) => b.name === "Soilery")?.name ?? "Soilery"} ${fmt(D.buys.find((b) => b.name === "Soilery")?.gain, 1)} ¢ a turn for ${D.buys.find((b) => b.name === "Soilery")?.points} points, so the coin behind a point is repaid many times over. Desires are a converter from a few coin into skills, and the throttle on it is the slot lock, not the price.</p>
${table({ cols: planCols, rows: D.plans, id: "desireplans" })}
<h3>What a point buys</h3>
<p class="lede">From the investment table, per point spent. The last column is what a point is worth over the game if the thing it buys is bought at once.</p>
${table({ cols: buyCols, rows: D.buys })}
<h3>Open to anybody, repeatable</h3>
<p class="lede">Every drink, smoke, drug and sweet sits on a flat 3-turn cooldown by design, so three of them in rotation fill the one claim a turn. <b>Hold 100 ¢</b> is the free one: it costs nothing per attempt, so the policy in <code>desires.yaml</code> would put it on the 4-turn ladder, and it is on its tier's 2 instead, for a point a turn from anybody with 100 ¢ in the pocket.</p>
${table({ cols: cols(false), rows: open, id: "desireopen" })}
<h3>Gated by a role or a tag</h3>
${table({ cols: cols(true), rows: gated, id: "desiregated" })}
<h3>Once per game, and the big tickets</h3>
<p class="lede">A Motorcycle is 191 ¢ at the shelf and sells back for 115, so the Desire costs about ${fmt(bigTicket.find((b) => b.slug === "metal-ride")?.netCoin, 0)} ¢ for 3 points (pusher only). The tier 4 and 5 goals (a manor, buying your freedom, the Arkenstone) are not on any shelf and are not priced here.</p>
${table({ cols: cols(true), rows: bigTicket, id: "desirebig" })}
</section>`;
}

function sectionLucky() {
  const K = model.lucky;
  const ranked = K.ranked;
  const cols = [
    { h: "Die", get: (u) => u.die },
    { h: "Who, and how often", get: (u) => u.who },
    { h: "Gain ¢ a turn", num: true, get: (u) => fmt(u.gain, 1), sort: (u) => u.gain },
    { h: "How", get: (u) => u.basis },
    { h: "Note", get: (u) => u.note },
  ];
  const lessonCols = [
    { h: "The teacher", get: (l) => l.label },
    { h: "Needs", num: true, get: (l) => `${l.threshold}+`, sort: (l) => l.threshold },
    { h: "A try succeeds", num: true, get: (l) => `${fmt(l.plain * 100, 0)}% → ${fmt(l.lucky * 100, 0)}%`, sort: (l) => l.lucky },
    { h: "Tries to learn it", num: true, get: (l) => `${fmt(l.triesPlain, 1)} → ${fmt(l.triesLucky, 1)}`, sort: (l) => l.triesLucky },
    { h: "Moves saved", num: true, get: (l) => fmt(l.movesSaved, 2), sort: (l) => l.movesSaved },
  ];
  const bars = ranked.filter((u) => u.scales !== false || u.perTrinket || u.id === "push-on").slice(0, 12).map((u) => ({ label: `${u.die}: ${u.who}`.slice(0, 58), value: u.gain, color: u.die === "Caving Die" ? "var(--c1)" : u.die === "Forging a Trinket" ? "var(--c3)" : "var(--c0)" }));
  const unpricedCols = [
    { h: "Die", get: (u) => u.die },
    { h: "What Lucky does", get: (u) => u.what },
    { h: "Note", get: (u) => u.note },
  ];
  return `<section><h2>Lucky, use by use</h2>
<p class="lede">The investment table priced Lucky on one die (the Caving Die) at one arrival a turn, which is its worst case. Lucky keeps the better of two on twelve dice, and what it is worth depends on which of them a person rolls and how often. Keeping the better of two d6 turns a 6 from 1 in 6 into ${fmt(K.lucky.find * 36, 0)} in 36 and a 1 from 1 in 6 into 1 in 36; the average die goes from ${fmt(K.plain.mean, 2)} to ${fmt(K.lucky.mean, 2)}. <b>Most of the value is a 1 that never happens</b>, so it pays most where a 1 is expensive and the die is rolled often.</p>
<p class="lede"><b>The best use is cave diving, and the more you walk the better.</b> At the Depths, ${fmt(K.uses.find((u) => u.id === "caving-depths-1")?.gain, 1)} ¢ a turn at one arrival becomes ${fmt(K.uses.find((u) => u.id === "caving-depths-4")?.gain, 1)} at four and ${fmt(K.uses.find((u) => u.id === "caving-depths-10")?.gain, 1)} at ten, because the die is rolled on every arrival and nothing caps them but a 3-second walk cooldown. Nearly all of it is the wound cost avoided (the trouble cost is my assumption of the GM's, ${fmt(model.caving.perZone.depths.troubleCost, 0)} ¢ a trouble in the Depths). Forging is second and is <b>per Trinket, not per turn</b>: a Trinket is a whole Move, so a smith with good stones gets ${fmt(K.uses.find((u) => u.id === "trinket-apprentice-98")?.gain, 0)} ¢ a Move from Lucky, and one with poor stones ${fmt(K.uses.find((u) => u.id === "trinket-apprentice-20")?.gain, 0)}; but stones are what limit a forger, so a miner forging their own gets about ${fmt(K.uses.find((u) => u.id === "trinket-prospector")?.gain, 1)} ¢ a turn.</p>
${barChart({ rows: bars, unit: " ¢", fmtVal: (v) => fmt(v, 1), labelW: 330 })}
<h3>Every use that has a price</h3>
${table({ cols, rows: ranked, filters: [{ label: "Die", get: (u) => u.die }] })}
<h3>Lessons</h3>
<p class="lede">Lucky does not change whether a skill is learnt, only how many tries it takes, and each try is a Move for the learner. The skill itself is worth its points, so a lesson is a one-off and is not in the ranking.</p>
${table({ cols: lessonCols, rows: K.lessons })}
<h3>What it does that has no price</h3>
<p class="lede">The largest thing Lucky does is not money. It adds about <b>+1 to every Gambit</b>, the die every Move's Gambit rolls, which is the same size as the +1 an Arkenstone Trinket gives while held, and takes the chance of a 1 from 1 in 6 to 1 in 36. That is what the 15 points are mostly buying, and a GM decides what a Gambit is worth. If the economy is to price it, Lucky is closer to a fair price than the ¢ per point figure suggests.</p>
${table({ cols: unpricedCols, rows: K.unpriced })}
</section>`;
}

function sectionSeats() {
  const c = model.combos;
  const cols = [
    { h: "Skills", get: (r) => r.skills.join(" + ") },
    { h: "Points", num: true, get: (r) => r.points },
    ...c.seatSensitivity[0].byCrowd.map((x, i) => ({
      h: `${x.people} want a seat`,
      num: true,
      get: (r) => fmt(r.byCrowd[i].rate),
      sort: (r) => r.byCrowd[i].rate,
    })),
    { h: "No Factory", num: true, get: (r) => fmt(r.noFactory), sort: (r) => r.noFactory },
  ];
  const cubes = params.refineryYield;
  const perTurn = params.refinerySeats * cubes;
  return `<h3>When the Factory is crowded</h3>
<p class="lede">Only ${params.refinerySeats} people may refine in a turn, so the Factory can turn out at most ${perTurn} cubes (${fmt(perTurn * (model.activities.find((a) => a.id === "factory:refine-supplied")?.perAction ?? 0) / cubes, 0)} ¢ of Squeeze) a turn, however many people want the work. The seats go to whoever presses first, and a refused press costs no Move, so a person who misses out does something else that turn. This table gives each person a chance of seats ÷ people of finding a seat free, which is an average, not a promise. A seat is only worth having on a turn you are not Exhausted.</p>
${table({ cols, rows: c.seatSensitivity })}`;
}

function sectionCombos() {
  const c = model.combos;
  const label = (l) => l.skills.join(" + ");
  const bestUnder = (pts, key) => c.loadouts.filter((l) => l.points <= pts).sort((x, y) => y[key].rate - x[key].rate || x.points - y.points)[0];
  const steps = (key) => {
    const out = [];
    for (const s of c.staircase) {
      const pick = s[key];
      if (!out.length || label(out[out.length - 1].l) !== label(pick)) out.push({ points: s.points, l: pick });
    }
    return out;
  };
  const stepCols = (key) => [
    { h: "From points", num: true, get: (r) => r.points },
    { h: "Loadout", get: (r) => label(r.l) },
    { h: "Costs", num: true, get: (r) => `${r.l.points} pt`, sort: (r) => r.l.points },
    { h: "¢ / turn", num: true, get: (r) => fmt(r.l[key].rate), sort: (r) => r.l[key].rate },
    { h: `Over ${c.gameTurns} turns`, num: true, get: (r) => fmt(r.l[key].total, 0), sort: (r) => r.l[key].total },
    { h: "Schedule", get: (r) => r.l[key].pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
    { h: "Where", get: (r) => r.l[key].zones, style: () => "font-family:var(--mono);letter-spacing:1px" },
  ];
  const aloneCols = [
    { h: "Activity", get: (r) => r.label },
    { h: "¢ / turn", num: true, get: (r) => fmt(r.rate), sort: (r) => r.rate },
    { h: `Over ${c.gameTurns} turns`, num: true, get: (r) => fmt(r.total, 0), sort: (r) => r.total },
    { h: "Schedule", get: (r) => r.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
  ];
  const startCols = [
    { h: "Skills", get: (l) => label(l) },
    { h: "Points", num: true, get: (l) => l.points },
    { h: "With the Factory", num: true, get: (l) => fmt(l.withFactory.rate), sort: (l) => l.withFactory.rate },
    { h: "Schedule", get: (l) => l.withFactory.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
    { h: "Without it", num: true, get: (l) => fmt(l.noFactory.rate), sort: (l) => l.noFactory.rate },
    { h: "Schedule", get: (l) => l.noFactory.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
  ];
  const startRows = c.loadouts.filter((l) => l.points <= 8).sort((x, y) => y.withFactory.rate - x.withFactory.rate || y.noFactory.rate - x.noFactory.rate).filter((l, i, arr) => arr.findIndex((x) => label(x) === label(l)) === i).slice(0, 10);
  const bars = [];
  for (const s of steps("withFactory")) bars.push({ label: `${label(s.l)} (${s.l.points} pt), with Factory`, value: s.l.withFactory.rate, color: "var(--c1)" });
  for (const s of steps("noFactory")) bars.push({ label: `${label(s.l)} (${s.l.points} pt), no Factory`, value: s.l.noFactory.rate, color: "var(--c0)" });
  const farmAlone = c.alone.find((a) => /^Farm/.test(a.label));
  const refAlone = c.alone.find((a) => /^Refine/.test(a.label));
  const start = bestUnder(8, "withFactory");
  const startNo = bestUnder(8, "noFactory");
  const cubes = params.refineryYield;
  const lbs = cubes * (model.params.squeezeLbs ?? 17);
  const zoneRows = Object.entries(c.crossings).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td>${v <= c.free ? "free" : v === c.free + 1 ? `costs the Move` : "two or more turns"}</td></tr>`).join("");
  const verbRows = model.combos.verbs.map((v) => `<tr><td>${esc(v.label)}</td><td>${esc(v.zone ?? "anywhere")}</td><td class="num">${fmt(v.value)}</td><td>${v.fatigue ? "climbs the ladder" : "no fatigue"}</td><td>${v.needs.length ? esc(v.needs.join(", ")) : "no skill"}</td></tr>`).join("");
  return `<section><h2>Combining activities</h2>
<p class="lede">Each day-verb is rationed by something different, so they can fill each other's gaps. This is a planner, not a guess: it searches every schedule for the best one, turn by turn, using the game's own fatigue gates. It is exact within the rules below.</p>
<ul class="ranks">
<li><b>The Move.</b> One a turn. Mine, Farm and Refine each take all of it, and crafts share it in fractions, so a turn is one day-verb or a craft mix, never both.</li>
<li><b>Fatigue.</b> Mine, Refine and Farm all climb the Tired and Exhausted ladder (Mine and Refine one step at a time, Farm outright), so each can be pressed only some turns. Crafts, cutting Godflesh and Butcher never touch it, so a craft fills the turns a day-verb is locked out.</li>
<li><b>Seats.</b> Only ${params.refinerySeats} people may refine at the Factory in a turn. The main tables assume you can always get a seat; the crowd table below shows what competition does.</li>
<li><b>Skill points and tools.</b> Farm needs Soilery (7). Mine needs a pickaxe (2 points at creation, or a smith makes one) and Prospecting (7) pays ×1.7 on top, so a starting budget of ${params.startingTagPoints} cannot hold both. Refine and cutting Godflesh need no skill.</li>
<li><b>Place.</b> Hops inside a zone are free, and a turn allows ${c.free} free zone crossing${c.free === 1 ? "" : "s"} (a mount adds one; <code>--free-moves</code> changes it). A crossing beyond that costs the Move, so nearby workplaces do not cost formal Moves.</li>
</ul>
<h3>Where the work is</h3>
<div class="tablewrap"><table><thead><tr><th>Verb</th><th>Zone</th><th class="num">¢ per press</th><th>Fatigue</th><th>Needs</th></tr></thead><tbody>${verbRows}</tbody></table></div>
<div class="tablewrap"><table><thead><tr><th>Trip</th><th class="num">Crossings</th><th>Cost</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
<h3>Each activity on its own</h3>
${table({ cols: aloneCols, rows: c.alone })}
<h3>The best mix at each skill budget</h3>
<p class="lede">The schedule reads one letter a turn: <b>R</b> Refine, <b>F</b> Farm, <b>M</b> Mine, <b>C</b> a craft, <b>·</b> rest. The second row is the zone: T town, H hills, D depths, C caves. ${start && refAlone ? `With the Factory, a character with no skills refines every other turn for <b>${fmt(refAlone.rate)} ¢ a turn</b>. Adding a craft for the off turns lifts that, because a craft costs no fatigue: ${esc(label(bestUnder(params.startingTagPoints, "withFactory")))} reaches ${fmt(start.withFactory.rate)} ¢ at the starting budget. Farming (${fmt(farmAlone?.rate)} ¢ a turn alone) no longer earns a slot next to the Factory, because a farm turn now pays ${fmt(model.activities.find((a) => a.kind === "farm")?.perAction)} ¢ and shares the ladder with Refine.` : ""}</p>
<h4>With the Factory open</h4>
${table({ cols: stepCols("withFactory"), rows: steps("withFactory") })}
<h4>Without it (full, out of reach, or no Godflesh)</h4>
<p class="lede">With Refine off the table, whether because the Factory is full, out of reach, or out of Godflesh, the mixes are worth comparing. ${startNo ? `At the starting budget the best is ${esc(label(startNo))} at ${fmt(startNo.noFactory.rate)} ¢ a turn.` : ""}</p>
${table({ cols: stepCols("noFactory"), rows: steps("noFactory") })}
${barChart({ rows: bars, unit: " ¢", labelW: 330, fmtVal: (v) => fmt(v, 1) })}
<h3>What a starting character (${params.startingTagPoints} points) can reach</h3>
${table({ cols: startCols, rows: startRows })}
${sectionSeats()}
<h3>What this leaves out</h3>
<p class="lede">The plan sells nothing and carries nothing. A refining day is ${cubes} cubes at ${fmt(model.params.squeezeLbs ?? 17, 0)} lb, so ${fmt(lbs, 0)} lb (${fmt(lbs / 2, 0)} lb crated), against a ${params.carryWeightLbs} lb carry cap, and an Overburdened character cannot cross zones at all. Turning cubes into ¢ means a trip to the Depot in Undertown, which is one crossing from both the town and the hills, so a plain walker cannot refine and sell in the same turn without a mount or cart. These figures are a ceiling on Moves, fatigue and skill points, not a wage. Also left out: the 1-in-6 injury on every Godflesh cut, a forge for smithing, seed bags and ⬢ bought at the Depot, and how many other players want the same seat.</p>
</section>`;
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
    { h: "Activity", raw: true, get: nameCell, sort: (a) => a.name },
    { h: "Family", get: (a) => a.family, style: (a) => `border-left:4px solid ${famColor(a.family)}` },
    { h: "Skill", get: (a) => a.skill },
    { h: "Pts", num: true, get: (a) => a.skillPoints },
    { h: "Moves", num: true, get: (a) => fmt(a.moves, 2), sort: (a) => a.moves },
    { h: "Revenue", num: true, get: (a) => fmt(a.revenue), sort: (a) => a.revenue ?? -1 },
    { h: "Inputs", num: true, get: (a) => fmt(a.inputs), sort: (a) => a.inputs },
    { h: "Per action ¢", num: true, get: (a) => fmt(a.perAction), sort: (a) => a.perAction ?? -1e9 },
    { h: "Drops ¢", num: true, get: (a) => (a.dropsPerAction != null ? fmt(a.dropsPerAction, 2) : "—"), sort: (a) => a.dropsPerAction ?? -1 },
    { h: "Presses / turn", num: true, get: (a) => (a.moves === 0 && a.netPerTurnSell == null ? "free" : fmt(a.duty, 2)), sort: (a) => a.duty ?? 0 },
    { h: `¢/turn (⬢ at sell, ${params.rv.sell} ¢)`, num: true, get: (a) => fmt(a.netPerTurnSell), sort: (a) => a.netPerTurnSell ?? -1e9 },
    { h: `¢/turn (⬢ at buy, ${params.rv.buy} ¢)`, num: true, get: (a) => fmt(a.netPerTurnBuy), sort: (a) => a.netPerTurnBuy ?? -1e9 },
    { h: "Notes", get: (a) => a.flags.join("; ") },
  ];
  return `<section><h2>The full table</h2>
<p class="lede">${model.activities.length} activities, with recipes that take the same inputs and pay the same shown as one line (${collapse(allRanked, (a) => (a.kind === "craft" ? sigOfSlug(a) : null)).length} lines). Click a heading to sort. “Per action” is one press; “Presses / turn” is how often the fatigue rules let you press it, and “free” marks actions that cost no Move (Butcher, the Caving Die), which are limited by what you have to work on. “Drops” is the extra loot per press, valued at what the station pays. “Inputs” prices ⬢ at the sell figure and ingredients at their sale price (or purchase price if unsellable).</p>
${table({ cols, rows: collapse(allRanked, (a) => (a.kind === "craft" ? sigOfSlug(a) : null)), filters: [{ label: "Family", get: (a) => a.family }, { label: "Skill", get: (a) => a.skill }] })}</section>`;
}


function sectionFatigue() {
  const f = model.fatigue;
  const cols = [
    { h: "Verb", get: (r) => r.label },
    { h: "Tires you?", get: (r) => (r.tires ? "yes" : "no"), style: (r) => `color:var(--${r.tires ? "bad" : "good"});font-weight:600` },
    { h: "Pressed", num: true, get: (r) => (r.steady >= 0.999 ? "every turn" : `1 in ${fmt(1 / r.steady, 1)}`), sort: (r) => r.steady },
    { h: `Over ${f.gameTurns} turns`, num: true, get: (r) => `${fmt(r.overGame * f.gameTurns, 0)} of ${f.gameTurns}`, sort: (r) => r.overGame },
    { h: "First 14 turns", get: (r) => r.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
    { h: "What the code does", get: (r) => r.mechanism + (r.history ? " History: " + r.history : "") },
    { h: "Read from", get: (r) => r.source },
  ];
  return `<section><h2>Which work tires you</h2>
<p class="lede">The Tired and Exhausted tags each last ${f.durations.tired} turn, and Exhausted turns into Tired when it lapses. This table is a simulation, not a stated number: each turn it asks the game's own gate whether the verb is refused, applies the game's own grant, then runs the turn close in the game's order (staged push, then the tag expiry sweep). █ is a turn you can work, · is a turn you cannot.</p>
${table({ cols, rows: f.rows })}
<p class="lede">Mine, Refine and Farm climb the ladder from a work action. ${f.rows.filter((r) => !r.tires).map((r) => r.label).join(", ")} never read it: the scan below found no reference in their files, so they are limited by the Move alone. The Exhausted tag's own text says “you can't Labor again”, a leftover from Laboring that now means Mine, Refine and Farm.</p>
<p class="lede">Also climbing the ladder, and not modelled because they are chance: a bad night (<code>dawnAfflictionPass.js</code>) and pushing on through a travel gate (<code>locationTravel.js</code>). Every file in the code that reads or writes the ladder:</p>
<p><code>${f.readers.map(esc).join("</code> · <code>")}</code></p></section>`;
}

function sectionDrops() {
  const P = model.producerDrops;
  const union = (a, b) => {
    const map = new Map();
    for (const r of a) map.set(r.slug, { name: r.name, unit: r.unit, priced: r.priced, a: r });
    for (const r of b) map.set(r.slug, { ...(map.get(r.slug) ?? { name: r.name, unit: r.unit, priced: r.priced }), b: r });
    return [...map.values()].sort((x, y) => (y.b?.ev ?? 0) + (y.a?.ev ?? 0) - ((x.b?.ev ?? 0) + (x.a?.ev ?? 0)) || (y.b?.p ?? 0) + (y.a?.p ?? 0) - ((x.b?.p ?? 0) + (x.a?.p ?? 0)));
  };
  const cell = (r, key) => (r?.[key] ? `${fmt(r[key].p * 100, r[key].p < 0.01 ? 2 : 1)}%` : "—");
  const dropCols = (labelA, labelB) => [
    { h: "Item", get: (u) => u.name },
    { h: `${labelA} chance`, num: true, get: (u) => cell(u, "a"), sort: (u) => u.a?.p ?? 0 },
    { h: `${labelB} chance`, num: true, get: (u) => cell(u, "b"), sort: (u) => u.b?.p ?? 0 },
    { h: "Sells ¢", num: true, get: (u) => (u.priced ? u.unit : "no price"), sort: (u) => u.unit },
    { h: `${labelA} ¢`, num: true, get: (u) => fmt(u.a?.ev ?? 0, 2), sort: (u) => u.a?.ev ?? 0 },
    { h: `${labelB} ¢`, num: true, get: (u) => fmt(u.b?.ev ?? 0, 2), sort: (u) => u.b?.ev ?? 0 },
  ];
  const total = (tbl) => tbl.reduce((sum, r) => sum + r.ev, 0);
  const mineRows = model.activities.filter((a) => a.kind === "mine");
  const bars = [];
  for (const a of mineRows) {
    bars.push({ label: `${a.name.replace("Mine — ", "")}: ⬢`, value: a.resourcesPerPress * params.rvMined, color: "var(--c0)" });
    bars.push({ label: `${a.name.replace("Mine — ", "")}: drops`, value: a.dropsPerAction, color: "var(--c1)" });
  }
  const bcols = [
    { h: "What you butcher", get: (r) => r.name },
    { h: "You get", get: (r) => r.outputs.map((o) => `${o.quantity}× ${o.name}${o.priced ? ` (${o.unit} ¢)` : " (unsellable)"}`).join(", ") },
    { h: "Sells ¢", num: true, get: (r) => fmt(r.revenue), sort: (r) => r.revenue },
    { h: "You pay ¢", num: true, get: (r) => fmt(r.inputs), sort: (r) => r.inputs },
    { h: "Net ¢", num: true, get: (r) => fmt(r.revenue - r.inputs), sort: (r) => r.revenue - r.inputs },
  ];
  return `<section><h2>What a producer's action also drops</h2>
<p class="lede">The pay in the tables above already includes these drops. They are sampled from the game's own loot functions (300,000 draws under a fixed seed), and valued at what the station pays. An item the station will not buy counts as 0, so every total here is a floor: ores sell for 1 ¢ raw but are worth far more to a smith.</p>
<h3>Mining: per press</h3>
<p class="lede">Anybody holding a pickaxe gets ⬢ and one draw on this table for a press. Prospecting multiplies the ⬢ by ${params.prospectingMultiplier} and moves the draw to a richer column. The Caves and Depths are the only places with a column, and the base yield is ${params.miningBase.min}–${params.miningBase.max} at a coefficient of 1 before the ${fmt(params.productionCoefficient, 1)} dial and the pickaxe's +${params.pickaxe.bonus}.</p>
${barChart({ rows: bars, unit: " ¢", labelW: 300, fmtVal: (v) => fmt(v, 1) })}
<h4>A pickaxe and nothing else</h4>
${table({ cols: dropCols("Caves", "Depths"), rows: union(P.prospecting.caves.plain, P.prospecting.depths.plain).slice(0, 12) })}
<p class="lede">Total drops per press: Caves ${fmt(total(P.prospecting.caves.plain), 2)} ¢, Depths ${fmt(total(P.prospecting.depths.plain), 2)} ¢.</p>
<h4>With Prospecting</h4>
${table({ cols: dropCols("Caves", "Depths"), rows: union(P.prospecting.caves.skilled, P.prospecting.depths.skilled).slice(0, 12) })}
<p class="lede">Total drops per press: Caves ${fmt(total(P.prospecting.caves.skilled), 2)} ¢, Depths ${fmt(total(P.prospecting.depths.skilled), 2)} ¢.</p>
<h3>The Caving Die: per arrival</h3>
<p class="lede">Walking into a cave Location rolls a die: a 6 finds something (1 in 6), a 1 is trouble. It costs no Move and needs no skill.</p>
${table({ cols: dropCols("Caves", "Depths"), rows: union(P.caving.caves, P.caving.depths).slice(0, 12) })}
<p class="lede">Expected loot per arrival: Caves ${fmt(total(P.caving.caves), 2)} ¢, Depths ${fmt(total(P.caving.depths), 2)} ¢.</p>
<h3>Butchering</h3>
<p class="lede">Butcher costs no Move and consumes the body. The catch is the input: a corpse, or a live animal you had to buy or raise.</p>
${table({ cols: bcols, rows: P.butcher })}
</section>`;
}

function sectionSpecial() {
  const S = model.sources;
  const rankBars = [
    ...[0, 1, 2, 3, 4, 5].map((k) => ({
      label: k === 0 ? "No special item" : RANK.find((x) => x.id === k).label,
      value: S.summary.byHardest[k],
      color: `var(--r${k})`,
    })),
    { label: "Copy a key you hold", value: S.summary.copies, color: "var(--mute)" },
  ];
  const topItems = S.items.slice(0, 16).map((i) => ({ label: `${i.name}`, value: i.recipeCount, color: `var(--r${i.rank})` }));
  const legendHtml = RANK.map((r) => `<li>${rankChip(r.id)} ${esc(r.meaning)}</li>`).join("");

  const itemCols = [
    { h: "Item", get: (i) => i.name },
    { h: "Easiest route", get: (i) => rankChip(i.rank), raw: true, sort: (i) => i.rank },
    { h: "Recipes", num: true, get: (i) => i.recipeCount },
    { h: "How you get it", get: (i) => i.best },
    { h: "Other ways", get: (i) => i.routes.slice(1, 4).join(" · ") },
    { h: "Buy ¢", num: true, get: (i) => i.buy ?? "—", sort: (i) => i.buy ?? -1 },
    { h: "Sell ¢", num: true, get: (i) => i.sell ?? "—", sort: (i) => i.sell ?? -1 },
    { h: "Needed by", get: (i) => `${i.recipes.slice(0, 4).join(", ")}${i.recipes.length > 4 ? ", …" : ""}` },
  ];
  const recCols = [
    { h: "Recipe", raw: true, get: nameCell, sort: (r) => r.name },
    { h: "Skill", get: (r) => r.skill },
    { h: "Moves", num: true, get: (r) => fmt(r.moves, 2), sort: (r) => r.moves },
    { h: "⬢", num: true, get: (r) => r.resourceCost },
    {
      h: "Special items",
      raw: true,
      get: (r) =>
        r.items.length || r.workshop
          ? [...r.items.map((i) => `${esc(i.label)} ${rankChip(i.rank)}`), ...(r.workshop ? [`Workshop Equipment ${rankChip(S.items.find((x) => x.slug === "workshop-equipment")?.rank ?? 5)}`] : [])].join("<br>")
          : "—",
      sort: (r) => r.items.length + (r.workshop ? 1 : 0),
    },
    { h: "Hardest gate", raw: true, get: (r) => rankChip(r.hardest), sort: (r) => r.hardest },
    { h: "Hardest item", get: (r) => r.hardestItem ?? "—" },
    { h: "Notes", get: (r) => [r.copy ? "copies something you already hold" : "", r.secretRecipe ? "secret recipe" : "", r.hiddenUntilHeld ? "hidden until you hold an ingredient" : ""].filter(Boolean).join("; ") },
  ];
  return `<section><h2>What each recipe needs, and where it comes from</h2>
<p class="lede">${S.summary.special} of ${S.summary.recipes} craftable recipes need something beyond ⬢ and a skill: a spent ingredient, a kept one (a tool or a corpse), or Workshop Equipment nearby. Each item is ranked by its easiest route, and a recipe is as hard as its hardest item. ${S.summary.copies} recipes are key copies: they need the key itself, kept, so they are counted apart.</p>
<ul class="ranks">${legendHtml}</ul>
<h3>Recipes by hardest gate</h3>
${barChart({ rows: rankBars, unit: " recipes", fmtVal: (v) => fmt(v, 0), labelW: 150 })}
<h3>The items most recipes depend on</h3>
${barChart({ rows: topItems, unit: " recipes", fmtVal: (v) => fmt(v, 0), labelW: 190 })}
<h3>Where each item comes from</h3>
<p class="lede">${S.items.length} distinct special items. Routes are read from the Depot catalog, the loot functions, role starting kits, room stashes, butchering rules, the farm and Factory, and any tag that opens into another. “Named in code” means the data has no route but the source mentions the item.</p>
${table({ cols: itemCols, rows: S.items, filters: [{ label: "Easiest route", get: (i) => RANK.find((x) => x.id === i.rank)?.label }, { label: "Way in", get: (i) => i.routeKinds[0] ?? "none" }] })}
<h3>Every recipe</h3>
<p class="lede">Recipes with the same skill, Moves, ⬢, items, equipment and sell price are one line, so ${S.recipes.length} recipes show as ${collapse(S.recipes, sigOfRecipe).length}. Hover “+N more” for the rest.</p>
${table({ cols: recCols, rows: collapse([...S.recipes].sort((a, b) => b.hardest - a.hardest || a.name.localeCompare(b.name)), sigOfRecipe), filters: [{ label: "Skill", get: (r) => r.skill }, { label: "Hardest gate", get: (r) => (r.hardest === 0 ? "none" : RANK.find((x) => x.id === r.hardest)?.label) }, { label: "Forge", get: (r) => (r.workshop ? "needs one" : "no") }, { label: "Key copy", get: (r) => (r.copy ? "yes" : "no") }] })}</section>`;
}

function sectionBalance() {
  const cols = [
    { h: "Family", get: (r) => r.family },
    { h: "Recipes", num: true, get: (r) => r.recipes },
    { h: "Median ⬢ burned / turn", num: true, get: (r) => fmt(r.medianBurn) },
    { h: "Heaviest recipe", num: true, get: (r) => fmt(r.maxBurn) },
    { h: "Prospectors per crafter", num: true, get: (r) => fmt(r.minersPerCrafter, 1), sort: (r) => r.minersPerCrafter },
    ...(params.obolFamilies.length ? [{ h: "Can pay in obols?", get: (r) => (r.payInObols ? "yes, 1 for 1" : "no: must hold ⬢") }] : []),
    { h: "Most it will pay for a ⬢", num: true, get: (r) => `${fmt(r.ceiling, 0)} ¢`, sort: (r) => r.ceiling },
  ];
  const pcols = [
    { h: "Prospector at", get: (p) => p.name },
    { h: "⬢ / turn", num: true, get: (p) => fmt(p.resourcesPerTurn, 2) },
    { h: "Drops ¢ / turn", num: true, get: (p) => fmt(p.dropsPerTurn, 2) },
    { h: `Bartered at ${fmt(params.rv.mid, 1)} ¢${params.minedValue === "mid" ? " (headline)" : ""}`, num: true, get: (p) => fmt(p.atMid), sort: (p) => p.atMid },
    { h: `Sold back at ${params.rv.sell} ¢`, num: true, get: (p) => fmt(p.atSell), sort: (p) => p.atSell },
    ...(params.obolFamilies.length ? [{ h: `Paid to a smith (${params.rv.sell} ¢ a ⬢)`, num: true, get: (p) => fmt(p.atSmith), sort: (p) => p.atSmith }] : []),
    { h: `⬢ at the Depot's ${params.rv.buy} ¢`, num: true, get: (p) => fmt(p.atBuy), sort: (p) => p.atBuy },
  ];
  return `<section><h2>The ⬢ market</h2>
<p class="lede">Mining is the only faucet, and recipes are the sink. A Prospector at the Caves brings in ${fmt(params.minerResourcesPerTurn)} ⬢ a turn (the ${fmt(params.productionCoefficient, 1)} production dial, the base range and the every-other-turn fatigue). Between players a ⬢ should change hands somewhere between the Depot's ${params.rv.sell} ¢ sell-back and its ${params.rv.buy} ¢ import price, so the headline figures for a Prospector value theirs at the midpoint, <b>${fmt(params.rv.mid, 1)} ¢</b>${params.minedValue === "mid" ? "" : ` (this run uses ${fmt(params.rvMined, 1)} ¢ instead)`}. ${params.obolFamilies.length ? `Who will actually pay for it depends on who can use obols instead. The Depot imports ⬢ at ${params.rv.buy} ¢ and buys them back at ${params.rv.sell} ¢, so a buyer who must hold real ⬢ will pay up to ${params.rv.buy} ¢, but <b>a smith can put one obol toward one ⬢</b> (<code>resolveObolSpend</code>, smithing only), so a smith will pay no more than ${params.rv.sell} ¢ and never has to import at all.` : `Every crafter must hold real ⬢ (no craft can be paid in obols), so the Depot's ${params.rv.buy} ¢ import price is the most any of them will pay a Prospector, and its ${params.rv.sell} ¢ sell-back is the least a Prospector will take.`}</p>
<h3>What a Prospector is worth</h3>
${table({ cols: pcols, rows: model.prospectorValue })}
<h3>Who needs ⬢</h3>
<p class="lede">“Prospectors per crafter” is how many Prospectors one crafter of that family needs behind them, working flat out. Gambit-free, median recipe. ${params.obolFamilies.length ? `Brewing, crafting and cooking cannot pay in obols, so they are the buyers who would pay the full ${params.rv.buy} ¢.` : `Nobody can pay in obols, so every family would pay up to the full ${params.rv.buy} ¢.`}</p>
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
${table({ cols, rows: model.priceLadder, filters: [{ label: "Shelf", get: (r) => r.manifest }] })}</section>`;
}

function sectionFood() {
  const supply = model.foodSupply.map((f) => ({
    label: f.crop,
    value: f.farmersNeeded,
    color: "var(--c3)",
  }));
  const floor = model.foodFloor;
  const box = floor.anyone;
  // Two markets: what anybody with coin can order from the Depot, and what a grower would be paid.
  const fromDepot = model.foods
    .filter((f) => f.shelf && f.costPerPersonTurn != null)
    .map((f) => ({ label: `${f.name}${f.shelf === "general" ? " (anyone)" : " (Merchant's shelf)"}`, value: f.costPerPersonTurn, color: f.shelf === "general" ? "var(--c3)" : "var(--c1)" }));
  const fromGrowers = model.foods
    .filter((f) => !f.shelf && f.costPerPersonTurn != null)
    .slice(0, 14)
    .map((f) => ({ label: f.name, value: f.costPerPersonTurn, color: "var(--c0)" }));
  const cols = [
    { h: "Food", get: (f) => f.name },
    { h: "Kind", get: (f) => f.kind },
    { h: "Where to get it", get: (f) => f.source },
    { h: "Hunger", num: true, get: (f) => f.hunger, sort: (f) => f.hunger },
    { h: "Mood", num: true, get: (f) => f.mood, sort: (f) => f.mood },
    { h: "Weight lb", num: true, get: (f) => fmt(f.weight, 1), sort: (f) => f.weight },
    { h: "Buy ¢", num: true, get: (f) => f.buy ?? "—", sort: (f) => f.buy ?? -1 },
    { h: "Sell ¢", num: true, get: (f) => f.sell ?? "—", sort: (f) => f.sell ?? -1 },
    { h: "Priced at", get: (f) => (f.costPerPersonTurn == null ? "—" : f.basis === "buy" ? "the Depot's price" : "what the counter pays a grower") },
    { h: "¢ per person-turn", num: true, get: (f) => fmt(f.costPerPersonTurn, 2), sort: (f) => f.costPerPersonTurn ?? 1e9 },
    { h: "lb per person-turn", num: true, get: (f) => fmt(f.lbPerPersonTurn, 2), sort: (f) => f.lbPerPersonTurn },
  ];
  const sup = model.foodSupply
    .map(
      (f) =>
        `<tr><td>${esc(f.crop)}</td><td class="num">${fmt(f.harvest, 1)}</td><td class="num">${fmt(f.personTurnsPerFarm, 0)}</td><td class="num">${fmt(f.lbPerFarm, 1)}</td><td class="num">${fmt(f.farmersNeeded, 1)}</td></tr>`,
    )
    .join("");
  const crop = model.foods.find((f) => f.slug === "potato");
  return `<section><h2>Food</h2>
<p class="lede">A person burns ${params.hungerDecay} hunger a turn, so a food that restores 12 feeds them for about a third of a turn (${fmt(12 / params.hungerDecay, 2)} of one). One Farm action sows up to ${params.farmMaxCrops} plants and about 1 in ${params.witherIn} wither. It locks you out for ${params.farmCycle} turns in all.</p>
<h3>Farmers needed to feed ${players} players</h3>
${barChart({ rows: supply, unit: " farmers", fmtVal: (v) => fmt(v, 0) })}
<div class="tablewrap"><table><thead><tr><th>Crop</th><th class="num">Harvest / farm</th><th class="num">Person-turns / farm</th><th class="num">lb / farm</th><th class="num">Farmers needed</th></tr></thead><tbody>${sup}</tbody></table></div>
<h3>What food costs somebody with coin</h3>
<p class="lede">${box ? `The only food anyone can order without a licence is the <b>${esc(box.name)}</b>, ${box.buy} ¢ on the Depot's general shelf. It opens into one of ${floor.outcomes} equally likely outcomes (${floor.draws} draws, including a rat that half the time makes you sick, plus a chance of nothing), so it restores <b>${fmt(box.hunger, 1)} hunger on average</b> and costs <b>${fmt(box.costPerPersonTurn, 2)} ¢ a person-turn</b>, with an average mood of ${fmt(box.mood, 1)}. That is the cost of staying fed for anybody who can reach the counter, and it is small next to any wage in this report.` : ""}</p>
<p class="lede">${box && crop ? `It also sets a ceiling on what food is worth. Nobody should pay a grower more than the box charges for the same hunger, and the box charges ${fmt(floor.ceilingPerHunger * 100, 1)} ¢ per 100 hunger, so a ${crop.hunger}-hunger crop is worth at most about ${fmt(floor.ceilingPerHunger * crop.hunger, 2)} ¢ to a buyer. Crops sell to the counter for ${crop.sell} ¢, so a grower selling to another player has almost no room above the counter's price. That is why farming is for eating.` : ""}</p>
${barChart({ rows: fromDepot, unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 250 })}
<h3>What growers and cooks make it for</h3>
<p class="lede">Not sold at the Depot, so these are priced at what the counter pays a grower (their opportunity cost), and a buyer would be asked a little more. Dishes show the recipe’s own restore only; extra ingredients add more.</p>
${barChart({ rows: fromGrowers, unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 190 })}
<h3>Every food</h3>
<p class="lede">${(() => {
    const t = model.foodTiers;
    const tiers = ["raw", "basic", "skilled"].map((k) => `${t.counts[k]} ${k} (${Math.round(t.bands[k][0] * params.hungerDecay)}–${Math.round(t.bands[k][1] * params.hungerDecay)} hunger)`).join(", ");
    const bad = [
      t.offTier.length ? `<b>${t.offTier.length} outside every tier</b>: ${t.offTier.map((f) => `${esc(f.name)} (${f.hunger})`).join(", ")}` : "",
      t.defaulted.length ? `<b>${t.defaulted.length} with no hunger figure of their own</b>, riding on the flat ${model.params?.defaultFoodHunger ?? 12}: ${t.defaulted.map((f) => esc(f.name)).join(", ")}` : "",
    ].filter(Boolean);
    return `Against a decay of ${params.hungerDecay}, the foods fall into the tiers <code>TURN-ENGINE.md</code> §5 describes: ${tiers}, plus the Ration Box and its draws. ${bad.length ? `A change to the decay or to a food that leaves one behind shows up here: ${bad.join("; ")}.` : "None sit outside a tier and none ride on the default, and the claims table fails if that stops being true."}`;
  })()}</p>
<p class="lede">${model.foods.length} foods. A food counts if the game restores hunger for it (its own value, or the flat ${model.params?.defaultFoodHunger ?? 12} for anything that just grants a meal), and a thing that opens into food is averaged over what it can turn out.</p>
${table({ cols, rows: model.foods, filters: [{ label: "Where", get: (f) => f.source }, { label: "Kind", get: (f) => f.kind }] })}</section>`;
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
${table({ cols, rows: model.claims, sortable: false, filters: [{ label: "Doc", get: (c) => c.doc.split(" §")[0] }, { label: "Status", get: (c) => (c.ok ? "matches" : "differs") }] })}
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
--r0:#8a857a;--r1:#2c7a3f;--r2:#1f6f8b;--r3:#c98a1b;--r4:#b0342c;--r5:#5a2a2a;--mono:ui-monospace,Menlo,monospace;--c0:#1f6f8b;--c1:#c98a1b;--c2:#7b4b94;--c3:#4a8a3f;--c4:#b0342c;--c5:#2a2a2a;--c6:#0f8b8d;--c7:#d16ba5;--c8:#8a6d3b;--c9:#5b6cc0}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece7dc;--mute:#a49e91;--card:#1e1c19;--line:#3a3630;--accent:#e0645a;--good:#6cc27f;--bad:#e0645a;
--r0:#8a857a;--r1:#6cc27f;--r2:#5fb4d0;--r3:#e6b04a;--r4:#e0645a;--r5:#c98a8a;--c0:#5fb4d0;--c1:#e6b04a;--c2:#b58fce;--c3:#84c477;--c4:#e0645a;--c5:#cfcabe;--c6:#52c0c2;--c7:#e59bc4;--c8:#c9a96b;--c9:#8e9ce0}}
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
.filterbar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:8px 0 2px;font-size:13px}.filterbar select,.filterbar input{font:inherit;padding:3px 6px;border:1px solid var(--line);border-radius:4px;background:var(--card);color:var(--fg)}.filterbar .count{color:var(--mute)}tr[hidden]{display:none}
.mono{font-family:var(--mono)}
.rk{display:inline-block;padding:0 7px;border-radius:9px;font-size:11px;font-weight:600;color:var(--bg);background:var(--r0);white-space:nowrap}
.rk.r1{background:var(--r1)}.rk.r2{background:var(--r2)}.rk.r3{background:var(--r3)}.rk.r4{background:var(--r4)}.rk.r5{background:var(--r5)}
.via{color:var(--mute);font-size:11px}
.hid{display:none}
.ranks{list-style:none;padding:0;margin:0 0 8px;font-size:13px}.ranks li{margin:3px 0}
`;
const js = `
document.querySelectorAll('.filterbar').forEach(bar=>{
  const t=document.getElementById(bar.dataset.for), sels=[...bar.querySelectorAll('select')], q=bar.querySelector('input'), count=bar.querySelector('.count');
  const apply=()=>{const needle=q.value.trim().toLowerCase();let shown=0;const rows=[...t.tBodies[0].rows];
    rows.forEach(tr=>{let ok=sels.every((sel,i)=>sel.value===''||tr.dataset['f'+i]===sel.value);
      if(ok&&needle)ok=tr.textContent.toLowerCase().includes(needle);tr.hidden=!ok;if(ok)shown++;});
    count.textContent=shown+' of '+rows.length;};
  sels.forEach(x=>x.addEventListener('change',apply));q.addEventListener('input',apply);apply();
});
document.querySelectorAll('table.sortable').forEach(t=>{
  t.querySelectorAll('th').forEach(th=>th.addEventListener('click',()=>{
    const i=+th.dataset.i,asc=!th.classList.contains('sort-asc');
    t.querySelectorAll('th').forEach(x=>x.classList.remove('sort-asc','sort-desc'));
    th.classList.add(asc?'sort-asc':'sort-desc');
    const rows=[...t.tBodies[0].rows];
    rows.sort((a,b)=>{const x=a.cells[i].dataset.v??a.cells[i].textContent,y=b.cells[i].dataset.v??b.cells[i].textContent,nx=parseFloat(x),ny=parseFloat(y);
      const r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return asc?r:-r});
    rows.forEach(r=>t.tBodies[0].appendChild(r));
  }));
});`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bascinet economy</title><style>${css}</style></head><body><main>
<h1>Bascinet economy</h1>
<p class="sub">Generated from commit ${esc(commit)} · ${players} players · ${model.counts.tags} tags, ${model.counts.craftable} craftable · <code>npm run economy:report</code></p>
<section><h2>The short version</h2><ul class="head">${headlines.map((h) => `<li>${h}</li>`).join("")}</ul></section>
${sectionWages()}${sectionBaselines()}${sectionInvestments()}${sectionCombos()}${sectionSpread()}${sectionFatigue()}${sectionDrops()}${sectionCaving()}${sectionLucky()}${sectionTrinkets()}${sectionCooking()}${sectionDesires()}${sectionBalance()}${sectionActivities()}${sectionSpecial()}${sectionLadder()}${sectionFood()}${sectionChecks()}${sectionAssumptions()}
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
  "## Baselines: the easy crafts (⬢ bought at the Depot)",
  "",
  "| Role | Recipe | Points | ¢/turn bought | ¢/turn mined |",
  "|---|---|---:|---:|---:|",
  ...model.baselines.map((b) => `| ${b.role} | ${b.key.split(": ")[1]} | ${b.skillPoints} | ${fmt(b.value)} | ${fmt(b.valueMined)} |`),
  "",
  "## Combined activities",
  "",
  "| Skills | Points | With the Factory | Without it |",
  "|---|---:|---:|---:|",
  ...model.combos.loadouts.filter((l) => l.points <= 8).sort((x, y) => y.withFactory.rate - x.withFactory.rate).filter((l, i, a) => a.findIndex((x) => x.skills.join() === l.skills.join()) === i).slice(0, 8).map((l) => `| ${l.skills.join(" + ")} | ${l.points} | ${fmt(l.withFactory.rate)} | ${fmt(l.noFactory.rate)} |`),
  "",
  "## Which work tires you",
  "",
  "| Verb | Tires you? | Pressed |",
  "|---|---|---|",
  ...model.fatigue.rows.map((r) => `| ${r.label} | ${r.tires ? "yes" : "no"} | ${r.steady >= 0.999 ? "every turn" : `1 in ${fmt(1 / r.steady, 1)}`} |`),
  "",
  "## Recipes by hardest gate",
  "",
  "| Gate | Recipes |",
  "|---|---:|",
  ...[0, 1, 2, 3, 4, 5].map((k) => `| ${k === 0 ? "No special item" : model.sources.ranks.find((x) => x.id === k).label} | ${model.sources.summary.byHardest[k]} |`),
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
  ["id", "name", "family", "skill", "skillPoints", "moves", "revenue", "inputs", "netPerTurnSell", "netPerTurnBuy", "flags"].join(","),
  ...ranked.map((a) =>
    [a.id, a.name, a.family, a.skill, a.skillPoints, a.moves, a.revenue, a.inputs, money(a), a.netPerTurnBuy, a.flags.join("; ")]
      .map(csvCell)
      .join(","),
  ),
].join("\n");

const S = model.sources;
const recipesCsv = [
  ["slug", "name", "skill", "moves", "resourceCost", "specialItems", "workshop", "hardestRank", "hardestLabel", "hardestItem", "secretRecipe", "hiddenUntilHeld", "keyCopy"].join(","),
  ...S.recipes.map((r) =>
    [
      r.slug, r.name, r.skill, r.moves, r.resourceCost,
      r.items.map((i) => `${i.label} [${i.rank}]`).join("; "),
      r.workshop, r.hardest, r.hardest === 0 ? "none" : S.ranks.find((x) => x.id === r.hardest).label, r.hardestItem ?? "", r.secretRecipe, r.hiddenUntilHeld, r.copy,
    ].map(csvCell).join(","),
  ),
].join("\n");
const itemsCsv = [
  ["slug", "name", "rank", "rankLabel", "recipeCount", "bestRoute", "allRoutes", "buy", "sell", "recipes"].join(","),
  ...S.items.map((i) =>
    [i.slug, i.name, i.rank, S.ranks.find((x) => x.id === i.rank).label, i.recipeCount, i.best, i.routes.join(" | "), i.buy, i.sell, i.recipes.join("; ")].map(csvCell).join(","),
  ),
].join("\n");

const combosCsv = [
  ["skills", "points", "craft", "rateWithFactory", "totalWithFactory", "scheduleWithFactory", "rateNoFactory", "totalNoFactory", "scheduleNoFactory"].join(","),
  ...model.combos.loadouts.map((l) =>
    [l.skills.join(" + "), l.points, l.craft?.name ?? "", l.withFactory.rate.toFixed(2), l.withFactory.total.toFixed(0), l.withFactory.pattern, l.noFactory.rate.toFixed(2), l.noFactory.total.toFixed(0), l.noFactory.pattern].map(csvCell).join(","),
  ),
].join("\n");
fs.mkdirSync(outDir, { recursive: true });
const investmentsCsv = [
  ["group", "name", "kind", "coin", "moves", "allIn", "points", "gainPerTurn", "paybackTurns", "netOverGame", "perPoint", "does", "cost", "how", "note"].join(","),
  ...model.investments.rows.map((r) =>
    [r.group, r.name, r.kind, r.coin, r.moves, r.allIn, r.points, r.gain ?? "", r.paybackTurns ?? "", r.netOverGame ?? "", r.perPoint ?? "", r.does, r.coinHow, r.gainHow ?? "", r.note ?? ""].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "investments.csv"), investmentsCsv);
const cavingCsv = [
  ["item", "tier", "worth", "basis", "cavesPerArrival", "depthsPerArrival", "cavesEvPerArrival", "depthsEvPerArrival"].join(","),
  ...(() => {
    const by = (z) => new Map(model.caving.zones[z].rows.map((r) => [r.slug, r]));
    const c = by("caves");
    const d = by("depths");
    return [...new Set([...c.keys(), ...d.keys()])].map((slug) => {
      const a = c.get(slug) ?? d.get(slug);
      return [a.name, a.tier, a.value, a.basis, c.get(slug)?.pArrival ?? 0, d.get(slug)?.pArrival ?? 0, c.get(slug)?.evArrival ?? 0, d.get(slug)?.evArrival ?? 0].map(csvCell).join(",");
    });
  })(),
].join("\n");
fs.writeFileSync(path.join(outDir, "caving.csv"), cavingCsv);
const trinketsCsv = [
  ["kind", "name", "detail", "sells", "shelf", "inlay", "ruleSays", "apprenticeProfit", "skilledProfit", "skilledLuckyProfit"].join(","),
  ...model.trinkets.stones.map((r) => ["stone", r.name, r.group, r.sold, r.shelf ?? "", r.inlay, r.expected ?? "", "", "", ""].map(csvCell).join(",")),
  ...[...model.trinkets.combos.bestOwn.map((c) => ({ ...c, kind: "own stones" })), ...model.trinkets.combos.bestShelf.map((c) => ({ ...c, kind: "shelf stones" }))].map((c) =>
    [c.kind, c.stones.join(" + ") || "none", c.stoneCost, "", "", c.inlay, "", c.apprentice, c.skilled, c["skilled-lucky"]].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "trinkets.csv"), trinketsCsv);
fs.writeFileSync(path.join(outDir, "combos.csv"), combosCsv);
fs.writeFileSync(path.join(outDir, "recipes.csv"), recipesCsv);
fs.writeFileSync(path.join(outDir, "item-sources.csv"), itemsCsv);
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, "report.md"), md);
fs.writeFileSync(path.join(outDir, "activities.csv"), csv);
fs.writeFileSync(path.join(outDir, "model.json"), JSON.stringify(model, null, 2));
console.log(`economy report -> ${path.join(outDir, "index.html")}`);
console.log(`  ${model.activities.length} activities, ${model.priceLadder.length} priced wares, ${model.foods.length} foods`);
console.log(`  ${failing.length} of ${model.claims.length} doc figures differ from the model`);
console.log(`  ${S.summary.special} of ${S.summary.recipes} recipes need a special item; ${S.items.length} distinct items sourced`);
