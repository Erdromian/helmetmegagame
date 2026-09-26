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
//   npm run economy:report -- --mood-weight 1 # weigh a point of mood the same as hunger (default: 1.5)
//   npm run economy:report -- --point-value 6 # try another ¢-a-point scale for gear (default: 7, the rule in TAGS.md §4a)
//   npm run economy:report -- --sell-tax 25   # the Meister's sell tax, a whole percent (default: Depot.sellTaxRate's schema default)
//   npm run economy:report -- --turn-hours 8  # a shorter turn (6/8/12/24; default 24 — Turn.turnLengthHours is a live per-game setting this report has no game to read)
//   npm run economy:report -- --out /tmp/x    # somewhere else
//   npm run economy:report -- --diff          # regenerate, print what moved against the current economy-report/, then replace it
//   npm run economy:report -- --diff-only     # the same, but leave economy-report/ as it was
//
// Read-only: touches no database and posts nothing. The output directory is
// gitignored on purpose — a report checked in is a second copy of the numbers,
// which is exactly the drift this exists to prevent. Regenerate it instead.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { buildModel } = require("./model");
const { median } = require("./stats");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const REPO = path.resolve(__dirname, "../../../..");
// --diff writes to a temp directory, compares it with the real one, then (unless --diff-only) copies it over.
const finalDir = path.resolve(flag("out", path.join(REPO, "economy-report")));
const diffMode = args.includes("--diff-only") ? "only" : args.includes("--diff") ? "copy" : null;
const outDir = diffMode ? fs.mkdtempSync(path.join(require("os").tmpdir(), "economy-diff-")) : finalDir;
const players = Number(flag("players", 100));
const gameTurns = Number(flag("turns", 30));
const freeMoves = flag("free-moves", null) == null ? null : Number(flag("free-moves", null));
const resourceValue = flag("resource-value", "buy");
const minedValue = flag("mined-value", "mid");
const obolPath = flag("obols", "auto");
const moveValueFlag = flag("move-value", null) == null ? null : Number(flag("move-value", null));
const moodWeight = Number(flag("mood-weight", 1.5));
const pointValue = flag("point-value", null) == null ? null : Number(flag("point-value", null));
const sellTax = flag("sell-tax", null) == null ? null : Number(flag("sell-tax", null));
const turnHours = flag("turn-hours", null) == null ? null : Number(flag("turn-hours", null));

const model = buildModel({ players, gameTurns, freeMoves, resourceValue, minedValue, obolPath, moveValue: moveValueFlag, moodWeight, pointValue, sellTax, turnHours });
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

// A row may carry a second figure (`value2`, named by `label2`): it is drawn as a lighter, thinner bar under the
// first, inside the same row, so a pair reads as one line.
//
// `scale` is "linear", "log" or "auto" (the default). Auto picks the log scale whenever the largest bar is more than
// LOG_SCALE_RATIO times the median bar, so one outlier cannot flatten the rest. A log bar is sized by
// log10(1 + value) and still prints the real value, with light ticks at 1, 10, 100, … and a "log scale" note.
const LOG_SCALE_RATIO = 20;
function barChart({ rows, unit = "", width = 720, max = null, labelW = 200, fmtVal = (v) => fmt(v, 1), scale = "auto" }) {
  // The label column grows to fit the longest label (about 6.3 px a character at the 12 px label size), up to
  // a bit over half the chart, so a long occupation name is not cut off at the left edge of the viewBox.
  const longest = Math.max(0, ...rows.map((r) => String(r.label ?? "").length));
  labelW = Math.max(labelW, Math.min(Math.round(width * 0.55), Math.ceil(longest * 6.3) + 16));
  const rowH = 26;
  const pairH = 38;
  const top = 6;
  const hi = max ?? Math.max(...rows.flatMap((r) => [r.value, r.value2 ?? -Infinity]), 1);
  const positive = rows.flatMap((r) => [r.value, r.value2]).filter((v) => Number.isFinite(v) && v > 0);
  const mid = median(positive);
  const log = scale === "log" || (scale === "auto" && positive.length >= 3 && mid > 0 && Math.max(...positive) > LOG_SCALE_RATIO * mid);
  const size = (v) => (log ? Math.log10(1 + Math.max(v, 0)) : Math.max(v, 0));
  const plotW = width - labelW - 70;
  const wOf = (v) => Math.max(1, (size(v) / (size(hi) || 1)) * plotW);
  let y = top;
  const bars = rows
    .map((r) => {
      const paired = r.value2 != null;
      const w = wOf(r.value);
      const barH = paired ? 14 : rowH - 8;
      let out = `<text x="${labelW - 8}" y="${y + (paired ? 19 : 17)}" text-anchor="end" class="lbl">${esc(r.label)}</text>
<rect x="${labelW}" y="${y + 3}" width="${w}" height="${barH}" rx="2" style="fill:${r.color ?? "var(--c0)"}" tabindex="0" data-tip="${esc(r.tip ?? r.label)}: ${fmtVal(r.value)}${unit}"></rect>
<text x="${labelW + w + 6}" y="${y + (paired ? 14 : 17)}" class="val">${fmtVal(r.value)}${unit}</text>`;
      if (paired) {
        const w2 = wOf(r.value2);
        out += `
<rect x="${labelW}" y="${y + barH + 5}" width="${w2}" height="10" rx="2" style="fill:${r.color2 ?? r.color ?? "var(--c0)"}" fill-opacity=".45" tabindex="0" data-tip="${esc(r.tip ?? r.label)}, ${esc(r.label2 ?? "")}: ${fmtVal(r.value2)}${unit}"></rect>
<text x="${labelW + w2 + 6}" y="${y + barH + 14}" class="val">${fmtVal(r.value2)}${unit}${r.label2 ? ` ${esc(r.label2)}` : ""}</text>`;
      }
      y += paired ? pairH : rowH;
      return out;
    })
    .join("");
  let ticks = "";
  if (log) {
    const marks = [1, 10, 100, 1000, 10000].filter((t) => t <= hi);
    ticks =
      marks.map((t) => `<line x1="${labelW + wOf(t)}" x2="${labelW + wOf(t)}" y1="${top}" y2="${y}" class="grid"/><text x="${labelW + wOf(t)}" y="${y + 14}" text-anchor="middle" class="tick">${t}</text>`).join("") +
      `<text x="${width - 4}" y="${y + 14}" text-anchor="end" class="tick">log scale</text>`;
    y += 20;
  }
  const h = y + 6;
  return `<svg viewBox="0 0 ${width} ${h}" role="img" class="chart">${ticks}${bars}</svg>`;
}

// A few series over shared x positions, each drawn as a connected line with its points marked. `xLabels` names
// the x positions in order; every series gives a y for each.
function lineChart({ series, xLabels, width = 720, height = 300, xTitle = "", yTitle = "", fmtVal = (v) => fmt(v, 0) }) {
  const m = { l: 56, r: 110, t: 14, b: 40 };
  const ys = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys) * 1.05 || 1;
  const X = (i) => m.l + (xLabels.length === 1 ? 0 : (i / (xLabels.length - 1)) * (width - m.l - m.r));
  const Y = (v) => height - m.b - ((v - lo) / (hi - lo || 1)) * (height - m.t - m.b);
  const gy = niceTicks(lo, hi, 5)
    .map((v) => `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const gx = xLabels.map((l, i) => `<text x="${X(i)}" y="${height - m.b + 16}" text-anchor="middle" class="tick">${esc(l)}</text>`).join("");
  const lines = series
    .map((s) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${X(i)} ${Y(v)}`).join("");
      const dots = s.values.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" style="fill:${s.color}" tabindex="0" data-tip="${esc(s.label)}, ${esc(xLabels[i])}: ${fmtVal(v)}"></circle>`).join("");
      const last = s.values.length - 1;
      return `<path d="${d}" style="fill:none;stroke:${s.color}" stroke-width="2"/>${dots}<text x="${X(last) + 8}" y="${Y(s.values[last]) + 4}" class="lbl">${esc(s.label)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="chart">${gy}${gx}<text x="${(width + m.l - m.r) / 2}" y="${height - 4}" text-anchor="middle" class="tick">${esc(xTitle)}</text><text transform="translate(12 ${height / 2}) rotate(-90)" text-anchor="middle" class="tick">${esc(yTitle)}</text>${lines}</svg>`;
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
            `<circle cx="${x(p.value)}" cy="${y + rowH / 2 - 4}" r="4.5" style="fill:${famColor(g.family)}" fill-opacity=".55" stroke="${famColor(g.family)}" tabindex="0" data-tip="${esc(p.label)}: ${fmt(p.value)} ${unit}"></circle>`,
        )
        .join("");
      return `<text x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" class="lbl">${esc(g.family)} <tspan class="tick">(${g.points.length})</tspan></text>${dots}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${h}" role="img" class="chart">${grid}${rows}</svg>`;
}

// Axes default to the skill-investment chart's; `tip` writes a dot's hover text. A point's `marker` may be
// "square" or "ring" (hollow) or "x"; anything else is a filled dot.
function scatter({ points, width = 760, height = 360, xLabel = "cumulative skill points", yLabel = "¢ per turn", tip = (p) => `${p.label} — ${p.x} pt, ${fmt(p.y)} ¢/turn` }) {
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
    .map((p) => {
      const c = p.color ?? famColor(p.family);
      const mark =
        p.marker === "square"
          ? `<rect x="${X(p.x) - 6}" y="${Y(p.y) - 6}" width="12" height="12" style="fill:none;stroke:${c}" stroke-width="2" tabindex="0" data-tip="${esc(tip(p))}"></rect>`
          : p.marker === "ring"
            ? `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5" style="fill:none;stroke:${c}" stroke-width="2" tabindex="0" data-tip="${esc(tip(p))}"></circle>`
            : p.marker === "x"
              ? `<path d="M${X(p.x) - 5} ${Y(p.y) - 5}L${X(p.x) + 5} ${Y(p.y) + 5}M${X(p.x) - 5} ${Y(p.y) + 5}L${X(p.x) + 5} ${Y(p.y) - 5}" style="stroke:${c}" stroke-width="2" tabindex="0" data-tip="${esc(tip(p))}"></path>`
              : `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r ?? (p.big ? 7 : 4)}" style="fill:${c}" fill-opacity="${p.big ? 0.9 : 0.5}" stroke="${c}" tabindex="0" data-tip="${esc(tip(p))}"></circle>`;
      // `note` labels a point on its own (the mining panel's hop counts); otherwise the top big point of a kind.
      const text = p.note ?? (labelled.has(p) ? p.short : null);
      return `${mark}${text ? `<text x="${X(p.x) + (p.r ?? 7) + 3}" y="${Y(p.y) + 4}" class="lbl">${esc(text)}</text>` : ""}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="chart">${gy}${gx}<text x="${(width + m.l) / 2}" y="${height - 4}" text-anchor="middle" class="tick">${esc(xLabel)}</text><text transform="translate(12 ${height / 2}) rotate(-90)" text-anchor="middle" class="tick">${esc(yLabel)}</text>${dots}</svg>`;
}

// One dot a dish: ingredients cost along the bottom, hunger + mood worth (at the Ration Box's own
// combined rate — see cooking.js#boxPerPoint) up the side. The dashed line is parity with the box
// itself, since that rate is derived FROM the box — a dish sitting on the line costs exactly what a
// Ration Box would for the same hunger and mood. Above it beats Rations, below it loses to just
// buying one. Colour carries the same verdict the numbers do, so the shape of the story reads before
// the hover text does.
function dishValueChart({ dishes, width = 720, height = 380 }) {
  const m = { l: 54, r: 16, t: 14, b: 40 };
  const pts = dishes.filter((d) => d.cost != null && d.value != null);
  const hi = Math.max(...pts.flatMap((d) => [d.cost, d.value]), 1) * 1.08;
  const X = (v) => m.l + (v / hi) * (width - m.l - m.r);
  const Y = (v) => height - m.b - (v / hi) * (height - m.t - m.b);
  const gy = niceTicks(0, hi, 6)
    .map((v) => `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const gx = niceTicks(0, hi, 6)
    .map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${height - m.b}" class="grid"/><text x="${X(v)}" y="${height - m.b + 16}" text-anchor="middle" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const parity = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(hi)}" y2="${Y(hi)}" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${X(hi) - 4}" y="${Y(hi) - 6}" text-anchor="end" class="tick">as good as a Ration Box</text>`;
  const dots = pts
    .map((d) => {
      const good = d.margin >= 0;
      const c = good ? "var(--good)" : "var(--bad)";
      return `<circle cx="${X(d.cost)}" cy="${Y(d.value)}" r="5" style="fill:${c}" fill-opacity="${good ? 0.7 : 0.55}" stroke="${c}" tabindex="0" data-tip="${esc(d.name)}: ${fmt(d.cost, 1)} ¢ of ingredients, ${fmt(d.value, 1)} ¢ worth (${good ? "+" : ""}${fmt(d.margin, 1)} ¢)"></circle>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="chart">${gy}${gx}${parity}<text x="${(width + m.l) / 2}" y="${height - 4}" text-anchor="middle" class="tick">ingredients, ¢</text><text transform="translate(16 ${height / 2}) rotate(-90)" text-anchor="middle" class="tick">worth (hunger + mood), ¢</text>${dots}</svg>`;
}

// "a", "a and b", "a, b and c".
const listAnd = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const legend = (families = FAMILIES) =>
  `<p class="legend">${families.map((f) => `<span><i style="background:${famColor(f)}"></i>${esc(f)}</span>`).join("")}</p>`;

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
const gatherW = wage("Gatherer (Black Hills, no tool)");
const farmW = wage("Farmer, food (valued at the Ration Box)");
const farmFertW = wage("Farmer, food + Fertilizer (valued at the Ration Box)");
const trinketW = wage("Smith forging Trinkets (Smithing II, shelf stones)");
const minerForgeW = wage("Miner-smith forging own stones (Caves, pick only)");
const factW = wage("Factory solo");
const wageOrder = [
  ["food farming, with Fertilizer", farmFertW],
  ["food farming", farmW],
  ["a solo Factory worker", factW],
  ["a Prospector", proW],
  ["a gatherer in the Black Hills", gatherW],
  ["a miner with a pickaxe", floorW],
]
  .filter(([, v]) => v != null)
  .sort((a, b) => b[1] - a[1])
  .map(([label, v]) => `${label} ${fmt(v)} ¢`)
  .join(", ");
// What the counter pays for a dish, lowest and highest (the catalog's sellablePrice).
const dishSell = (() => {
  const xs = model.cooking.dishes.map((d) => d.sell).filter((v) => v != null);
  return { min: xs.length ? Math.min(...xs) : 0, max: xs.length ? Math.max(...xs) : 0 };
})();
const baselineOf = (role) => model.baselines.find((b) => b.role === role);
const stapleFood = model.foodSupply.find((f) => f.crop === params.stapleCrop);
const failing = model.claims.filter((c) => !c.ok);

const ST = model.starting;
const PWR = model.power;
const startingHeadline = `the ${ST.town.seats} named seats (${ST.unlimited.length} more roles have no cap) begin with about <b>${fmt(ST.town.funds, 0)} ¢</b> (${fmt(ST.town.bank, 0)} in banks, ${fmt(ST.town.coinHand, 0)} in hand) and <b>${fmt(ST.town.resources, 0)} ⬢</b>, and ${ST.roles.filter((r) => r.food > 0 && r.seats > 0).reduce((n, r) => n + r.seats, 0)} carry any food, ${ST.town.cookSeats} of them cooks with a turn's supplies each. A character is Hungry after turn ${ST.noFoodHungry}, <b>Starving after turn ${ST.noFoodStarve}</b> and Dying after turn ${ST.noFoodDying} on nothing, but every role starts with about a meal, so the first seats (${fmt(ST.starveRows[0].seats, 0)} of ${ST.town.seats}) are Starving at the close of turn ${ST.starveRows[0].turn} and Dying at turn ${ST.starveRows[0].dying} unless they eat again. The cooks start with ${fmt(ST.town.dishes, 0)} dishes' worth of crops between them, ${fmt(ST.town.cropTurns, 0)} person-turns of food once cooked. All the coin in the town buys ${fmt(ST.town.funds / ST.costPerPersonTurn, 0)} person-turns of ration, which is ${fmt(ST.town.funds / ST.costPerPersonTurn / ST.town.seats, 1)} turns for each named seat.`;
const headlines = [
  `Money a turn is worth: a miner with just a pickaxe earns about <b>${fmt(floorW)} ¢</b>, a Prospector <b>${fmt(proW)} ¢</b>, a gatherer in the Black Hills <b>${fmt(gatherW)} ¢</b> (no tool, and most of it is food), a farmer growing food <b>${fmt(farmW)} ¢, or ${fmt(farmFertW)} ¢ with Fertilizer</b> (valued at the Ration Box's rate for hunger and mood, since Foodstuffs never sell), and a solo Factory worker <b>${fmt(factW)} ¢</b>. Best to worst: ${wageOrder}. Farming is for eating, not cash — see "Food".`,
  `Farming: one Farm action sows ${fmt(params.farmMaxCrops, 0)} crops and reaps about <b>${fmt(params.harvestPerFarm, 0)} Foodstuffs</b> (${fmt(params.harvestPerFarmFert, 0)} fertilized), worked one turn in ${params.farmCycle} — a Farm action grants Exhausted outright, and both Exhausted and Tired refuse the next one. <b>${fmt(model.cooking.farmersToEatTown, 1)} farmers feed the town</b> once their harvest is cooked (see "Food").`,
  `The starting economy: ${startingHeadline}`,
  (() => {
    const E = model.equipment;
    return `Buyable gear: ${E.counts.picks} Items and Assets are creation picks, and a point spent on one buys a median <b>${fmt(E.medianRate, 1)} ¢</b> of kit at its in-play price${E.byPoints.filter((b) => b.rows >= 3 && b.medianRate != null).length >= 2 ? ` — ${E.byPoints.filter((b) => b.rows >= 3 && b.medianRate != null).map((b) => `${fmt(b.medianRate, 1)} at ${b.points} pt`).join(", ")}` : ""}. Against the ${fmt(E.pointValue, 1)} ¢ scale, ${E.counts.bargains} are bargains and ${E.counts.overpriced} overpriced; a point in a skill returns ${(() => {
      // Split on the investments tab's own "Pays through" column, so the two cannot drift.
      const m = (k) => median(E.skillPoints.filter((r) => r.paysThrough === k).map((r) => r.overGamePerPoint));
      const cash = m("production");
      const other = m("caving");
      return `a median ${cash == null ? "—" : `${fmt(cash, 0)} ¢`} over the game where it pays through production, and ${other == null ? "—" : `${fmt(other, 0)} ¢`} where it pays through caving (Lucky, the fighting tags, Spelunker and the like), taking one caving expedition a turn, which rests on the band → mix assumption and carries the Caving Die's risk`;
    })()} (see "Buyable gear, point for point").`;
  })(),
  (() => {
    const A = model.armor;
    const bad = A.rows.filter((r) => r.verdict === "no use case").map((r) => r.name);
    const look = A.rows.filter((r) => r.verdict === "worth a look").map((r) => r.name);
    return `Armour, piece against piece: ${A.counts.inPlay} of the ${A.counts.pieces} wearable pieces can be picked, bought or made. ${bad.length ? `<b>${bad.length}</b> ${bad.length === 1 ? "has" : "have"} no use case — a twin of, or dominated by, another piece in the same slot: ${bad.map(esc).join(", ")}.` : "<b>Every one of them has a use case</b>: none is a twin of, or dominated by, another piece in its slot."} ${look.length ? `Worth a look — outpriced by a piece at half the points, or heavy for the protection it adds: ${look.map(esc).join(", ")}.` : "None is outpriced by a piece at half the points, and none is heavy for the protection it adds."} (See "Buyable gear, point for point".)`;
  })(),
  `Smithing's Trinkets, at a ${params.sellTaxRate}% sell tax: a Smithing II smith forging with shelf stones clears <b>${fmt(trinketW)} ¢ a turn</b> (<b>${fmt(model.trinkets.shelfLoop.bestSkilledLucky?.["skilled-lucky"])} ¢</b> with Lucky), and a miner who forges the stones they dig up earns <b>${fmt(minerForgeW)} ¢</b> instead of ${fmt(floorW)}. A Trinket is a whole Move and 4 ⬢, and the cash is set by a d6 and by the stones (see “Trinket forging”). Crafts are shown at the run's sell tax (<code>--sell-tax N</code>).`,
  `The easy-craft baselines, with ⬢ bought at the Depot: a starter smith ${fmt(baselineOf("Starter smith")?.value)} ¢ a turn (${baselineOf("Starter smith")?.key.split(": ")[1]}), a skilled smith ${fmt(baselineOf("Skilled smith")?.value)} ¢ (${baselineOf("Skilled smith")?.key.split(": ")[1]}), a crafter ${fmt(baselineOf("Crafter")?.value)} ¢, a skilled brewer ${fmt(baselineOf("Skilled brewer")?.value)} ¢. A cook earns next to nothing from the counter, which pays ${dishSell.min === dishSell.max ? `${dishSell.min} ¢` : `${dishSell.min}–${dishSell.max} ¢`} for a dish, but feeds ${fmt(model.cheapestMeal?.personTurnsPerMove, 0)} person-turns per Move for ${fmt(model.cheapestMeal?.costPerPersonTurn, 2)} ¢ each.`,
  `Mining and gathering are the only ways to make ⬢ (${fmt(params.minerResourcesPerTurn)} ⬢/turn for a Prospector at the Caves); anyone with coin can buy them at the Depot's ${params.rv.buy} ¢ import price, up to ${params.depotMaxQuantity} an order, which is the ceiling on what a Prospector's ⬢ fetch. A median smithing recipe burns <b>${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.medianBurn)} ⬢/turn</b> — roughly ${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.minersPerCrafter, 1)} miners per smith just to keep one forge fed.`,
  `Food demand is small and steady: ${players} players burn ${players * params.hungerDecay} hunger a turn (${params.hungerDecayPerDay} a day at ${params.turnLengthHours} hours a turn). About <b>${fmt(model.cooking.farmersToEatTown, 1)} farmers</b> feed the whole town with the harvest cooked; eaten raw, one Farm action is ~${fmt(stapleFood.personTurnsPerFarm, 0)} person-turns of ${esc(stapleFood.name)} and it takes ${fmt(stapleFood.farmersNeeded, 0)}.`,
  (() => {
    const at8 = model.combos.loadouts.filter((l) => l.points <= params.startingTagPoints).sort((x, y) => y.withFactory.rate - x.withFactory.rate || x.points - y.points)[0];
    const refAlone = model.combos.alone.find((a) => /^Refine/.test(a.label));
    const letters = new Set(at8.withFactory.pattern.split(" "));
    // What fills the turns Refine is locked out of, read off the winning schedule rather than assumed.
    // Farm is not one of the fillers any more: it earns food, not ¢, so it never enters this ¢-mixing planner.
    const fillers = [letters.has("C") ? "a craft" : null, letters.has("M") ? "mining" : null].filter(Boolean);
    const offTurns = letters.has("R") ? (fillers.length ? ` Refining tires you the way mining does, so ${fillers.join(" and ")} fills the off turns.` : " Refining tires you the way mining does, and nothing in this loadout fills the off turns.") : "";
    return `The best mix at the starting budget (${params.startingTagPoints} points) is <b>${esc(at8.skills.join(" + "))}</b>, worked as <span class="mono">${esc(at8.withFactory.pattern.split(" ").slice(0, 8).join(" "))}</span> (R refine, C craft, M mine), for <b>${fmt(at8.withFactory.rate)} ¢ a turn</b>, against ${fmt(refAlone.rate)} refining alone.${offTurns}${letters.has("R") ? ` Only ${params.refinerySeats} people can refine in a turn; with a crowd the mix falls back on ${at8.noFactory.pattern.includes("C") ? "crafts" : at8.noFactory.pattern.includes("M") ? "mining" : "resting"} (${fmt(at8.noFactory.rate)} ¢ a turn without the Factory).` : ""}`;
  })(),
  `Fatigue: ${model.fatigue.rows.filter((r) => r.tires).map((r) => `${r.label.toLowerCase().replace(/ \(.*\)/, "")} can be pressed ${r.steady >= 0.999 ? "every turn" : `1 turn in ${fmt(1 / r.steady, 0)}`}`).join(", ")}. ${model.fatigue.rows.filter((r) => !r.tires).map((r) => r.label.toLowerCase().replace(/ \(.*\)/, "")).join(", ")} never tire you.`,
  `A Prospector at the Caves brings up ${fmt(params.minerResourcesPerTurn)} ⬢ a turn plus ${fmt(model.prospectorValue[0].dropsPerTurn, 2)} ¢ of drops: worth <b>${fmt(model.prospectorValue[0].atMid)} ¢ a turn</b> with ⬢ bartered at the midpoint (${fmt(params.rv.mid, 1)} ¢), ${fmt(model.prospectorValue[0].atBuy)} ¢ at the Depot's ${params.rv.buy} ¢ buy price and ${fmt(model.prospectorValue[0].atSell)} ¢ at the ${params.rv.sell} ¢ sell-back. ${params.obolFamilies.length ? `A smith can pay a recipe's ⬢ in obols, one for one, so a smith will pay a Prospector no more than ${params.rv.sell} ¢ a ⬢; only brewers, crafters and the like, who must hold real ⬢, will pay up to ${params.rv.buy} ¢.` : `No craft can be paid in obols, so every crafter must hold real ⬢ and will pay a Prospector up to ${params.rv.buy} ¢ a ⬢, the Depot's import price.`}`,
  `${model.sources.summary.special} of ${model.sources.summary.recipes} recipes need a special item (${model.sources.summary.copies} of those only copy a key). Of the rest, ${model.sources.summary.byHardest[4]} are held back by a Scarce item and ${model.sources.summary.byHardest[5]} by an item with no known source.`,
  `${failing.length} of ${model.claims.length} figures the docs quote do not match what the catalog and code produce (see “Docs against the model”).`,
];

function sectionWages() {
  const midLabel = `⬢ at ${fmt(params.rv.mid, 1)} ¢`;
  // The axis gets a short name and the tooltip the full one, so the bars get the width. Rules, not a list, so a
  // new wage row shortens itself the same way.
  const shortKey = (k) =>
    k
      .replace(/^Miner, pickaxe only \(Caves\)$/, "Miner (Caves, pick)")
      .replace(/^Prospector \(Caves\)$/, "Prospector (Caves)")
      .replace(/ \(Black Hills, no tool\)$/, " (Hills)")
      .replace(/^Starter smith: /, "Smith I: ")
      .replace(/^Skilled smith: /, "Smith II: ")
      .replace(/^Starter brewer: /, "Brewer I: ")
      .replace(/^Skilled brewer: /, "Brewer II: ")
      .replace(/^Distilling brewer: (.*), sold to players at the shelf price$/, "Distilled $1, shelf price")
      .replace(/^Brewer: (.*), sold to players at the shelf price$/, "$1, shelf price")
      .replace(/ \(valued at the Ration Box\)$/, " (Ration Box)")
      .replace(/^Smith forging Trinkets \(Smithing II, shelf stones\)$/, "Trinket smith (shelf stones)")
      .replace(/^Miner-smith forging own stones \(Caves, pick only\)$/, "Miner-smith (own stones)")
      .replace(/^Factory solo, carry-limited \(.*\)$/, "Factory solo, carry-limited");
  const rows = model.wages.map((w) => ({ label: shortKey(w.key), tip: w.key, value: w.value, color: w.ceiling ? "var(--c3)" : w.baseline ? "var(--c1)" : "var(--c0)", ...(w.valueMid != null ? { value2: w.valueMid, label2: midLabel } : {}) }));
  const ceilingWages = model.wages.filter((w) => w.ceiling);
  const drinkNote = ceilingWages.length
    ? ` The ${ceilingWages.length === 1 ? "one bar" : `${ceilingWages.length} bars`} in the third colour ${ceilingWages.length === 1 ? "is a ceiling" : "are ceilings"}, not wages: ${listAnd([...new Set(ceilingWages.map((w) => w.key.replace(/^(Distilling brewer|Brewer): /, "").replace(/, sold to players.*$/, "")))])} never reaches the counter and is priced at the Black Market's shelf price, what a player might pay${model.distilling.length ? `; the Distilling row is the same drink with the stack doubled, for ${model.distilling[0].extraPoints} more points on Brewing II` : ""}. They are left off the price ladder for that reason.`
    : "";
  // The food farmer's row is a ceiling, and other food crops sit above it on the same rule.
  const stapleRow = model.activities.find((a) => a.id === `farm:${params.stapleCrop}`);
  const richer = stapleRow ? model.activities.filter((a) => a.kind === "farm" && a.foodValued && !a.fert && a.netPerTurn > stapleRow.netPerTurn).sort((x, y) => y.netPerTurn - x.netPerTurn) : [];
  const stapleNote = stapleRow
    ? ` The food farmer is the staple, ${esc(stapleRow.name.replace(/^Farm — /, "").toLowerCase())}, valued at Ration Box parity with no cap on how much the town will eat: a ceiling priced against Rations, not a wage anybody pays.${richer.length ? ` ${listAnd(richer.map((a) => `${esc(a.name.replace(/^Farm — /, ""))} (${fmt(a.netPerTurn)} ¢)`))} price${richer.length === 1 ? "s" : ""} higher on the same rule.` : ""}`
    : "";
  return `<section><h2>What a turn is worth</h2>
<p class="lede">Net ¢ per turn for a typical holder of each occupation, with every ⬢ a crafter spends valued at the Depot's <b>${resourceValue === "buy" ? `buy price (${params.rv.buy} ¢)` : `sell-back (${params.rv.sell} ¢)`}</b>: what a ⬢ costs somebody who needs one and holds none. A ⬢ a Prospector brings up is valued at the <b>${params.minedValue === "mid" ? `midpoint (${fmt(params.rv.mid, 1)} ¢)` : `${params.minedValue === "buy" ? "buy price" : "sell-back"} (${fmt(params.rvMined, 1)} ¢)`}</b>, what it should barter for. <code>--resource-value ${resourceValue === "buy" ? "sell" : "buy"}</code> and <code>--mined-value buy|sell</code> move them. Every figure is at a <b>${params.sellTaxRate}% sell tax</b> on what is sold at the counter (<code>--sell-tax N</code>; see "What the sell tax does"). The gold bars are the <b>easy-craft baselines</b> (next section), and the lighter bar under each is the same recipe with its ⬢ bought from a Prospector at the midpoint, <b>${fmt(params.rv.mid, 1)} ¢</b>, rather than imported at ${params.rv.buy} ¢. The bars are on a log scale, since the food farmer's Ration Box valuation would otherwise flatten every wage beside it; the printed figures are the real ones. Mining, gathering, refining and farming are each scaled by how often the fatigue ladder lets them be pressed (${fmt(params.mineDuty * 100, 0)}% of turns for mining and gathering, ${fmt(params.refineDuty * 100, 0)}% for refining, ${fmt(params.farmDuty * 100, 0)}% for farming). The gatherer is the Mine button in the Black Hills: no pickaxe, a poorer coefficient, and a draw on the gathering table (food) instead of stones.${stapleNote}${drinkNote}${model.transport.carryLimited.find((r) => r.key === "bare") ? ` The carry-limited Factory bar is a solo refiner who carries the shift to the Depot bare and uncrated, so only what fits under the hard cap is sold; crating it or a Cart restores the full Factory figure (see "Transport").` : ""}</p>
${barChart({ rows, scale: "log" })}</section>`;
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
// A secret recipe never folds into a shown twin: who may see it is part of the line.
const sigOfRecipe = (r) => (r.sig == null ? null : `${r.sig}|${secretMark(r)}`);
// A Distilling variant or a ceiling-priced drink keeps its own line rather than folding into its twin.
const sigOfSlug = (r) => (r.distilled || r.ceiling || !recBy.get(r.slug) ? null : sigOfRecipe(recBy.get(r.slug)));
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
  { h: "Also needs", raw: true, get: (a) => a.needsText ?? needsCell(a.slug), sort: (a) => (recBy.get(a.slug)?.items.length ?? 0) },
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
  const cropsPerFarm = params.harvestPerFarm;
  const baseCols = [
    { h: "Role", get: (b) => b.role },
    { h: "Best easy recipe", get: (b) => b.key.split(": ")[1] },
    { h: "Skill points", num: true, get: (b) => b.skillPoints },
    { h: "¢/turn, ⬢ bought", num: true, get: (b) => fmt(b.value), sort: (b) => b.value },
    { h: "¢/turn, ⬢ mined", num: true, get: (b) => fmt(b.valueMined), sort: (b) => b.valueMined },
    { h: `¢/turn, ⬢ at ${fmt(params.rv.mid, 1)} ¢`, num: true, get: (b) => fmt(b.valueMid), sort: (b) => b.valueMid ?? -1e9 },
  ];
  return `<section><h2>Baselines: the easy crafts</h2>
<p class="lede">What somebody can earn from a standing start, using only what is easy to get. A recipe is <b>easy</b> when every input is on the Depot's general shelf, is farmed, is an ore on at least ${fmt(100 * 0.1, 0)}% of Prospecting presses, is a cave find on at least 1 in 50 arrivals, or is a craft from those. ⬢ comes from the Depot at ${params.rv.buy} ¢; the next column shows the pay if the crafter mined it instead, and the last if they bought it from a Prospector at the midpoint, ${fmt(params.rv.mid, 1)} ¢. Recipes that need an ore supply of more than two Prospectors per crafter are flagged and left out of the baselines. ${params.obolFamilies.length ? `<b>Smithing recipes can pay their ⬢ in obols, one for one</b> (the game refuses this for every other craft), so a smith does not have to import ⬢ at all: the “paid in obols” column is a smith's real wage, and the “bought” column is what a smith would earn by importing anyway.` : `No craft can be paid in obols, so the “bought” column is every crafter's real wage.`} Crafts are shown at a ${params.sellTaxRate}% sell tax on the gross of each sale. These baselines are what the rest of the report compares against.</p>
<h3>What skill points pay</h3>
<p class="lede">The catalog is priced from one wage table (<code>DEPOT.md</code> §4): a maker who buys every ⬢ at the Depot's ${params.rv.buy} ¢, crafts, and sells to the Depot clears a set profit per Move for each rung of skill points, and more points always pay more. The table is set on the raw profit. <b>The Meister's sell tax then comes off the gross of every counter sale</b>, not off the profit, so a thin-margin craft feels it most: this run takes <b>${params.sellTaxRate}%</b>, and the "at the run's tax" columns show what is left (see "What the sell tax does"). The floor is meant to be thin. ${model.profitRows.length} smithing, crafting and brewing recipes that work no input are on the table (prices stayed and the ⬢ cost was fitted to them); another ${model.workedRows.length} work an input, and are priced off it instead: their wage, their ⬢, and nearly twice a raw input's sell price (bars, potions from cave finds and organs, gear from ore); ${model.heldBack.length ? `${model.heldBack.length} are held back (${model.heldBack.map(esc).join(", ")}), because the shelf or sell prices they are fitted to leave no whole-⬢ recipe that lands on the rung` : "none are held back"}.</p>
${table({
    cols: [
      { h: "Skill points", num: true, get: (t) => t.points },
      { h: "Rate ¢ / Move (before tax)", num: true, get: (t) => t.rate },
      { h: "Recipes", num: true, get: (t) => t.n },
      { h: "Lowest, raw", num: true, get: (t) => fmt(t.min), sort: (t) => t.min },
      { h: "Median, raw", num: true, get: (t) => fmt(t.median), sort: (t) => t.median },
      { h: "Highest, raw", num: true, get: (t) => fmt(t.max), sort: (t) => t.max },
      { h: `Median at a ${params.sellTaxRate}% tax`, num: true, get: (t) => fmt(t.netMedian), sort: (t) => t.netMedian },
      { h: `Highest at a ${params.sellTaxRate}% tax`, num: true, get: (t) => fmt(t.netMax), sort: (t) => t.netMax },
      { h: "Families", get: (t) => t.families.join(", ") },
    ],
    rows: model.profitTiers,
  })}
${model.distilling.length ? `<h4>Distilling, beside the rungs</h4>
<p class="lede">Distilling is ${model.distilling[0].extraPoints} points on top of Brewing II (${model.distilling[0].points} in all) and doubles the stack of ${model.distilling.map((d) => d.name).join(" and ")} from the same mash, Move and ⬢ — read from the game's own list, not a rung of the wage table, so it sits beside the tiers rather than inside the checks above. ${model.distilling.filter((d) => d.ceiling).map((d) => `${d.name} never reaches the counter (it sells to players at the Black Market's shelf price), so its figure is a ceiling`).join("; ")}${model.distilling.some((d) => d.ceiling) ? "." : ""} ${model.distilling.filter((d) => !d.ceiling).map((d) => `${d.name} does sell there, and doubling it adds ${fmt(d.gain, 1)} ¢ a Move at a ${params.sellTaxRate}% sell tax`).join("; ")}${model.distilling.some((d) => !d.ceiling) ? "." : ""}</p>
${table({
    cols: [
      { h: "Drink", get: (d) => d.name },
      { h: "Points", num: true, get: (d) => d.points },
      { h: "Moves", num: true, get: (d) => fmt(d.moves, 2) },
      { h: "¢ / Move, plain (raw)", num: true, get: (d) => fmt(d.plainRaw, 1), sort: (d) => d.plainRaw },
      { h: "¢ / Move, distilled (raw)", num: true, get: (d) => fmt(d.raw, 1), sort: (d) => d.raw },
      { h: `¢ / Move, plain (at a ${params.sellTaxRate}% tax)`, num: true, get: (d) => fmt(d.plainNet, 1), sort: (d) => d.plainNet },
      { h: `¢ / Move, distilled (at a ${params.sellTaxRate}% tax)`, num: true, get: (d) => fmt(d.net, 1), sort: (d) => d.net },
      { h: "Distilling adds", num: true, get: (d) => fmt(d.gain, 1), sort: (d) => d.gain },
      { h: "Priced at", get: (d) => (d.ceiling ? "the Black Market shelf price: a ceiling, sold to players" : "what the counter pays") },
    ],
    rows: model.distilling,
  })}` : ""}
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
<p class="lede">A dish sells to the Depot for only a coin or two (a floor, not a market), so a cook is paid in food and mood more than in coin. What a cook makes is food and mood, so the table ranks dishes by what a person-turn of food costs in ingredients. Every ingredient is a food, priced the one way the whole report prices food: at the counter's price where it sells, else its hunger and mood at the Ration Box's rate, never more than the Depot asks for it. One person burns ${params.hungerDecay} hunger a turn. ${top ? `The cheapest is ${esc(top.name)}: ${top.hunger} hunger from ingredients worth ${fmt(top.costPerDish, 1)} ¢, ${fmt(top.costPerPersonTurn, 2)} ¢ a person-turn, against ${fmt(model.foodFloor.anyone?.costPerPersonTurn, 2)} ¢ for a Depot ${esc(model.foodFloor.anyone?.name ?? "Ration Box")}, the cheapest thing anyone can simply order, at a mood of ${fmt(model.foodFloor.anyone?.mood, 1)}. A Move of ${esc(top.name)} is ${fmt(top.dishesPerMove, 0)} dishes and needs about ${fmt(top.dishesPerMove * unitsPerDish, 0)} ingredient units, roughly one Farm action's harvest (${fmt(cropsPerFarm, 0)}), so the crop supply binds long before the Move does.` : ""}</p>
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
  // Durable things are paid back once; consumed ones are bought every use, so they get a per-use return instead.
  const payable = all.filter((r) => r.lasts === "durable" && r.paybackTurns != null && r.coin > 0).sort((a, b) => a.paybackTurns - b.paybackTurns);
  const perUse = all.filter((r) => r.perUse?.backPerCoin != null).sort((a, b) => b.perUse.backPerCoin - a.perUse.backPerCoin);
  const efficient = all.filter((r) => r.perPoint != null && r.points > 0).sort((a, b) => b.perPoint - a.perPoint);
  const paysColor = (r) => (r.perPoint < 0 ? "var(--bad)" : r.paysThrough === "caving" ? "var(--c2)" : r.paysThrough === "trade" ? "var(--c1)" : r.paysThrough === "mixed" ? "var(--c3)" : "var(--c0)");
  const paysLegend = `<p class="legend">${[["var(--c0)", "production: no risk beyond fatigue"], ["var(--c2)", "caving: an assumption, and the Caving Die's risk"], ["var(--c1)", "trade"], ["var(--c3)", "mixed"], ["var(--bad)", "gives back points"]].filter(([c]) => c === "var(--bad)" ? efficient.some((r) => r.perPoint < 0) : efficient.some((r) => paysColor(r) === c)).map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</p>`;
  const production = efficient.filter((r) => r.paysThrough === "production");
  const bestDurable = payable[0];
  const bestUse = perUse[0];
  const byPays = (k) => efficient.filter((r) => r.paysThrough === k && r.perPoint > 0);
  const cols = [
    { h: "Investment", get: (r) => r.name },
    { h: "Group", get: (r) => r.group },
    { h: "Kind", get: (r) => r.kind },
    { h: "Lasts", get: (r) => r.lastsText },
    { h: "Pays through", get: (r) => r.paysText, style: (r) => (r.paysThrough === "caving" ? "color:var(--c2)" : "") },
    { h: "What it does", get: (r) => r.does },
    { h: "Cost", get: (r) => r.coinHow },
    { h: "All-in ¢", num: true, get: (r) => (r.allIn > 0 ? fmt(r.allIn, 0) : "0"), sort: (r) => r.allIn },
    { h: "Points", num: true, get: (r) => (r.points ? r.points : "—"), sort: (r) => r.points },
    { h: "Pays ¢ / turn", num: true, get: (r) => (r.gain == null ? "once" : fmt(r.gain, 1)), sort: (r) => r.gain ?? -1e9 },
    { h: "Pays back in", num: true, get: (r) => (r.perUse ? "per use" : r.paybackTurns == null ? "—" : r.paybackTurns === 0 ? "at once" : `${fmt(r.paybackTurns, 1)} turns`), sort: (r) => r.paybackTurns ?? 1e9 },
    { h: "Per use: ¢ back per ¢", num: true, get: (r) => (r.perUse?.backPerCoin == null ? "—" : `${fmt(r.perUse.backPerCoin, 1)} (${fmt(r.perUse.gross, 1)} ¢ for ${fmt(r.perUse.price, 0)} ¢ a ${r.perUse.unit})`), sort: (r) => r.perUse?.backPerCoin ?? -1 },
    { h: `Net over ${params.gameTurns} turns`, num: true, get: (r) => (r.netOverGame == null ? (r.perUse ? "bought each use" : "—") : fmt(r.netOverGame, 0)), sort: (r) => r.netOverGame ?? -1e9 },
    { h: "¢ / turn per point", num: true, get: (r) => (r.perPoint == null ? "—" : fmt(r.perPoint, 2)), sort: (r) => r.perPoint ?? -1e9 },
    { h: "How it is worked out", get: (r) => r.gainHow ?? "" },
    { h: "Caveat", get: (r) => r.note ?? "" },
  ];
  const paybackBars = payable.map((r) => ({ label: r.name, value: r.paybackTurns, color: r.paybackTurns <= 3 ? "var(--good)" : r.paybackTurns <= 20 ? "var(--c1)" : "var(--c0)" }));
  const pointBars = efficient.map((r) => ({ label: r.name, value: r.perPoint, color: paysColor(r) }));
  const productionBars = production.map((r) => ({ label: r.name, value: r.perPoint, color: paysColor(r) }));
  const useBars = perUse.map((r) => ({ label: r.name, value: r.perUse.backPerCoin, color: "var(--c1)" }));
  const scanned = I.scanned
    .map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.resources} ⬢${s.moves ? `, ${fmt(s.moves, 0)} Moves` : ""}</td><td>${esc(s.effect)}</td></tr>`)
    .join("");
  return `<section><h2>What each investment pays back</h2>
<p class="lede">Every tool, skill, consumable, building and animal that raises somebody's output, costed and paid back from the same catalog the rest of the report reads. A ⬢ you make is valued at ${fmt(params.rvMined, 1)} ¢ (the midpoint of the Depot's prices), a ⬢ you spend at the Depot's ${params.rv.buy} ¢, and a Move given up at <b>${fmt(I.moveValue, 1)} ¢</b>, an average mining turn (<code>--move-value</code> changes it). Skill points are a different budget, so they are shown beside the payoff and as ¢ a turn per point, never converted to coin. The gain is one person's, working alone and every turn they can; nothing here is saturated, so read the last column as a ceiling.</p>
<p class="lede">Two distinctions, both read off the catalog and the model rather than typed per row. <b>Lasts</b>: a durable thing (a tool, a building, a skill, an animal, a trait) is bought once and paid back once against its gain a turn; a consumed one (a tag that is <code>consumable</code> or opens into something) is bought again every use, so its gain a turn is already net of its own price, it has no payback in turns and no total over the game, and its return is shown per use, ¢ back for each ¢ spent. <b>Pays through</b>: ${all.filter((r) => r.paysThrough === "production").length} rows pay through production, with no risk beyond fatigue, and ${all.filter((r) => r.paysThrough === "caving").length} through caving, whose ¢ is a caver's expedition under the trouble budget and the typed band → mix table (or mood saved where the Caving Die rolls), so it rests on an assumption and carries the die's risk. The two are not the same kind of number: ${(() => {
    const p = byPays("production")[0];
    const c = byPays("caving")[0];
    return p && c ? `the best production point, in ${esc(p.name)}, returns ${fmt(p.perPoint, 2)} ¢ a turn per point, and the best caving point, in ${esc(c.name)}, ${fmt(c.perPoint, 2)} ¢ an expedition per point` : "each group is charted in its own colour";
  })()}, and the second is only as good as the assumption under it.</p>
<h3>Pays back fastest</h3>
<p class="lede">${bestDurable ? `Of what is bought once, <b>${esc(bestDurable.name)}</b> pays back fastest, in ${bestDurable.paybackTurns === 0 ? "no time" : `${fmt(bestDurable.paybackTurns, 1)} turns`} (${esc(bestDurable.paysThrough)})${(() => {
    const p = payable.find((r) => r.paysThrough === "production");
    return p && p !== bestDurable ? `; through production, with no assumption under it, <b>${esc(p.name)}</b> in ${fmt(p.paybackTurns, 1)} turns` : "";
  })()}.` : ""} ${bestUse ? `Of what is used up, <b>${esc(bestUse.name)}</b> returns the most, ${fmt(bestUse.perUse.backPerCoin, 1)} ¢ for each ¢ spent, every ${esc(bestUse.perUse.unit)}.` : ""}</p>
<h4>Durable: turns to pay back what it costs in coin</h4>
${barChart({ rows: paybackBars, unit: " turns", fmtVal: (v) => (v < 0.05 ? "at once" : fmt(v, 1)), labelW: 210 })}
${useBars.length ? `<h4>Used up: ¢ back for each ¢ spent, per use</h4>${barChart({ rows: useBars, unit: " ¢", fmtVal: (v) => fmt(v, 1), labelW: 210, scale: "linear" })}` : ""}
<h3>Best use of a skill point</h3>
<p class="lede">Every durable row that costs points, coloured by what it pays through. Log scale, since the caving rows are an order of magnitude above production; the production rows follow on their own, on a linear scale.</p>
${paysLegend}
${barChart({ rows: pointBars, unit: " ¢/turn", fmtVal: (v) => fmt(v, 2), labelW: 210, scale: "log" })}
<h4>Production only: no risk beyond fatigue</h4>
${barChart({ rows: productionBars, unit: " ¢/turn", fmtVal: (v) => fmt(v, 2), labelW: 210, scale: "linear" })}
<h3>All of it</h3>
${table({ cols, rows: all, filters: [{ label: "Group", get: (r) => r.group }, { label: "Kind", get: (r) => r.kind }, { label: "Lasts", get: (r) => r.lastsText }, { label: "Pays through", get: (r) => r.paysThrough }] })}
<h3>Buildings that raise nothing</h3>
<p class="lede">Every other structure type in the catalog, scanned for anything that changes what somebody makes. None does. Their cost is the price of what they are for.</p>
<div class="tablewrap"><table><thead><tr><th>Building</th><th class="num">Cost</th><th>What it does</th></tr></thead><tbody>${scanned}</tbody></table></div>
<p class="lede">Also scanned and left out: ${model.counts.carryTags} tags carry a <code>carryBonus</code> (a Cart, a Pack Mule) and raise how much you can move, which matters to hauling but is not counted here, and <code>gambitBonus</code> perks change a roll's odds and no output.</p>
</section>`;
}

// One dot a pick: what it costs in points along the bottom, what it is worth in ¢ up the side. The
// dashed line is the scale — `pointValue` ¢ a point — so a dot on it costs exactly what its ¢ say it
// should, one above it is more kit than the points paid for (a bargain), one below is fewer. Picks
// sharing a point price and a ¢ figure (the whole Dead Simple rung at 2 pt and 6 ¢) are one larger
// dot with every name in its hover text, so a stack does not hide behind its own front dot.
function pointScaleChart({ rows, pointValue, width = 720, height = 380 }) {
  const m = { l: 54, r: 16, t: 14, b: 40 };
  const pts = rows.filter((r) => r.replace != null);
  const xHi = Math.max(...pts.map((r) => r.points), 1) * 1.08;
  const yHi = Math.max(...pts.map((r) => r.replace), 1) * 1.08;
  const X = (v) => m.l + (v / xHi) * (width - m.l - m.r);
  const Y = (v) => height - m.b - (v / yHi) * (height - m.t - m.b);
  const gy = niceTicks(0, yHi, 6)
    .map((v) => `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const gx = niceTicks(0, xHi, 7)
    .map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${height - m.b}" class="grid"/><text x="${X(v)}" y="${height - m.b + 16}" text-anchor="middle" class="tick">${fmt(v, 0)}</text>`)
    .join("");
  const lineEndX = Math.min(xHi, yHi / pointValue);
  const scale = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(lineEndX)}" y2="${Y(lineEndX * pointValue)}" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${X(lineEndX) - 4}" y="${Y(lineEndX * pointValue) - 6}" text-anchor="end" class="tick">${fmt(pointValue, 1)} ¢ a point</text>`;
  const stacks = new Map();
  for (const r of pts) {
    const k = `${r.points}:${r.replace}`;
    if (!stacks.has(k)) stacks.set(k, { points: r.points, replace: r.replace, verdict: r.verdict, names: [] });
    stacks.get(k).names.push(r.name);
  }
  const color = (v) => (v === "a bargain" ? "var(--c1)" : v === "overpriced" ? "var(--bad)" : "var(--good)");
  const dots = [...stacks.values()]
    .map((s) => {
      const tip = `${s.names.length > 6 ? `${s.names.slice(0, 6).join(", ")} and ${s.names.length - 6} more` : s.names.join(", ")} — ${s.points} pt, ${fmt(s.replace, 0)} ¢ (${s.verdict})`;
      return `<circle cx="${X(s.points)}" cy="${Y(s.replace)}" r="${4 + Math.sqrt(s.names.length) * 1.6}" style="fill:${color(s.verdict)}" fill-opacity=".6" stroke="${color(s.verdict)}" tabindex="0" data-tip="${esc(tip)}"></circle>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="chart">${gy}${gx}${scale}<text x="${(width + m.l) / 2}" y="${height - 4}" text-anchor="middle" class="tick">points at character creation</text><text transform="translate(12 ${height / 2}) rotate(-90)" text-anchor="middle" class="tick">¢ to replace it in play</text>${dots}</svg>`;
}

function sectionEquipment() {
  const E = model.equipment;
  const pv = E.pointValue;
  const doesOf = (r) => {
    const bits = [];
    if (r.earnsPerTurn != null) bits.push(`earns ${fmt(r.earnsPerTurn, 1)} ¢ a turn (${fmt(r.earnsOverGame, 0)} ¢ net over ${params.gameTurns} turns)`);
    if (r.fightTiers != null) bits.push(`+${r.fightTiers} fighting tier${r.fightTiers === 1 ? "" : "s"} (${r.fightClass}), so combat alone justifies at most ${fmt(r.fightCeiling, 1)} pt`);
    if (r.armorWords) bits.push(r.armorWords);
    if (r.carryBonus != null) bits.push(`carry ${r.carryBonus > 0 ? "+" : ""}${fmt(r.carryBonus * 100, 0)}% while in hand`);
    if (r.miningBonus != null && r.earnsPerTurn == null) bits.push(`+${r.miningBonus} ⬢ a mining press`);
    return bits.join("; ") || "";
  };
  const makeOf = (r) => (r.craft ? `${r.craft.resources} ⬢${r.craft.items ? ` + ${fmt(r.craft.items, 0)} ¢ of ${r.craft.inputs.join(", ")}` : ""}, ${fmt(r.craft.moves, 2)} Move${r.craft.moves === 1 ? "" : "s"}, ${r.craft.skills}${r.craft.skillPoints ? ` (${r.craft.skillPoints} pt)` : ""}${r.craft.workshop ? ", at a forge" : ""}: ${fmt(r.craft.allIn, 0)} ¢ all in` : "not craftable");
  const cols = [
    { h: "Pick", get: (r) => r.name },
    { h: "Group", get: (r) => r.group },
    { h: "Points", num: true, get: (r) => r.points, sort: (r) => r.points },
    { h: "Band", get: (r) => r.band },
    { h: "Also needs", get: (r) => r.requires ?? "" },
    { h: "How hard in play", get: (r) => r.rankLabel, sort: (r) => r.rank },
    { h: "Easiest route", get: (r) => r.route },
    { h: "Free with", get: (r) => (r.kits.length ? r.kits.join(", ") : "") },
    { h: "Depot ¢", num: true, get: (r) => r.depot ?? "—", sort: (r) => r.depot ?? -1 },
    { h: "Sells for ¢", num: true, get: (r) => r.sell ?? "—", sort: (r) => r.sell ?? -1 },
    { h: "To make one", get: makeOf },
    { h: "Replace ¢", num: true, get: (r) => (r.replace == null ? "—" : fmt(r.replace, 0)), sort: (r) => r.replace ?? -1 },
    { h: "Via", get: (r) => r.replaceHow ?? "no ¢ figure" },
    { h: "¢ a point", num: true, get: (r) => (r.rate == null ? "—" : fmt(r.rate, 1)), sort: (r) => r.rate ?? -1 },
    { h: `Fair at ${fmt(pv, 1)} ¢/pt`, num: true, get: (r) => r.fairPoints ?? "—", sort: (r) => r.fairPoints ?? -1 },
    { h: "Drift", num: true, get: (r) => (r.drift == null ? "—" : r.drift > 0 ? `+${r.drift}` : String(r.drift)), sort: (r) => r.drift ?? 0, style: (r) => (r.drift == null || r.drift === 0 ? "" : r.drift > 0 ? "color:var(--bad)" : "color:var(--c1)") },
    { h: "Verdict", get: (r) => r.verdict ?? "unpriced" },
    { h: "What it does, in numbers", get: doesOf },
    { h: "Caveat", get: (r) => r.flags.join("; ") },
  ];
  const pointCols = [
    { h: "Points", num: true, get: (b) => b.points },
    { h: "Band", get: (b) => b.band },
    { h: "Picks", num: true, get: (b) => b.rows },
    { h: "With a ¢ figure", num: true, get: (b) => b.priced },
    { h: "Replace ¢, median", num: true, get: (b) => (b.medianReplace == null ? "—" : fmt(b.medianReplace, 0)) },
    { h: "Lowest", num: true, get: (b) => (b.minReplace == null ? "—" : fmt(b.minReplace, 0)) },
    { h: "Highest", num: true, get: (b) => (b.maxReplace == null ? "—" : fmt(b.maxReplace, 0)) },
    { h: "¢ a point, median", num: true, get: (b) => (b.medianRate == null ? "—" : fmt(b.medianRate, 1)) },
    { h: `At ${fmt(pv, 1)} ¢/pt it should buy`, num: true, get: (b) => `${fmt(b.atScale, 0)} ¢` },
    { h: "For example", get: (b) => b.examples },
  ];
  const groupCols = [
    { h: "Group", get: (g) => g.group },
    { h: "Picks", num: true, get: (g) => g.rows },
    { h: "¢ a point, median", num: true, get: (g) => (g.medianRate == null ? "—" : fmt(g.medianRate, 1)), sort: (g) => g.medianRate ?? -1 },
    { h: "Lowest", num: true, get: (g) => (g.minRate == null ? "—" : fmt(g.minRate, 1)) },
    { h: "Highest", num: true, get: (g) => (g.maxRate == null ? "—" : fmt(g.maxRate, 1)) },
    { h: "Bargains", num: true, get: (g) => g.bargains },
    { h: "Overpriced", num: true, get: (g) => g.overpriced },
  ];
  const skillCols = [
    { h: "A point in…", get: (s) => s.name },
    { h: "Group", get: (s) => s.group },
    { h: "Points", num: true, get: (s) => s.points },
    { h: "¢ a turn per point", num: true, get: (s) => fmt(s.perTurnPerPoint, 2) },
    { h: `Over ${params.gameTurns} turns, per point`, num: true, get: (s) => fmt(s.overGamePerPoint, 0) },
  ];
  const curve = E.byPoints.filter((b) => b.medianRate != null && b.rows >= 3);
  const curveLine = curve.length >= 2 ? `Read down the point column and the ¢ a point does not stay flat: ${curve.map((b) => `<b>${fmt(b.medianRate, 1)}</b> at ${b.points} pt`).join(", ")}. A scale where every point buys the same amount of kit would read as one number all the way down.` : "";
  const skillMedian = E.skillPoints.length ? E.skillPoints[Math.floor(E.skillPoints.length / 2)].overGamePerPoint : null;
  const unpriced = E.unpriced.map((u) => `<li><b>${esc(u.name)}</b> (${u.points} pt) — ${esc(u.route)}</li>`).join("");
  return `<section><h2>Buyable gear, point for point</h2>
<p class="lede">Every Item and Asset a player can pick at character creation — ${E.counts.picks} of them, all <code>purchasableAfterStart: false</code>, so the point price is only ever paid out of the ${E.budget.points}-point starting budget — set against what the same thing costs or earns once the game is running. <b>Replace ¢</b> is the cheapest way to come by one in play: the Depot's shelf price where it is stocked, what the counter pays a maker for one (the least a smith would take from you), or making it yourself with ⬢ at the Depot's ${params.rv.buy} ¢, inputs at their price and a Move at ${fmt(E.moveValue, 1)} ¢ (an average mining turn, <code>--move-value</code> changes it); a crate is what it opens into, and a thing nobody stocks or makes is worth at least what the counter pays for it. That is what a point is actually exchanged for, so <b>¢ a point</b> is built on it. <b>Sells for</b> is the counter's guaranteed floor, what the pick liquidates for. <b>How hard</b> is the sourcing model's rank of the easiest in-game route with the creation pick itself left out, and <b>Free with</b> lists the starting kits that hand it out (${E.counts.kits} of the ${E.counts.picks} come free with some role).</p>
<p class="lede">The scale is the rule TAGS.md §4a uses to SET an Item's or Asset's point price, not a rate anything in the game trades at: no code turns points into coin. ${E.pointRoutes.length ? `The one real route from coin to points is ${listAnd(E.pointRoutes.map((r) => `${esc(r.name)}, ${r.price} ¢ on the ${esc(r.shelf)} shelf${r.gate ? ` (it needs a ${esc(r.gate)})` : ""} for ${r.points} points, <b>${fmt(r.perPoint, 1)} ¢ a point</b>`))}, against the ${fmt(pv, 1)} ¢ scale.` : "Nothing in the catalog turns coin into points."} The scale this page measures against is <b>${fmt(pv, 1)} ¢ a point</b>${E.pointValueSet ? ` (set with <code>--point-value</code>; the rule in TAGS.md §4a is 7)` : ` — the rule TAGS.md §4a sets for Items and Assets: a point buys 6–8 ¢ of kit at its in-play price, and 7 is the middle of that. <code>--point-value N</code> tries another`}. The catalog's own median today is ${fmt(E.medianRate, 1)}. On the scale, the whole ${E.budget.points}-point budget is <b>${fmt(E.budget.coin, 0)} ¢</b> of kit, about ${fmt(E.budget.miningTurns, 1)} turns of mining. <b>Fair</b> is what each pick would cost at that rate, <b>Drift</b> is the catalog's price minus that (positive means the player pays more points than the kit is worth), and the verdict says nothing inside ${fmt(E.pointValueRange[0], 1)}–${fmt(E.pointValueRange[1], 1)} ¢ a point. The rule then lets a piece sit one point either side of the line for what it does (TAGS.md §4a lists which), and this page scores by ¢ alone, so those show a point off here on purpose. Today: ${E.counts.bargains} bargains, ${E.counts.onScale} on the scale, ${E.counts.overpriced} overpriced, ${E.unpriced.length} with no ¢ figure at all.</p>
<h3>What a point buys, by price</h3>
<p class="lede">${curveLine} The dashed line in the chart is the scale; a dot above it is more kit than its points paid for, a dot below is less. A larger dot is several picks at the same price and worth, named in its hover text.</p>
${pointScaleChart({ rows: E.rows, pointValue: pv })}
${table({ cols: pointCols, rows: E.byPoints, id: "eqpoints" })}
<h3>Against a point spent on a skill instead</h3>
<p class="lede">The same budget buys skills, and the investments page already prices those in ¢ a turn per point. Played out over the game, a point in a skill returns a median of <b>${skillMedian == null ? "—" : fmt(skillMedian, 0)} ¢</b> against the <b>${fmt(pv, 1)} ¢</b> of kit a point buys here. The two are not the same shape of thing — a skill is paid back through the Moves it occupies, turn after turn, and a piece of gear is had outright on day one and can be sold, lent or stolen — but the gap is the number to hold in mind when asking whether a sword is worth its points.</p>
${table({ cols: skillCols, rows: E.skillPoints, id: "eqskills" })}
<h3>By group</h3>
${table({ cols: groupCols, rows: E.byGroup, id: "eqgroups" })}
<h3>Every pick</h3>
<p class="lede">Weapons carry the tiers they add to the fighting band (COMBAT.md's scale) and the most that combat alone could justify charging for them, at about ${E.pointsPerTier} points a tier — a ceiling, that doc says, not a formula, since a tag's price pays for everything it does. Armour shows the two fractions it turns aside in the game's own words.${E.armorNote.turretReadsBallistic || E.armorNote.attackDocReadsArmour ? ` Both matter, with different readers: ballistic is rolled against by code${E.armorNote.turretReadsBallistic ? " (the turrets, <code>db/lib/depotTurret.js</code>)" : ""}; melee has no mechanical reader${E.armorNote.meleeUnread ? " (the schema says so)" : ""}, but a GM reads its word off the sheet when adjudicating a Gambit or an Attack${E.armorNote.attackDocReadsArmour ? " (<code>ATTACK.md</code>)" : ""}.` : ""} The few pieces that raise somebody's output carry what the investments page says they clear.</p>
${table({ cols, rows: E.rows, filters: [{ label: "Group", get: (r) => r.group }, { label: "How hard", get: (r) => r.rankLabel }, { label: "Verdict", get: (r) => r.verdict ?? "unpriced" }, { label: "Band", get: (r) => r.band }] })}
${armorHtml()}
<h3>No ¢ figure to price them by</h3>
<p class="lede">Nothing stocks these, nobody makes them and the counter does not buy them, so what they are worth is what they do — a Bird carries letters, a Dog smells, a radio reaches every paired bracelet — and that is a judgement this page cannot make for you.</p>
<ul class="head">${unpriced}</ul>
</section>`;
}

// Armour against armour, on the equipment page. The ¢-a-point lens above cannot see that a 3-pt
// shield stops as much as a 9-pt helmet; this table can (db/scripts/analysis/economy/armor.js).
function armorHtml() {
  const A = model.armor;
  const pct = (v) => `${fmt(v * 100, 0)}%`;
  const flagsOf = (r) =>
    [
      ...r.twins.map((x) => `twin of ${x}`),
      ...r.dominatedBy.map((x) => `dominated by ${x}`),
      ...r.outpricedBy.map((x) => `outpriced by ${x}`),
      ...r.heavyFor.map((x) => `heavy for the step over ${x}`),
    ].join("; ");
  const verdictStyle = (r) => (r.verdict === "no use case" ? "color:var(--bad);font-weight:600" : r.verdict === "worth a look" ? "color:var(--c3);font-weight:600" : "");
  const cols = [
    { h: "Piece", get: (r) => r.name },
    { h: "Class", get: (r) => r.cls },
    { h: "Points", num: true, get: (r) => (r.points ? r.points : "—"), sort: (r) => r.points },
    { h: "lb", num: true, get: (r) => r.weight },
    { h: "Melee", num: true, get: (r) => `${fmt(r.melee, 2)} ${r.meleeWord}`, sort: (r) => r.melee },
    { h: "Ballistic", num: true, get: (r) => `${fmt(r.ballistic, 2)} ${r.ballisticWord}`, sort: (r) => r.ballistic },
    { h: "Average", num: true, get: (r) => fmt(r.average, 2), sort: (r) => r.average },
    { h: "Turret: not dying or dead", num: true, get: (r) => pct(r.turret), sort: (r) => r.turret },
    { h: "Make", get: (r) => (r.craft ? `${r.craft.resources} ⬢, ${r.craft.moves} Move${r.craft.moves === 1 ? "" : "s"}, ${r.craft.skills.join(" + ") || "no skill"}${r.craft.items.length ? `, ${r.craft.items.join(" + ")}` : ""}` : r.depot != null ? `Depot ${r.depot} ¢` : "—") },
    { h: "How hard", get: (r) => r.rankLabel, sort: (r) => r.rank },
    { h: "Perks", get: (r) => r.perks.join(", ") },
    { h: "Best in class", get: (r) => r.badges.join(", ") },
    { h: "Flags", get: (r) => flagsOf(r) },
    { h: "Verdict", get: (r) => r.verdict, style: verdictStyle },
  ];
  const bad = A.rows.filter((r) => r.verdict === "no use case");
  const look = A.rows.filter((r) => r.verdict === "worth a look");
  const named = (rs) => rs.map((r) => `<b>${esc(r.name)}</b> (${esc(flagsOf(r))})`).join(", ");
  return `<h3>Armour, piece against piece</h3>
<p class="lede">The ¢-a-point lens above prices a Pavise and a Knight's Helmet the same, because they cost about the same to make per point — and says nothing about the Pavise stopping as much as the helmet for a third of the points. Armour is for turning blows aside, so this table puts every wearable piece on that footing: the two fractions it stops (in the catalog's own words), what one burst from the Depot turret leaves of a wearer in that piece alone (DEPOT.md §0i — the one place ballistic armour is rolled by code), and what it costs in points, pounds, ⬢ and access. Pieces are compared inside their <b>class</b> — the slot, and the layer for the body, since two things worn together are not alternatives — except for <b>outpriced</b>, which looks across the whole catalog for a piece at half the points that stops as much. <b>Twin</b> is a cosmetic variant; <b>dominated</b> means another piece in the class is at least as good on every count, perks included, and better on one; <b>heavy for the step</b> means a rival at half the weight, and ${A.heavyGap} lb or more lighter, stops within ${fmt(A.step, 1)} of it on the average — half a word. Role kit and loot are listed for reference and take no part. ${A.counts.noUseCase ? `Today <b>${A.counts.noUseCase}</b> ${A.counts.noUseCase === 1 ? "piece has" : "pieces have"} no use case: ${named(bad)}.` : "Today every piece a player can come by has a use case."} ${look.length ? `Worth a look: ${named(look)}.` : ""}</p>
${table({ cols, rows: A.rows, id: "armour", filters: [{ label: "Class", get: (r) => r.cls }, { label: "Verdict", get: (r) => r.verdict }, { label: "How hard", get: (r) => r.rankLabel }] })}`;
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
    { label: `Mood cost of a 1 (¢), ${-C.troubleMoodBase} mood at ${fmt(params.moodPointPrice, 2)} ¢ a point`, caves: fmt(P.caves.troubleMood, 1), depths: fmt(P.depths.troubleMood, 1) },
    { label: `Danger, per arrival (¢), a 1 on 1 in ${fmt(C.arrivalsPerTrouble.base, 0)}: wounds and mood`, caves: fmt(P.caves.base.danger, 2), depths: fmt(P.depths.base.danger, 2) },
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
  // The trouble budget: every figure is one expedition that stops at the T-th 1.
  const zoneName = (z) => (z === "caves" ? "Caves" : "Depths");
  const budgetCols = [
    { h: "Where", get: (r) => zoneName(r.zone) },
    { h: "Stops at troubles", num: true, get: (r) => r.T },
    { h: "", get: (r) => (r.who === "base" ? "no Lucky" : "Lucky") },
    { h: "Arrivals", num: true, get: (r) => fmt(r.arrivals, 0), sort: (r) => r.arrivals },
    { h: "Finds", num: true, get: (r) => fmt(r.finds, 1), sort: (r) => r.finds },
    { h: "Loot ¢", num: true, get: (r) => fmt(r.loot, 1), sort: (r) => r.loot },
    { h: "Wounds ¢", num: true, get: (r) => fmt(r.wound, 1), sort: (r) => r.wound },
    { h: "Mood ¢, plain", num: true, get: (r) => fmt(r.mood.plain, 1), sort: (r) => r.mood.plain },
    { h: "Mood ¢, Brave", num: true, get: (r) => fmt(r.mood.brave, 1), sort: (r) => r.mood.brave },
    { h: "Mood ¢, Teratophobia", num: true, get: (r) => fmt(r.mood.teratophobia, 1), sort: (r) => r.mood.teratophobia },
    { h: "Net ¢", num: true, get: (r) => fmt(r.net, 1), sort: (r) => r.net, style: (r) => (r.net < 0 ? "color:var(--bad)" : "") },
    { h: "Deaths per 100 expeditions", num: true, get: (r) => fmt(r.deaths * 100, 1), sort: (r) => r.deaths },
  ];
  const budgetChart = (zone) =>
    lineChart({
      xLabels: C.BUDGETS.map((T) => `${T}`),
      series: [
        { label: "no Lucky", color: "var(--c0)", values: C.BUDGETS.map((T) => C.expedition(zone, T, "base").net) },
        { label: "Lucky", color: "var(--c1)", values: C.BUDGETS.map((T) => C.expedition(zone, T, "lucky").net) },
      ],
      xTitle: "troubles eaten before stopping",
      yTitle: "net ¢ an expedition",
      fmtVal: (v) => `${fmt(v, 1)} ¢`,
    });
  const posText = (zone) => {
    const p = C.positiveAt(zone, "base");
    const l = C.positiveAt(zone, "lucky");
    return `the ${zoneName(zone)} ${p != null ? `pay from a budget of ${p}` : "never pay"} without Lucky and ${l != null ? `from ${l}` : "never"} with it`;
  };
  const tagText = (list) => listAnd(list.map((t) => (t.factor < 0 ? `${esc(t.name)} turns it into a gain of ${fmt(-t.factor * 100, 0)}%` : `${esc(t.name)} ×${fmt(t.factor, 2)}`)));
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
<p class="lede">The die rolls once on every arrival in the Caves or the Depths and there is no cap. In the code a <b>6 is a find</b> (a draw off the loot table) and a <b>1 is trouble</b> (a GM decides what happens, and nothing applies by itself); 2 to 5 is nothing. The danger below is priced on the trouble face, the 1, at 1 in 6 an arrival, and the loot on the 6 at the same odds.</p>
<h3>What a find is worth</h3>
<p class="lede">Each item is valued at the better of what the Depot pays or what it gives when opened or consumed (a Supply Kit is 8 ⬢, a Purse is 3 obols). An item the Depot only sells is <b>estimated</b> at ${fmt(params.sellBackShare * 100, 0)}% of its shelf price and kept out of the headline, so one key cannot carry a table. The ${fmt(Z.caves.unpricedShare * 100, 0)}% (Caves) and ${fmt(Z.depths.unpricedShare * 100, 0)}% (Depths) of finds with no price at all (rocks, curiosities, tools, keys, a mastery tag) count as nothing, so the loot figures are a floor.</p>
${table({ cols: summaryCols, rows: summary, id: "cavsum" })}
<h3>Where the value sits</h3>
<p class="lede">Expected ¢ per find, by tier, with the tier's share of finds beside it. The Caves live off the two ultracommon finds (Cave Fungus and Saltpeter) and cheap gear; the Depths' value comes from the rare tiers.</p>
${barChart({ rows: tierBars("caves", "var(--c1)"), unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 230 })}
${barChart({ rows: tierBars("depths", "var(--c3)"), unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 230 })}
<h3>Every item that can drop</h3>
${table({ cols: lootCols, rows: items, filters: [{ label: "Tier", get: (r) => tierLabel[r.tier] ?? r.tier }, { label: "Valued", get: (r) => r.basis.replace(/\s*\(.*\)/, "") }] })}
<h3>A note on danger</h3>
<p class="lede"><b>This part is the GM's call</b> (the <code>cavingmonsters</code> document and the Caving lens), so what follows is an assumption written down. A 1 costs what it takes to heal what the GM lets happen, read off the cure ladder (<code>TAGS.md</code> §5c), and the medic's Moves are priced at ${fmt(C.moveValue, 1)} ¢. In the Caves at least a minor wound, mostly; in the Depths a major wound, a lost limb or death is the likely outcome. Death has no cure and is counted, not priced. A 1 also costs ${-C.troubleMoodBase} mood, priced here at ${fmt(C.troubleMood.plain, 1)} ¢ (${fmt(C.troubleMood.brave, 1)} for somebody Brave, ${fmt(C.troubleMood.teratophobia, 1)} with Teratophobia), and pins you in the zone until the turn ends.</p>
${table({ cols: woundCols, rows: Object.values(C.wounds), id: "cavwounds" })}
<p class="lede">The result is that the loot does not pay for the danger. At the Caves a find is worth about ${fmt(Z.caves.evArrival, 2)} ¢ an arrival against ${fmt(P.caves.base.danger, 2)} ¢ of wound and mood, so even an all-minor mix (${fmt(C.wounds.minor.total, 1)} ¢ a trouble) loses; the loot would need every trouble to cost under ${fmt(P.caves.breakEvenWound, 1)} ¢. The Depths are ${fmt(Z.depths.evArrival / Z.caves.evArrival, 1)} times richer but their trouble is dearer, and only a mostly-minor mix breaks even. Anybody who heals for free (a friend who is a medic) sees the loot alone, which is a small positive.</p>
<h3>How far to push: a trouble budget</h3>
<p class="lede">Arrivals are rationed only by the 3-second cool-down between walks, so what stops a caver is not the clock but nerve. Bascinet's calibration: "1–3 rolls of 1 will stop a non-equipped player, 5 would be spooky for someone prepared, and 10 is nearly suicidal." So each row is one expedition that walks until its T-th 1 and stops. A 1 comes up 1 in ${fmt(C.arrivalsPerTrouble.base, 0)} arrivals, and 1 in ${fmt(C.arrivalsPerTrouble.lucky, 0)} with Lucky (read off the game's own dice), so Lucky buys <b>${fmt(C.arrivalsPerTrouble.lucky / C.arrivalsPerTrouble.base, 0)} times the arrivals per trouble</b>, and the finds that come with them. Every trouble costs its wounds (the mix above) and ${fmt(-C.troubleMoodBase, 0)} mood, priced at ${fmt(params.moodPointPrice, 2)} ¢ a point: ${fmt(C.troubleMood.plain, 1)} ¢ plain. The tags that scale that hit, from mood.js's own table: ${tagText(C.moodTags.trouble)}${C.moodTags.trouble.some((t) => t.factor === 0) ? `; only ${listAnd(C.moodTags.trouble.filter((t) => t.factor === 0).map((t) => esc(t.name)))} cancels it` : "; none cancels it"}. At these budgets ${posText("caves")}, and ${posText("depths")}. The mood of simply arriving underground (a smaller hit, capped a turn) is left out here and priced on the by-family page.</p>
${budgetChart("caves")}
${budgetChart("depths")}
${table({ cols: budgetCols, rows: C.budgets, filters: [{ label: "Where", get: (r) => zoneName(r.zone) }] })}
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
    { h: "Smithing + Lucky", num: true, get: (c) => fmt(c["apprentice-lucky"], 1), sort: (c) => c["apprentice-lucky"] },
    { h: "Smithing II + Lucky", num: true, get: (c) => fmt(c["skilled-lucky"], 1), sort: (c) => c["skilled-lucky"] },
    ...extra,
  ];
  const wageTop = T.shelfLoop.topWage;
  const shelf = T.combos.bestShelf;
  const proRows = [];
  for (const [key, label] of [["caves:plain", "Caves, pick only"], ["caves:skilled", "Caves, Prospecting"], ["depths:plain", "Depths, pick only"], ["depths:skilled", "Depths, Prospecting"]])
    for (const h of [T.holders[0], T.holders[1]]) {
      const r = T.prospector[key][h.id];
      proRows.push({ where: label, smith: h.label, stones: r.stones, trinkets: r.trinkets, revenue: r.revenue, forgone: r.forgone, net: r.net, perTurn: r.net * params.mineDuty });
    }
  const proCols = [
    { h: "Mining", get: (r) => r.where },
    { h: "Smith", get: (r) => r.smith },
    { h: "Stones a press", num: true, get: (r) => fmt(r.stones, 2), sort: (r) => r.stones },
    { h: "Trinkets a press", num: true, get: (r) => fmt(r.trinkets, 2), sort: (r) => r.trinkets },
    { h: "They sell for ¢", num: true, get: (r) => fmt(r.revenue, 1), sort: (r) => r.revenue },
    { h: "Raw sale forgone ¢", num: true, get: (r) => fmt(r.forgone, 1), sort: (r) => r.forgone },
    { h: "Net a press ¢", num: true, get: (r) => fmt(r.net, 1), sort: (r) => r.net },
    { h: `Net a turn ¢ (a press one turn in ${fmt(1 / params.mineDuty, 0)})`, num: true, get: (r) => fmt(r.perTurn, 1), sort: (r) => r.perTurn },
  ];
  const ark = T.combos.ark;
  return `<section><h2>Trinket forging</h2>
<p class="lede">A smith spends <b>a whole Move and ${T.gate.resources} ⬢</b> (${T.dieCost} ¢ at the Depot's import price), slots up to ${T.gate.slotsMax} stones, and rolls a d6. The face is a tier, and the counter pays <code>round(base + multiplier × the stones' summed inlay)</code>. A Smithing II smith never rolls below face ${T.gate.floorFace}. Lucky rolls twice and keeps the better. Nothing else touches the die (no hunger or mood modifier), so the four smiths below are the whole story.</p>
${table({ cols: holderCols, rows: T.holders, id: "trinholders" })}
${table({ cols: tierCols, rows: T.tiers.map((t, i) => ({ face: i + 1, ...t })), id: "trintiers" })}
<p class="lede">A Trinket with no stones at all clears ${fmt(T.holders[0].bareRaw, 1)} ¢ a Move for a Smithing smith and ${fmt(T.holders[1].bareRaw, 1)} for Smithing II before tax (${fmt(T.holders[0].bareProfit, 1)} and ${fmt(T.holders[1].bareProfit, 1)} at a ${params.sellTaxRate}% sell tax), against a wage table that pays ${fmt(model.profitTiers.find((t) => t.points === 5)?.rate, 0)} and ${fmt(model.profitTiers.find((t) => t.points === 10)?.rate, 0)} raw. Every Trinket figure below is at the run's tax unless it says raw. The floor is worth ${fmt(T.holders[1].bareRaw - T.holders[0].bareRaw, 1)} ¢ a Move bare, and Lucky ${fmt(T.holders[2].bareRaw - T.holders[0].bareRaw, 1)}.</p>
<h3>What each stone is worth forged</h3>
<p class="lede">Every stone inlays for <code>2 × its sell price + 4</code>, held one under the shelf price where the Merchant stocks it, so a smith turns a 1 ¢ ore into about ${fmt(T.holders[0].eMult * 6, 0)} ¢ of price. The right-hand columns are what forging adds over selling the stone raw, at the average multiplier.</p>
${table({ cols: stoneCols, rows: T.stones, filters: [{ label: "Group", get: (r) => r.group }] })}
<h3>The best Trinkets from stones you dug up</h3>
<p class="lede">Profit a Move, the stones counted at what they would have sold for. The Arkenstone is left out of the ranking (it drops on about one Depths press in a hundred); with a Black Diamond it makes a Trinket worth about <b>${fmt(ark?.skilled, 0)} ¢</b> a Move to Smithing II over selling both raw.</p>
${table({ cols: comboCols(), rows: T.combos.bestOwn })}
<h3>Forging what you bought at the shelf</h3>
<p class="lede">The doc says a stone that inlays for at least the shelf price could be bought, forged and sold at a profit forever, and holds each one a coin under. <b>That does not close the loop</b>: a Trinket also pays its tier's bare price and a multiplier above 1, so a round trip through the counter pays even with every stone capped. The best is <b>${fmt(T.shelfLoop.bestApprentice?.apprenticeRaw, 1)} ¢ a Move</b> raw (${fmt(T.shelfLoop.bestApprentice?.apprentice, 1)} at the run's tax) for a Smithing smith and <b>${fmt(T.shelfLoop.bestSkilled?.skilledRaw, 1)} ¢</b> raw (${fmt(T.shelfLoop.bestSkilled?.skilled, 1)} taxed) for Smithing II, against a wage table whose top rung is ${wageTop} ¢ raw. <b>Lucky lifts that further</b>: it keeps the better of two dice, so the same round trip clears ${fmt(T.shelfLoop.bestApprenticeLucky?.["apprentice-luckyRaw"], 1)} ¢ raw for a Smithing smith and <b>${fmt(T.shelfLoop.bestSkilledLucky?.["skilled-luckyRaw"], 1)} ¢</b> for Smithing II. It needs a Merchant's licence for the shelf and nothing else. The columns below are at a ${params.sellTaxRate}% sell tax.</p>
${table({ cols: comboCols(), rows: shelf })}
<h3>A prospector who forges what they dig up</h3>
<p class="lede">Every stone that drops is forged in pairs on the rest turn a miner has anyway. The net is what the Trinkets sell for, less the ⬢ they cost and the raw sale of the stones. It is the best use of a miner's spare Move in this report: about <b>${fmt(T.prospector["caves:plain"].apprentice.net, 1)} ¢ a press</b> at the Caves with only a pick, on top of the ${fmt(model.activities.find((a) => a.id === "mine:Caves:unskilled")?.perAction, 1)} ¢ the press itself pays.</p>
${table({ cols: proCols, rows: proRows, filters: [{ label: "Mining", get: (r) => r.where }] })}
</section>`;
}

function sectionCooking() {
  const C = model.cooking;
  const moodPhrase = C.moodWeight === 1 ? "hunger and mood, a point of either counted the same" : `hunger and mood, a point of mood counted as ${fmt(C.moodWeight, 2)} of hunger`;
  const raw = C.strategies.find((x) => x.id === "raw-foodstuffs");
  const staple = model.foods.find((f) => f.slug === params.stapleCrop);
  const cooked = C.strategies.find((x) => x.id === "cooked");
  const fert = C.strategies.find((x) => x.id === "cooked-fert");
  const A = C.cookAdds;
  // basic-meal is the example dish for "what a cook can slot in": the one Basic, crop-only meal class.
  const example = C.dishes.find((d) => d.slug === "basic-meal") ?? C.dishes[0];
  const maxCropHunger = staple?.hunger ?? 0;
  const rawMood = model.cooking.rawFoodMood;
  const stratCols = [
    { h: "How the town eats", get: (r) => r.label },
    { h: "Hunger a crop", num: true, get: (r) => fmt(r.hungerPerCrop, 1), sort: (r) => r.hungerPerCrop },
    { h: "Crops a turn", num: true, get: (r) => fmt(r.cropsPerTurn, 0), sort: (r) => r.cropsPerTurn },
    { h: "Farm actions a turn", num: true, get: (r) => fmt(r.farmActionsPerTurn, 1), sort: (r) => r.farmActionsPerTurn },
    { h: "Farmers needed", num: true, get: (r) => fmt(r.farmers, 1), sort: (r) => r.farmers },
    { h: "Cooks, full time (a Move a turn each)", num: true, get: (r) => (r.cooks ? fmt(r.cooks, 1) : "—"), sort: (r) => r.cooks },
    { h: "Spare Moves the farmers have", num: true, get: (r) => fmt(r.freeFarmerMoves, 1), sort: (r) => r.freeFarmerMoves },
    { h: "Cooks still needed", num: true, get: (r) => (r.cooks ? fmt(r.extraCooks, 1) : "—"), sort: (r) => r.extraCooks },
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
    { h: `Dishes a turn to feed ${players}`, num: true, get: (d) => fmt(d.dishesToFeedTown, 0), sort: (d) => d.dishesToFeedTown ?? 0 },
    { h: "Full-time cooks to feed them", num: true, get: (d) => fmt(d.cooksToFeedTown, 1), sort: (d) => d.cooksToFeedTown ?? 0 },
    { h: "Inputs cost ¢", num: true, get: (d) => fmt(d.cost, 1), sort: (d) => d.cost },
    { h: "Depot pays ¢", num: true, get: (d) => d.sell ?? "—", sort: (d) => d.sell ?? -1 },
    { h: "Worth at the box's price ¢", num: true, get: (d) => fmt(d.value, 1), sort: (d) => d.value ?? 0 },
    { h: "Margin a Move ¢", num: true, get: (d) => (d.marginPerMove == null ? "—" : fmt(d.marginPerMove, 0)), sort: (d) => d.marginPerMove ?? -1e9 },
    { h: "Hardest input to get", get: (d) => (d.hardestRank >= 5 ? `no way in: ${d.unreachable.join(", ")}` : `rank ${d.hardestRank}`) },
  ];
  const bars = C.dishes.slice(0, 22).map((d) => ({ label: `${d.name}${d.tier === "Skilled" ? " *" : ""}`, value: d.hungerPerUnit, color: d.unreachable.length ? "var(--bad)" : d.farmOnly ? "var(--c3)" : "var(--c1)" }));
  const slotCols = [
    { h: "Slot it in", get: (a) => a.name },
    { h: "Adds hunger", num: true, get: (a) => a.hunger, sort: (a) => a.hunger },
    { h: "Adds mood", num: true, get: (a) => a.mood, sort: (a) => a.mood },
    { h: "Costs ¢", num: true, get: (a) => (a.cost == null ? "—" : `${a.costEstimated ? "≈" : ""}${fmt(a.cost, 1)}`), sort: (a) => a.cost ?? -1 },
    { h: "Where it comes from", get: (a) => a.source },
  ];
  return `<section><h2>Cooks against farmers</h2>
<p class="lede">A person burns ${params.hungerDecay} hunger a turn, so ${players} players need <b>${fmt(C.need, 0)} hunger</b> a turn. One Farm action sows ${fmt(params.farmMaxCrops, 0)} crops and reaps about ${fmt(C.harvest, 1)} Foodstuffs, one turn in ${params.farmCycle}. <b>Yes, a cook is worth more than a farmer eating raw</b>: cooking a pair of Foodstuffs into ${esc(C.cropDish?.name ?? "a meal")} gives ${fmt(C.cropDish?.hungerPerUnit, 1)} hunger a Foodstuff against ${fmt(raw.hungerPerCrop, 0)} raw (×${fmt(C.cropDish?.hungerPerUnit / raw.hungerPerCrop, 2)}), for ${fmt(C.cropDish?.moves, 3)} of a Move a dish. That takes the farmers needed from ${fmt(raw.farmers, 1)} to <b>${fmt(cooked.farmers, 1)}</b> (${fmt(fert.farmers, 1)} with Fertilizer), and the cooking is <b>${fmt(cooked.cooks, 2)} full-time cooks</b> (a cook works one Move a turn, and crafting never tires anyone) and ${cooked.cookMoves <= cooked.freeFarmerMoves ? `fits in the Moves a farmer has spare between Farm actions (${fmt(cooked.cookMoves, 2)} needed, ${fmt(cooked.freeFarmerMoves, 1)} spare), so a farmer-cook adds no headcount` : `needs ${fmt(cooked.cookMoves, 2)} Moves a turn against ${fmt(cooked.freeFarmerMoves, 1)} the farmers have spare, so about ${fmt((cooked.cookMoves - cooked.freeFarmerMoves), 2)} Moves of cooking a turn have to come from somebody else: the farmers can no longer cook it all themselves`}. There is no field pool behind any of this any more: "farmers needed" falls straight out of demand over supply.</p>
${table({ cols: stratCols, rows: C.strategies, id: "cookstrat" })}
${C.boxStrategy ? `<p class="lede">${esc(C.boxStrategy.note)} A Ration Box eater needs no farmer, so the Depot is the third way to be fed.</p>` : ""}
<p class="lede">Per Move, ${A.farmPersonTurnsPerMove >= (A.cookPersonTurnsPerMove ?? 0) ? "farming still wins" : "cooking wins"}: one Farm action is ${fmt(A.farmPersonTurnsPerMove, 1)} person-turns of food for a Move, and the cooking on that harvest adds ${fmt(A.gainPersonTurns, 1)} person-turns for ${fmt(A.movesPerAction, 3)} Moves, ${fmt(A.cookPersonTurnsPerMove, 1)} a Move. But Moves are not what limits a farmer (the fatigue ladder is), and the raw diet costs ${String(C.rawMoodStaple).replace("-", "−")} mood a bite: ${fmt(raw.bitesPerPersonTurn, 1)} bites a person-turn is <b>${fmt(raw.moodPerPersonTurn, 0)} mood</b>, against ${fmt(cooked.moodPerPersonTurn, 0)} for one cooked bite.</p>
<h3>The three meal classes</h3>
<p class="lede">Cooking is three templates now, not a list of named recipes (the Soilery Rework): Basic Meal (Cooking, 2 Foodstuffs, ${fmt(C.dishes.find((d) => d.mealClass === "basic")?.hunger)} hunger, ${fmt(C.dishes.find((d) => d.mealClass === "basic")?.mood)} mood, ${fmt(C.dishes.find((d) => d.mealClass === "basic")?.moves, 2)} of a Move), Skilled Meal (Cooking II, 2 Foodstuffs, ${fmt(C.dishes.find((d) => d.mealClass === "skilled")?.hunger)} hunger, ${fmt(C.dishes.find((d) => d.mealClass === "skilled")?.mood)} mood, ${fmt(C.dishes.find((d) => d.mealClass === "skilled")?.moves, 2)} of a Move) and Lavish Meal (Cooking II, 3 Foodstuffs plus at least one extra ingredient and a kitchen, ${fmt(C.dishes.find((d) => d.mealClass === "lavish")?.hunger)} hunger, ${fmt(C.dishes.find((d) => d.mealClass === "lavish")?.mood)} mood, ${fmt(C.dishes.find((d) => d.mealClass === "lavish")?.moves, 2)} of a Move). Every extra ingredient adds its own cooked hunger and mood on top (COOKING.md), whichever class it rides on.</p>
${barChart({ rows: bars, unit: " hunger", fmtVal: (v) => fmt(v, 1), labelW: 170 })}
<h3>Every dish, cost against worth</h3>
<p class="lede">One dot a dish: what its ingredients cost against what its hunger and mood are worth, both at the Ration Box's own rate (${fmt(C.boxPerPoint, 3)} ¢ a point — ${moodPhrase}). The dashed line is parity with the box itself — a dish on it costs exactly what a Ration Box would for the same hunger and mood. Green sits at or above the line (better than Rations); red sits under it. Hover a dot for the name and numbers.</p>
${dishValueChart({ dishes: C.dishes })}
<h3>Every dish</h3>
<p class="lede">"Worth at the box's price" is what the same hunger AND mood together cost from a Ration Box (${fmt(C.boxPerPoint, 3)} ¢ a point — ${moodPhrase}; ${fmt(C.boxPerHunger, 3)} ¢ a point of hunger alone, for comparison), so the Skilled and Lavish classes' mood counts for something here and not just their food — the whole reason anyone bothers with either. The margin is what a cook could ask above the inputs. The Depot pays only its floor for a dish (the "Sells" column), so a cook's pay above that is whatever another player agrees to.</p>
${table({ cols: dishCols, rows: C.dishes, filters: [{ label: "Tier", get: (d) => d.tier }] })}
<h3>What a cook can slot in</h3>
<p class="lede">Any dish takes up to ${Math.max(...C.dishes.map((d) => d.mealSlots))} extra ingredients (Lavish wants at least ${Math.max(...C.dishes.map((d) => d.minSlots))}), each adding its own hunger and, if positive, its mood — any tag with a <code>cooked:</code> block, not a fixed list per recipe any more (COOKING.md). A slot never beats the base for food (Foodstuffs adds ${maxCropHunger} hunger at most, what eating one raw gives) but it is where a cook buys mood, and the raw ${String(rawMood).replace("-", "−")} does not apply. ${example && C.richestSlot ? `The richest slot-in is ${esc(C.richestSlot.name)} at ${C.richestSlot.hunger}, so a ${esc(example.name)} with its ${example.mealSlots} slots filled restores at most ${Math.min(params.hungerMax, example.hunger + example.mealSlots * C.richestSlot.hunger)}${example.hunger + example.mealSlots * C.richestSlot.hunger > params.hungerMax ? ", the meter's cap" : ` (the meter tops out at ${params.hungerMax})`}.` : ""} A ${"≈"}-marked cost is not a real price: the ingredient has none of its own (usually Foodstuffs), so it is priced the way the dishes above are, at ${fmt(C.boxPerPoint, 3)} ¢ a point (${moodPhrase}), off the Ration Box.</p>
${table({ cols: slotCols, rows: C.addIns.slice(0, 14) })}
</section>`;
}


function sectionDesires() {
  const D = model.desires;
  const open = D.satisfiers.filter((r) => r.open && !r.once).sort((a, b) => a.netCoin / a.tier - b.netCoin / b.tier);
  const gated = D.satisfiers.filter((r) => !r.open && !r.once).sort((a, b) => a.netCoin / a.tier - b.netCoin / b.tier);
  const bigTicket = D.satisfiers.filter((r) => r.once).sort((a, b) => b.netCoin - a.netCoin);
  const cols = () => [
    { h: "Desire", get: (r) => r.name },
    { h: "Tier", num: true, get: (r) => r.tier, sort: (r) => r.tier },
    { h: "Cooldown", num: true, get: (r) => `${r.cooldown} ${r.cooldownFromLadder ? "" : "(the tier)"}`.trim(), sort: (r) => r.cooldown },
    { h: "To satisfy it", get: (r) => r.doThis },
    { h: "Costs ¢", num: true, get: (r) => (r.capital && !r.coin ? `${r.capital} held` : fmt(r.coin, 1)), sort: (r) => r.coin },
    { h: "After resale ¢", num: true, get: (r) => (r.resale ? fmt(r.netCoin, 1) : "—"), sort: (r) => r.netCoin },
    { h: "¢ a point", num: true, get: (r) => fmt(r.netCoin / r.tier, 1), sort: (r) => r.netCoin / r.tier },
    { h: "Points a turn if repeated", num: true, get: (r) => fmt(r.pointsPerTurn, 2), sort: (r) => r.pointsPerTurn },
    { h: "Checked by", get: (r) => r.checkedBy },
    // Bold in the accent colour when a role or tag gates it, so a lock reads at a glance.
    { h: "Locked to", get: (r) => r.who, style: (r) => (r.open ? "" : "color:var(--accent);font-weight:600") },
    { h: "Notes", get: (r) => [r.how, r.note].filter(Boolean).join(". ") },
  ];
  const planCols = [
    { h: "Play", get: (p) => p.label },
    { h: `Points over ${params.gameTurns} turns`, num: true, get: (p) => p.points, sort: (p) => p.points },
    { h: "Coin spent ¢", num: true, get: (p) => fmt(p.coin, 0), sort: (p) => p.coin },
    { h: "¢ a point", num: true, get: (p) => fmt(p.perPoint, 1), sort: (p) => p.perPoint },
    { h: "Coin held ¢", num: true, get: (p) => p.capital, sort: (p) => p.capital },
    {
      h: "What it claimed",
      get: (p) =>
        p.used
          .slice(0, 5)
          .map((u) => {
            const sat = D.satisfiers.find((s) => s.slug === u.slug);
            return `${sat?.name ?? u.slug} ×${u.n}${sat && !sat.open ? ` (needs ${sat.who})` : ""}`;
          })
          .join(", "),
    },
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
  const hold = D.satisfiers.find((r) => r.slug === "hold-100");
  const holdLadder = hold ? model.desireLadder[hold.tier] : null;
  const ride = D.satisfiers.find((r) => r.slug === "metal-ride");
  return `<section><h2>Desires as an income</h2>
<p class="lede">A Desire pays its <b>tier in Tag Points</b> and is claimed afterwards. Of ${D.count.total} in the catalog, <b>${D.count.satisfiable}</b> can be satisfied by buying, making, consuming or owning something, and ${D.count.open} of those are open to anybody. Of the rest, ${D.count.roleOnly} ${D.count.roleOnly === 1 ? "is" : "are"} locked to a role, ${D.count.tagOnly} to a tag, and ${D.count.both} to both. A claim is adjudicated by a GM: ${D.count.verified} of the ${D.count.satisfiable} priced here carry a <code>verify:</code> string the GM desk searches the audit log with, and ${D.count.satisfiable - D.count.verified} rest on judgement alone. Every satisfier that can be priced is kept, on the assumption that a reasonable GM approves it. What limits a person is not the catalog but the slots: ${D.slots} slots that each lock for ${D.lockTurns} turn after a claim allow at most <b>${fmt(D.claimsPerTurn, 0)} claim a turn</b>, so the ceiling is one Desire a turn at the highest tier that is off cooldown. A character starts with ${D.startingPoints} points to spend.</p>
<p class="lede">The catalog does not price its Desires, so the satisfier beside each one is my reading of its wording and the price comes from the tag catalog. <b>The gate is a claim a GM reviews</b> (the player must say how they did it and a GM can reject it), so what follows is what the rules allow, not what a GM would let stand.</p>
<h3>What it turns into</h3>
<p class="lede">Played out over ${params.gameTurns} turns with one claim a turn and the gambling left out, the open Desires pay <b>${best.points} points for ${fmt(best.coin, 0)} ¢</b> if a person will carry ${best.capital} ¢ and can get Godflesh, and <b>${cheap.points} points for ${fmt(cheap.coin, 0)} ¢</b> (${fmt(cheap.perPoint, 1)} ¢ a point) if all they do is buy consumables off a shelf. Set that against what a point buys: <b>${D.buys[0]?.name}</b> pays ${fmt(D.buys[0]?.perPoint, 1)} ¢ a turn for every point spent, and ${D.buys.find((b) => b.name === "Soilery")?.name ?? "Soilery"} ${fmt(D.buys.find((b) => b.name === "Soilery")?.gain, 1)} ¢ a turn for ${D.buys.find((b) => b.name === "Soilery")?.points} points, so the coin behind a point is repaid many times over. Desires are a converter from a few coin into skills, and the throttle on it is the slot lock, not the price.</p>
${table({ cols: planCols, rows: D.plans, id: "desireplans" })}
<h3>What a point buys</h3>
<p class="lede">From the investment table, per point spent. The last column is what a point is worth over the game if the thing it buys is bought at once.</p>
${table({ cols: buyCols, rows: D.buys })}
<h3>Open to anybody, repeatable</h3>
<p class="lede">Every drink, smoke, drug and sweet sits on a flat 3-turn cooldown by design, so three of them in rotation fill the one claim a turn. ${hold ? `<b>Hold 100 ¢</b> is the free one: it costs nothing per attempt, so the policy in <code>desires.yaml</code> puts it on the ${holdLadder}-turn ladder${hold.cooldown >= holdLadder ? `, and it is there: a ${hold.cooldown}-turn cooldown` : `, but it is on ${hold.cooldown} turns instead`}, for ${hold.tier} point${hold.tier === 1 ? "" : "s"} every ${hold.cooldown} turns from anybody with 100 ¢ in the pocket.` : ""}</p>
${table({ cols: cols(), rows: open, id: "desireopen" })}
<h3>Gated by a role or a tag</h3>
${table({ cols: cols(), rows: gated, id: "desiregated" })}
<h3>Once per game, and the big tickets</h3>
<p class="lede">${ride ? `A Motorcycle is ${ride.coin} ¢ at the shelf and sells back for ${ride.resale}, so the Desire costs about ${fmt(ride.netCoin, 0)} ¢ for ${ride.tier} points (${esc(ride.who)}).` : ""} The tier 4 and 5 goals (a manor, buying your freedom, the Arkenstone) are not on any shelf and are not priced here.</p>
${table({ cols: cols(), rows: bigTicket, id: "desirebig" })}
</section>`;
}

function sectionStarting() {
  const S = ST;
  const seatsOf = (r) => (r.unlimited ? "no cap" : r.seats);
  const roomsText = (r) => {
    if (!r.rooms.length) return "none";
    const top = [...r.rooms].sort((a, b) => b.resources + b.coin + b.food - (a.resources + a.coin + a.food)).slice(0, 4).map((x) => x.name);
    return `${r.rooms.length}: ${top.join(", ")}${r.rooms.length > 4 ? `, +${r.rooms.length - 4} more` : ""}`;
  };
  const keyedText = (r) => {
    const bits = [];
    if (r.keyedResources) bits.push(`${fmt(r.keyedResources, 0)} ⬢`);
    if (r.keyedCracked) bits.push(`${fmt(r.keyedCracked, 0)} ⬢ in items`);
    if (r.keyedCoin) bits.push(`${fmt(r.keyedCoin, 0)} ¢`);
    if (r.keyedFood) bits.push(`${fmt(r.keyedFood, 0)} hunger`);
    if (r.keyedKit.length) bits.push(`kit: ${r.keyedKit.slice(0, 4).join(", ")}${r.keyedKit.length > 4 ? ", …" : ""}`);
    return bits.length ? bits.join(", ") : "nothing";
  };
  const roleCols = [
    { h: "Role", get: (r) => r.name },
    { h: "Group", get: (r) => r.groupName },
    { h: "Seats", num: true, get: seatsOf, sort: (r) => r.seats ?? 999 },
    { h: "Bank ¢", num: true, get: (r) => (r.account ? r.bank : "no account"), sort: (r) => r.bank },
    { h: "In hand ¢", num: true, get: (r) => r.coinHand, sort: (r) => r.coinHand },
    { h: "⬢ on person", num: true, get: (r) => (r.cracked ? `${r.resources} (+${r.cracked} in items)` : r.resources), sort: (r) => r.resources + r.cracked },
    { h: "Food on person", get: (r) => (r.food ? `${fmt(r.food, 0)} hunger: ${r.foodItems.join(", ")}` : "none"), sort: (r) => r.food },
    { h: "Cooking supplies (crops → dishes, Moves)", get: (r) => (r.crops ? `${r.crops} crops → ${fmt(r.dishes, 0)} dishes, ${fmt(r.cookMoves, 2)} Move` : "—"), sort: (r) => r.crops },
    { h: "Person-turns fed if cooked", num: true, get: (r) => (r.foodCooked ? fmt(r.foodCooked / S.decay, 1) : "—"), sort: (r) => r.foodCooked },
    { h: "Starving at turn", num: true, get: (r) => (Number.isFinite(r.starveTurn) ? r.starveTurn : "never"), sort: (r) => r.starveTurn },
    { h: "Dying at turn", num: true, get: (r) => (Number.isFinite(r.dyingTurn) ? r.dyingTurn : "never"), sort: (r) => r.dyingTurn },
    { h: "Turns of food if all coin is spent on rations", num: true, get: (r) => (Number.isFinite(r.turnsWithFunds) ? fmt(r.turnsWithFunds, 1) : "endless"), sort: (r) => r.turnsWithFunds },
    { h: "Crafting kit on person", get: (r) => (r.kit.length ? r.kit.join(", ") : "—") },
    { h: "Keys and passes", get: (r) => (r.keys.length ? r.keys.join(", ") : "—") },
    { h: "Locked doors between places that it can pass", get: (r) => (r.doors.length ? r.doors.join("; ") : "—") },
    { h: "Locked rooms it can open with those (with something in them)", get: roomsText },
    { h: "What is in them", get: keyedText },
  ];
  const groupCols = [
    { h: "Group", get: (g) => g.name },
    { h: "Roles", num: true, get: (g) => g.roles },
    { h: "Seats", num: true, get: (g) => g.seats },
    { h: "Bank ¢", num: true, get: (g) => fmt(g.bank, 0), sort: (g) => g.bank },
    { h: "In hand ¢", num: true, get: (g) => fmt(g.coinHand, 0), sort: (g) => g.coinHand },
    { h: "¢ a seat", num: true, get: (g) => fmt(g.perSeatFunds, 1), sort: (g) => g.perSeatFunds },
    { h: "⬢ on persons", num: true, get: (g) => fmt(g.resources + g.cracked, 0), sort: (g) => g.resources + g.cracked },
    { h: "Food carried (hunger)", num: true, get: (g) => fmt(g.food, 0), sort: (g) => g.food },
    { h: "Earliest starving turn", num: true, get: (g) => g.starveTurn },
    { h: "Median starving turn", num: true, get: (g) => fmt(g.medianStarve, 0), sort: (g) => g.medianStarve },
  ];
  const openersText = (r) => (r.open ? "anybody" : r.openers.length ? `${r.openers.slice(0, 4).join(", ")}${r.openers.length > 4 ? `, +${r.openers.length - 4}` : ""}` : `no starting role (needs ${r.access.slice(0, 3).join(", ")})`);
  const roomCols = [
    { h: "Room", get: (r) => r.name },
    { h: "Where", get: (r) => `${r.location} · ${r.zone.split("/")[0]}` },
    { h: "Locked?", get: (r) => (r.open ? "open" : "locked") },
    { h: "Starting roles that can open it", get: openersText },
    { h: "⬢", num: true, get: (r) => r.resources, sort: (r) => r.resources },
    { h: "⬢ in items", num: true, get: (r) => r.cracked, sort: (r) => r.cracked },
    { h: "¢", num: true, get: (r) => r.coin, sort: (r) => r.coin },
    { h: "Food (hunger)", num: true, get: (r) => fmt(r.food, 0), sort: (r) => r.food },
    { h: "Crafting kit", get: (r) => (r.kit.length ? r.kit.slice(0, 5).join(", ") + (r.kit.length > 5 ? "…" : "") : "—") },
  ];
  const starveCols = [
    { h: "Starving at the close of turn", num: true, get: (r) => r.turn },
    { h: "Dying at turn", num: true, get: (r) => r.dying },
    { h: "Seats", num: true, get: (r) => r.seats },
  ];
  const fundCols = [{ h: "Seats that…", get: (r) => r.label }, { h: "Count", num: true, get: (r) => r.seats }];
  const rooms = [...S.rooms].sort((a, b) => b.coin + b.resources + b.cracked - (a.coin + a.resources + a.cracked) || b.food - a.food);
  const vault = S.vault;
  return `<section><h2>The starting economy</h2>
<p class="lede">What each role begins with, and how long it lasts. Factions were removed, so seats are grouped the way the character picker groups them (by social position). Everything is read from <code>docs/roles.yaml</code> (a role's seat, coin, bank account and free starting tags), <code>docs/zones.yaml</code> (which rooms hold what, and which tag opens them) and <code>db/lib/hunger.js</code>. Seats are worked out for <b>${S.players} players</b> (<code>--players N</code> changes it); ${S.unlimited.length} roles (${esc(S.unlimited.join(", "))}) have no seat cap and are left out of the totals. Points spent on more skills or keys at character creation are not counted.</p>
<h3>How long until people starve</h3>
<p class="lede">A character starts at ${S.start} hunger and loses <b>${S.decay} a turn</b> (${S.fastDecay} for Big Appetite). Hungry is at ${S.hungryAt} or less, Starving is at 0, and <b>Dying comes ${S.deathTurns - 1} turns after Starving begins</b>. With no food that is Starving at the close of turn ${S.noFoodStarve} and Dying at turn ${S.noFoodDying}. Food on the person adds its hunger to the ${S.start}, spent in time so no bite is wasted. The whole town's starting coin buys about <b>${fmt(S.town.funds / S.costPerPersonTurn, 0)} person-turns</b> of ration at ${fmt(S.costPerPersonTurn, 1)} ¢ each, and everyone carrying food has ${fmt(S.town.food, 0)} hunger between them raw, ${fmt(S.town.foodTurns, 1)} person-turns, against ${fmt(S.town.needPerTurn, 0)} hunger the town burns every turn. The ${S.town.cookSeats} cooking seats each start with a turn of cooking${S.town.cookKit ? ` (${fmt(S.town.cookKit.crops, 0)} crops, ${fmt(S.town.cookKit.dishes, 0)} dishes, ${fmt(S.town.cookKit.moves, 2)} Move${S.town.cookKit.moves === 1 ? "" : "s"})` : ""}, which is ${fmt(S.town.dishes, 0)} dishes and ${fmt(S.town.cropTurns, 0)} person-turns once cooked, or ${fmt(S.town.cropTurns / S.town.seats, 1)} turns of food for every named seat if it were shared out. Every role also starts with about one meal (${fmt(S.town.mealHunger, 0)} hunger is the median): poorer seats moldy bread or a Ration Box, the rest a plain dish, the cooks Cheese.</p>
${table({ cols: starveCols, rows: S.starveRows, id: "startstarve" })}
${table({ cols: fundCols, rows: S.fundedRows, id: "startfunded" })}
<h3>By group</h3>
${table({ cols: groupCols, rows: S.groups, id: "startgroups" })}
<h3>By role</h3>
<p class="lede">Coin is in ¢ and Resources in ⬢; 1 ¢ is not 1 ⬢ (a ⬢ costs ${params.rv.buy} ¢ at the Depot). <b>Bank</b> is what is in the account the moment it opens (only the Depot can pay it out, and a treasury account is backed by the Vault, which holds ${vault ? fmt(vault.coin, 0) : "?"} ¢ against ${fmt(S.treasuryClaims, 0)} ¢ of treasury claims at this size, ${vault ? fmt((vault.coin / S.treasuryClaims) * 100, 0) : "?"}%). <b>In hand</b> coin can be stolen or pickpocketed. <b>Food if all coin is spent</b> counts the bank as well as the coin in hand, and assumes the buyer can reach the Depot. A room in the last two columns is one the role's own free keys and tags open, counting only rooms with something in them, and several roles may share a key (Baron's key opens almost everything, and the Cerberus key opens ${S.roles.filter((r) => r.tagSlugs.includes("cerberus-key")).length} roles' rooms).</p>
${table({ cols: roleCols, rows: S.roles, filters: [{ label: "Group", get: (r) => r.groupName }] })}
<h3>Rooms with something in them</h3>
<p class="lede">Everything the game puts in a room when it starts, biggest first. <b>Open</b> rooms hold ${fmt(S.commons.resources, 0)} ⬢, ${fmt(S.commons.coin, 0)} ¢ and ${fmt(S.commons.food, 0)} hunger of food between them, for anybody. A locked room is opened by a key or tag its starting roles hold; roles may also open it with skills bought with points (the Caving skill opens the caves' stashes).</p>
${table({ cols: roomCols, rows: rooms, filters: [{ label: "Locked?", get: (r) => (r.open ? "open" : "locked") }] })}
</section>`;
}

function sectionPower() {
  const P = PWR;
  const w = P.weights;
  const roleCols = [
    { h: "Role", get: (r) => r.name },
    { h: "Group", get: (r) => r.group },
    { h: "Seats", num: true, get: (r) => r.seats, sort: (r) => (r.seats === "no cap" ? 999 : r.seats) },
    { h: "Tag value, pt", num: true, get: (r) => (r.extraPoints ? `${r.kitValue} + ${r.extraPoints} bonus = ${r.tagValue}` : `${r.tagValue}`), sort: (r) => r.tagValue },
    { h: "Wealth ¢", num: true, get: (r) => fmt(r.wealthCoin, 0), sort: (r) => r.wealthCoin },
    { h: "Reach ¢ (keyed rooms)", num: true, get: (r) => fmt(r.reachCoin, 0), sort: (r) => r.reachCoin },
    { h: "Soft power", num: true, get: (r) => r.softPower, sort: (r) => r.softPower },
    { h: "Composite", num: true, get: (r) => r.composite, sort: (r) => r.composite ?? -1 },
    { h: "Why (soft power)", get: (r) => Object.entries(r.softParts).filter(([, v]) => v > 0).map(([k, v]) => `${k} +${fmt(v, 0)}`).join(", ") || "nothing" },
  ];
  const groupCols = [
    { h: "Group", get: (g) => g.group },
    { h: "Roles", num: true, get: (g) => g.roles },
    { h: "Top role", get: (g) => g.topRole },
    { h: "Average composite", num: true, get: (g) => fmt(g.avgComposite, 1), sort: (g) => g.avgComposite },
  ];
  const weightRows = [
    { knob: "Whitelisted (vetted players only)", value: `+${w.whitelisted}` },
    { knob: "Bank account: treasury / offshore / none", value: `+${w.bankAccount.treasury} / +${w.bankAccount.offshore} / +0` },
    { knob: "Each key or licence held", value: `+${w.perKeyOrLicence}, up to +${w.perKeyOrLicence * w.maxKeys}` },
    { knob: "Each locked room those open (with something in it)", value: `+${w.perLockedRoom}, up to +${w.perLockedRoom * w.maxRooms}` },
    { knob: "Each doc_elements entry (lore known from creation)", value: `+${w.perDocElement}, up to +${w.perDocElement * w.maxDocElements}` },
    { knob: "Each bonus point at creation (extra_starting_points)", value: `+${w.perExtraPoint}, up to +${w.perExtraPoint * w.maxExtraPoints}` },
    { knob: `Scarcity (a seat with fewer than ${w.scarcitySeatFloor} at this town size; a one-to-a-game seat counts as one)`, value: `up to +${w.scarcity}, a straight line to 0 at ${w.scarcitySeatFloor}+` },
  ];
  const weightCols = [{ h: "Soft power adds…", get: (r) => r.knob }, { h: "Worth", get: (r) => r.value }];
  return `<section><h2>Starting power, by role</h2>
<p class="lede">Three separate measures, not one number pretending to be precise, plus a fourth column that only exists to sort by. <b>Tag value</b> is a role's whole point-buy budget at character creation: what the free starting kit would have cost, point for point — a role's own starting tags priced the same way the Store prices everyone else's purchases (<code>Tag.pointCost</code>; Obols and Resources carry none, so a fat purse does not inflate this) — plus any <code>extra_starting_points</code> <code>docs/roles.yaml</code> adds to <code>GameConfig.startingTagPoints</code> for that role, shown as kit + bonus so the total is never a hidden sum. <b>Wealth</b> is what a role could turn into spendable ¢ on its own on day one: bank plus coin in hand plus the ⬢ on its person, the ⬢ valued at the Depot's sell-back (${fmt(P.rvSell, 0)} ¢, the guaranteed floor — nobody can be paid less for it, so this is a liquidation value, never a replacement cost). <b>Reach</b> is the same, for what its own keys open beyond its own pocket — the ⬢ and ¢ sitting in the locked rooms its starting tags admit it to (<code>db/scripts/analysis/economy/starting.js</code>'s own keyed-room figures); several roles can share one key, so this is what a role <em>could</em> reach, the same honest limit that section states. Neither Wealth nor Reach folds ⬢ into ¢ silently — the rate is named right here, the way it is everywhere else in this report.</p>
<h3>Soft power, the vague one</h3>
<p class="lede">This is a house-rules score, not a catalog figure, and it says so on purpose. It answers "how much of a big deal is this seat", which is a real question a GM asks even though nothing prices it. It is built entirely from signals already in the data rather than from reading a role's own prose for the word "leader": whether it is whitelisted, how autonomous its bank account is, how many keys and locked rooms it starts able to reach, how much lore it already knows (<code>doc_elements</code> — the Baron's power is mostly this: every player is told who he is, and several roles are handed a relationship with him), its own bonus points at creation, and how rare the seat itself is (a one-to-a-game seat counts as one seat; there is no separate bonus for being unique any more). Every weight below is a small, round, shown number, so the "why" column on each row adds up by hand to the total next to it — retune the numbers on a re-read; nothing else here depends on their exact values.</p>
${table({ cols: weightCols, rows: weightRows, id: "powerweights" })}
<h3>Composite: one sortable column, built the only defensible way</h3>
<p class="lede">Tag value is in points, Wealth and Reach are in ¢, Soft power is a house-rules score — summing numbers in three different units would be nonsense, so Composite is each role's <b>percentile rank</b> on Tag value, Wealth and Soft power (0 to 100, among every seated role, Reach left out since it is really a restatement of the same keys the soft-power score already counts), averaged. It is a ranking aid, not a fourth measure — the three above are what actually says something. Top by Tag value: <b>${esc(P.topTagValue.name)}</b> (${P.topTagValue.tagValue} pt). Top by Wealth: <b>${esc(P.topWealth.name)}</b> (${fmt(P.topWealth.wealthCoin, 0)} ¢). Top by Soft power: <b>${esc(P.topSoft.name)}</b> (${P.topSoft.softPower}). Top Composite: <b>${esc(P.topComposite.name)}</b>.</p>
${table({ cols: roleCols, rows: P.rows, filters: [{ label: "Group", get: (r) => r.group }] })}
<h3>By group</h3>
${table({ cols: groupCols, rows: P.groups, id: "powergroups" })}
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
<p class="lede"><b>Cave diving is where Lucky shows most, and it is measured per expedition.</b> A caver walks until they have eaten a set number of troubles and then stops (the Caving tab's trouble budget). Lucky turns a 1 from ${fmt(model.caving.faces.base.trouble * 36, 0)} in 36 into ${fmt(model.caving.faces.lucky.trouble * 36, 0)} in 36, so the same budget buys <b>${fmt(model.caving.arrivalsPerTrouble.lucky / model.caving.arrivalsPerTrouble.base, 0)} times the arrivals</b>, and the finds that come with them: at the Depths, stopping at 1 trouble, Lucky adds ${fmt(K.uses.find((u) => u.id === "caving-depths-1")?.gain, 1)} ¢ an expedition, ${fmt(K.uses.find((u) => u.id === "caving-depths-3")?.gain, 1)} at 3 and ${fmt(K.uses.find((u) => u.id === "caving-depths-10")?.gain, 1)} at 10. The troubles themselves cost the same either way; Lucky pays in loot. Forging is second and is <b>per Trinket, not per turn</b>: a Trinket is a whole Move, so a smith with good stones gets ${fmt(K.uses.find((u) => u.id === "trinket-apprentice-98")?.gain, 0)} ¢ a Move from Lucky, and one with poor stones ${fmt(K.uses.find((u) => u.id === "trinket-apprentice-20")?.gain, 0)}; but stones are what limit a forger, so a miner forging their own gets about ${fmt(K.uses.find((u) => u.id === "trinket-prospector")?.gain, 1)} ¢ a turn.</p>
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

// The selling trip and what a mount's extra crossing is worth (travel.js).
function combosTravel(c, TV, label, tagsCell) {
  const seen = new Set();
  const rows = TV.base.rows
    .map((r) => {
      const m = TV.mount.byKey.get(r.loadout.picked.join("+"));
      const best = (t) => Math.max(t.withFactory.after, t.noFactory.after);
      return { l: r.loadout, base: r, mount: m, at1: best(r), at2: m ? best(m) : null, diff: m ? best(m) - best(r) : null };
    })
    .filter((r) => (seen.has(label(r.l)) ? false : seen.add(label(r.l))))
    .sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0) || b.at2 - a.at2);
  const cols = [
    { h: "Loadout", get: (r) => label(r.l) },
    { h: "Tags", get: (r) => tagsCell(r.l) },
    { h: "Planner ¢ / turn", num: true, get: (r) => fmt(Math.max(r.l.withFactory.rate, r.l.noFactory.rate)) },
    { h: `After the sale trip, ${TV.base.free} free`, num: true, get: (r) => fmt(r.at1), sort: (r) => r.at1 },
    { h: `…${TV.mount.free} free`, num: true, get: (r) => fmt(r.at2), sort: (r) => r.at2 ?? -1 },
    { h: "Worth a mount", num: true, get: (r) => fmt(r.diff), sort: (r) => r.diff ?? -1 },
    { h: "Where (with the Factory)", get: (r) => `${r.base.withFactory.workZones.join(", ")} → ${r.base.withFactory.sellZone}, ${r.base.withFactory.far} hop${r.base.withFactory.far === 1 ? "" : "s"}` },
  ];
  const gainers = rows.filter((r) => r.diff > 0.05).slice(0, 3);
  const nothing = rows.filter((r) => Math.abs(r.diff ?? 0) < 0.05);
  return `<h3>The sale trip, and what a mount is worth</h3>
<p class="lede">The planner sells nothing, so this charges each loadout for getting its output to the Depot in ${esc(TV.base.depot)}, by one rule: one sale trip a production cycle, out from the furthest zone the pattern works in and back (two trips for the Factory's cubes, which a bare carrier cannot take in one, per the Transport tab); the crossings come out of the ${TV.base.free} free a turn the pattern is not already using, a rest turn's idle Move covers one more crossing for nothing, and any crossing past that costs a working turn's Move and stretches the cycle. A crafter with no fixed workshop is taken to stand at the Depot. Then the same with ${TV.mount.free} free, an equipped ${esc(TV.mountName)}'s extra crossing (<code>db/lib/mounts.js</code>), with the planner rerun at that allowance. ${gainers.length ? `The mount is worth most to ${listAnd(gainers.map((r) => `${esc(label(r.l))} (+${fmt(r.diff)} ¢ a turn)`))}.` : "No loadout gains from the mount."} ${nothing.length ? `It does nothing for ${nothing.length} of the ${rows.length}, patterns whose work sits one hop from the Depot with a rest turn to walk it.` : ""} <code>--free-moves</code> still sets the main planner above.</p>
${table({ cols, rows: rows.slice(0, 25), id: "combostravel" })}`;
}

function sectionCombos() {
  const c = model.combos;
  const label = (l) => l.skills.join(" + ");
  // The selling trip, at the game's free crossings and with an arelitz's extra one (travel.js).
  const TV = model.travel;
  const tv = (l, key, which = "base") => TV[which].byKey.get(l.picked.join("+"))?.[key] ?? null;
  const tagsCell = (l) => (l.tagCosts.length ? `${l.tagCosts.map((t) => `${t.name} ${t.points}`).join(" + ")} = ${l.tagCosts.reduce((n, t) => n + t.points, 0)}` : "none");
  const whereCell = (l, key) => {
    const t = tv(l, key);
    if (!t) return "—";
    return `works in ${t.workZones.join(", ") || "—"}; sells in ${t.sellZone}; ${t.far} hop${t.far === 1 ? "" : "s"} at most`;
  };
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
    { h: "Tags", get: (r) => tagsCell(r.l) },
    { h: "¢ / turn", num: true, get: (r) => fmt(r.l[key].rate), sort: (r) => r.l[key].rate },
    { h: `After the sale trip, ${TV.base.free} free`, num: true, get: (r) => fmt(tv(r.l, key)?.after), sort: (r) => tv(r.l, key)?.after ?? -1 },
    { h: `…with ${TV.mount.free} free (${esc(TV.mountName)})`, num: true, get: (r) => fmt(tv(r.l, key, "mount")?.after), sort: (r) => tv(r.l, key, "mount")?.after ?? -1 },
    { h: "Where", get: (r) => whereCell(r.l, key) },
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
    { h: "Tags", get: (l) => tagsCell(l) },
    { h: "With the Factory", num: true, get: (l) => fmt(l.withFactory.rate), sort: (l) => l.withFactory.rate },
    { h: `…after the sale trip, ${TV.base.free} free`, num: true, get: (l) => fmt(tv(l, "withFactory")?.after), sort: (l) => tv(l, "withFactory")?.after ?? -1 },
    { h: `…${TV.mount.free} free`, num: true, get: (l) => fmt(tv(l, "withFactory", "mount")?.after), sort: (l) => tv(l, "withFactory", "mount")?.after ?? -1 },
    { h: "Where", get: (l) => whereCell(l, "withFactory") },
    { h: "Schedule", get: (l) => l.withFactory.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
    { h: "Without it", num: true, get: (l) => fmt(l.noFactory.rate), sort: (l) => l.noFactory.rate },
    { h: "Schedule", get: (l) => l.noFactory.pattern, style: () => "font-family:var(--mono);letter-spacing:1px" },
  ];
  const startRows = c.loadouts.filter((l) => l.points <= params.startingTagPoints).sort((x, y) => y.withFactory.rate - x.withFactory.rate || y.noFactory.rate - x.noFactory.rate).filter((l, i, arr) => arr.findIndex((x) => label(x) === label(l)) === i).slice(0, 10);
  const bars = [];
  for (const s of steps("withFactory")) bars.push({ label: `${label(s.l)} (${s.l.points} pt), with Factory`, value: s.l.withFactory.rate, color: "var(--c1)" });
  for (const s of steps("noFactory")) bars.push({ label: `${label(s.l)} (${s.l.points} pt), no Factory`, value: s.l.noFactory.rate, color: "var(--c0)" });
  const refAlone = c.alone.find((a) => /^Refine/.test(a.label));
  const start = bestUnder(params.startingTagPoints, "withFactory");
  const startNo = bestUnder(params.startingTagPoints, "noFactory");
  const startLetters = new Set((start?.withFactory.pattern ?? "").split(" "));
  const P = params.skillPoints;
  const cubes = params.refineryYield;
  const lbs = cubes * params.squeezeLbs;
  const zoneRows = Object.entries(c.crossings).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td>${v <= c.free ? "free" : v === c.free + 1 ? `costs the Move` : "two or more turns"}</td></tr>`).join("");
  const verbRows = model.combos.verbs.map((v) => `<tr><td>${esc(v.label)}</td><td>${esc(v.zone ?? "anywhere")}</td><td class="num">${fmt(v.value)}</td><td>${v.fatigue ? "climbs the ladder" : "no fatigue"}</td><td>${v.needs.length ? esc(v.needs.join(", ")) : "no skill"}</td></tr>`).join("");
  return `<section><h2>Combining activities</h2>
<p class="lede">Each day-verb is rationed by something different, so they can fill each other's gaps. This is a planner, not a guess: it searches every schedule for the best one, turn by turn, using the game's own fatigue gates. It is exact within the rules below.</p>
<ul class="ranks">
<li><b>The Move.</b> One a turn. Mine, Farm and Refine each take all of it, and crafts share it in fractions, so a turn is one day-verb or a craft mix, never both.</li>
<li><b>Fatigue.</b> Mine, Refine and Farm all climb the Tired and Exhausted ladder (one step at a time, Tired then Exhausted), so each can be pressed only some turns. Crafts, cutting Godflesh and Butcher never touch it, so a craft fills the turns a day-verb is locked out.</li>
<li><b>Seats.</b> Only ${params.refinerySeats} people may refine at the Factory in a turn. The main tables assume you can always get a seat; the crowd table below shows what competition does.</li>
<li><b>Skill points and tools.</b> Mine needs a pickaxe (${params.pickaxe.points} point${params.pickaxe.points === 1 ? "" : "s"} at creation, or a smith makes one) and Prospecting (${P.prospecting} points) pays ×${params.prospectingMultiplier} on top. A <b>Smithing</b> smith also forges the stones a Mine press turns up into Trinkets on the rest turn a miner has anyway (the extra is what the Trinkets clear over selling the stones raw, less the rest-turn Moves they take), and a Trinket bought at the shelf is a craft like any other. Refine and cutting Godflesh need no skill. <b>Farm is not one of this planner's verbs</b>: Soilery earns food, not ¢ (Foodstuffs never sell), so it never competes for a Move here the way a dish never does either — see "Food" for what Farm and Fertilizer are worth in their own currency.</li>
<li><b>Place.</b> Hops inside a zone are free, and a turn allows ${c.free} free zone crossing${c.free === 1 ? "" : "s"} (a mount adds one; <code>--free-moves</code> changes it). A crossing beyond that costs the Move, so nearby workplaces do not cost formal Moves.</li>
</ul>
<h3>Where the work is</h3>
<div class="tablewrap"><table><thead><tr><th>Verb</th><th>Zone</th><th class="num">¢ per press</th><th>Fatigue</th><th>Needs</th></tr></thead><tbody>${verbRows}</tbody></table></div>
<div class="tablewrap"><table><thead><tr><th>Trip</th><th class="num">Crossings</th><th>Cost</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
<h3>Each activity on its own</h3>
${table({ cols: aloneCols, rows: c.alone })}
<h3>The best mix at each skill budget</h3>
<p class="lede">The schedule reads one letter a turn: <b>R</b> Refine, <b>M</b> Mine, <b>C</b> a craft, <b>·</b> rest. The second row is the zone: T town, H hills, D depths, C caves. ${start && refAlone ? `With the Factory, a character with no skills refines one turn in ${fmt(1 / params.refineDuty, 0)} for <b>${fmt(refAlone.rate)} ¢ a turn</b>. At the starting budget the best mix is ${esc(label(start))}, at ${fmt(start.withFactory.rate)} ¢${startLetters.has("C") ? ", a craft filling turns the ladder locks, since a craft costs no fatigue" : startLetters.has("R") ? " (nothing fills the turns Refine is locked out of)" : ""}.` : ""}</p>
<h4>With the Factory open</h4>
${table({ cols: stepCols("withFactory"), rows: steps("withFactory") })}
<h4>Without it (full, out of reach, or no Godflesh)</h4>
<p class="lede">With Refine off the table, whether because the Factory is full, out of reach, or out of Godflesh, the mixes are worth comparing. ${startNo ? `At the starting budget the best is ${esc(label(startNo))} at ${fmt(startNo.noFactory.rate)} ¢ a turn.` : ""}</p>
${table({ cols: stepCols("noFactory"), rows: steps("noFactory") })}
${barChart({ rows: bars, unit: " ¢", labelW: 330, fmtVal: (v) => fmt(v, 1) })}
<h3>What a starting character (${params.startingTagPoints} points) can reach</h3>
${table({ cols: startCols, rows: startRows })}
${combosTravel(c, TV, label, tagsCell)}
${(() => {
    // Does the Distilling rung ever earn its 3 points in the planner? Compare the best loadout that holds it
    // against the same loadout without it. The drinks it doubles sell to players (Alcohol) or for 1 ¢ at the
    // counter (Moonshine), and the planner only counts counter sales, so this is the honest answer, not the ceiling.
    const withD = c.loadouts.filter((l) => l.skills.some((s) => /Distilling/.test(s))).sort((x, y) => y.withFactory.rate - x.withFactory.rate)[0];
    if (!withD) return "";
    const twin = c.loadouts.find((l) => label(l) === withD.skills.filter((s) => !/Distilling/.test(s)).join(" + "));
    const d = model.distilling.find((x) => x.ceiling);
    return `<p class="lede">Distilling (${withD.points - (twin?.points ?? withD.points)} points on top of Brewing II) ${twin && withD.withFactory.rate - twin.withFactory.rate > 0.05 ? `adds ${fmt(withD.withFactory.rate - twin.withFactory.rate)} ¢ a turn to the best loadout that holds it` : "adds nothing the planner can count: the drinks it doubles sell to players or for 1 ¢ at the counter"}${d ? `. At the Black Market's shelf price, which is what a player might pay, a distilled ${d.name} brewer would clear ${fmt(d.net, 1)} ¢ a Move against ${fmt(d.plainNet, 1)} without it — a ceiling, since nothing in the game sells a drink for you` : ""}.</p>`;
  })()}
${sectionSeats()}
<h3>What this leaves out</h3>
<p class="lede">The plan above sells nothing and carries nothing; the sale-trip columns and the table above charge the walk to the Depot, and the Transport tab the carrying. A refining day is ${cubes} cubes at ${fmt(params.squeezeLbs, 0)} lb, so ${fmt(lbs, 0)} lb (${fmt(lbs / 2, 0)} lb crated), against a ${params.carryWeightLbs} lb carry cap, and an Overburdened character has no free crossings, so every crossing costs the Move and they cannot act that turn. Turning cubes into ¢ means a trip to the Depot in Undertown, which is one crossing from both the town and the hills, so a plain walker cannot refine and sell in the same turn without a mount or cart. These figures are a ceiling on Moves, fatigue and skill points, not a wage. Also left out: the 1-in-6 injury on every Godflesh cut, a forge for smithing, ⬢ bought at the Depot, and how many other players want the same seat.</p>
</section>`;
}

// Mining: pay, risk and the walk (miningRisk.js).
function miningPanel() {
  const M = model.miningRisk;
  const C = model.caving;
  const rows = M.rows;
  const pts = rows.map((r) => ({ x: r.net, y: r.dieRiskTurn + r.moodTurn, family: "mining", label: r.name, r: 4 + 2 * (r.hops ?? 0), note: `${r.hops} hop${r.hops === 1 ? "" : "s"}` }));
  const cols = [
    { h: "Activity", get: (r) => r.name },
    { h: "¢ a turn", num: true, get: (r) => fmt(r.net), sort: (r) => r.net },
    { h: "Hops from the Depot", num: true, get: (r) => r.hops },
    { h: "Free crossings a turn", num: true, get: (r) => r.free },
    { h: "Move-costing crossings a trip", num: true, get: (r) => r.paidCrossingsTrip },
    { h: "Die arrivals a trip", num: true, get: (r) => r.arrivalsRolling },
    { h: "Trouble chance an arrival", num: true, get: (r) => (r.trouble == null ? "—" : `1 in ${fmt(1 / r.trouble, 0)}`) },
    { h: "Danger ¢ an arrival", num: true, get: (r) => (r.arrivalsRolling ? fmt(r.dangerPerArrival, 2) : "—"), sort: (r) => r.dangerPerArrival },
    { h: "Deaths per 100 trips", num: true, get: (r) => fmt(r.deathsTrip * 100, 2), sort: (r) => r.deathsTrip },
    { h: "Die risk ¢ a turn", num: true, get: (r) => fmt(r.dieRiskTurn, 2), sort: (r) => r.dieRiskTurn },
    { h: "Mood ¢ a turn", num: true, get: (r) => fmt(r.moodTurn, 2), sort: (r) => r.moodTurn },
    { h: "Mood ¢ a turn, immune tag", num: true, get: (r) => `${fmt(r.moodTurnImmune, 2)} (${esc(r.immuneTag)})`, sort: (r) => r.moodTurnImmune },
    { h: "Pay less risk", num: true, get: (r) => fmt(r.payLessRisk), sort: (r) => r.payLessRisk, style: (r) => (r.payLessRisk < 0 ? "color:var(--bad)" : "") },
  ];
  const best = [...rows].sort((a, b) => b.payLessRisk - a.payLessRisk)[0];
  const top = (zone) => rows.filter((r) => r.zone === zone).sort((a, b) => b.payLessRisk - a.payLessRisk)[0];
  const cv = top("caves");
  const dp = top("depths");
  const tagList = (list) => listAnd(list.map((t) => `${esc(t.name)} ×${fmt(t.factor, 2)}`));
  return `<h2>Mining: pay, risk and the walk</h2>
<p class="lede">Each mine and gather row's pay a turn against what the walk costs. Assumed: one selling trip to the Depot in ${esc(M.depot ?? "?")} per mining cycle (a press one turn in ${fmt(1 / M.tripsPerTurn, 0)}, so a trip that often), one arrival for each hop into a cave level both ways, and the miner sleeping where they work. The Caving Die's cost per arrival is the Caving tab's, wounds and the trouble's mood together; it is the same per arrival at any trouble budget, so it is the 3-trouble plain figure for a bare miner. The walk is counted in hops, not turns: a crossing inside the ${M.free} free a turn costs no Move. The mood column is the nightly place term every turn plus the arrival term on each trip, from mood.js: underground ${tagList(C.moodTags.cave)} scale it, and in the wild ${tagList(C.moodTags.wilderness)}. The seam's drift and Lifeweb failure are not modelled. ${best ? `<b>${esc(best.name)}</b> pays most net of risk, ${fmt(best.payLessRisk)} ¢ a turn.` : ""} ${cv && dp ? `The Depths' best seam clears ${fmt(dp.payLessRisk)} ¢ against the Caves' ${fmt(cv.payLessRisk)}, so its extra pay ${dp.payLessRisk > cv.payLessRisk ? "more than covers" : "does not cover"} its extra danger and walk.` : ""}</p>
${scatter({ points: pts, xLabel: "net ¢ a turn", yLabel: "risk ¢ a turn (die and mood)", tip: (p) => `${p.label} — ${fmt(p.x)} ¢ a turn, ${fmt(p.y, 2)} ¢ of risk, ${p.note}` })}
${table({ cols, rows, id: "miningrisk" })}`;
}

function sectionSpread() {
  // Two kinds of figure, kept on two charts. Coin is coin. A food farm row or a dish is priced at Ration Box
  // parity with no cap on how much the town eats, a ceiling no farmer or cook is paid, so it would flatten every
  // cash family onto one line. Which is which is the model's `foodValued` flag, not a name.
  // A ceiling-priced drink (sold to players at the shelf price, never to the counter) is no more a cash figure
  // than a food row is, so it stays off both plots; the wages tab shows it apart, in its own colour.
  const cash = model.activities.filter((a) => money(a) != null && !a.foodValued && !a.ceiling);
  const foodRows = model.activities.filter((a) => a.foodValued && a.hungerPerTurn != null);
  const groups = FAMILIES.map((family) => ({
    family,
    points: cash.filter((a) => a.family === family).map((a) => ({ label: a.name, value: money(a) })),
  })).filter((g) => g.points.length);
  const byMedian = groups
    .filter((g) => g.points.length >= 2)
    .map((g) => ({ family: g.family, median: median(g.points.map((p) => p.value)) }))
    .sort((a, b) => b.median - a.median);
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const spreadNote = byMedian.length >= 2 ? `${cap(byMedian[0].family)} pays best by the median (${fmt(byMedian[0].median)} ¢ a turn) and ${byMedian[byMedian.length - 1].family} least (${fmt(byMedian[byMedian.length - 1].median)} ¢).` : "";

  // The food chart: what a full turn of each feeds, and the cash benchmarks as the Ration Boxes their coin buys.
  const box = model.foodFloor.anyone;
  const asBoxes = (a) => ({ x: (a.netPerTurn / box.buy) * box.hunger, y: (a.netPerTurn / box.buy) * box.mood });
  // The cash benchmarks: the cash crops, the Factory, and the ceiling-priced drinks (Alcohol plain and
  // distilled, at the shelf price a player might pay), which came off the cash chart for the same reason
  // food did and so belong here as the comparison.
  const benchmarks = box ? model.activities.filter((a) => (a.kind === "farm" && !a.foodValued) || a.id === "factory:solo" || (a.kind === "craft" && a.ceiling)).filter((a) => a.netPerTurn > 0) : [];
  const shortName = (a) => (a.ceiling ? `${a.name} at the shelf price` : a.name.replace(/^Farm — /, "").replace(/^Factory solo.*/, "Factory solo"));
  const foodPts = [
    ...foodRows.map((a) => ({ x: a.hungerPerTurn, y: a.moodPerTurn, family: a.family, label: a.name, kind: a.family, short: a.name })),
    ...benchmarks.map((a) => ({ ...asBoxes(a), family: a.family, label: `${shortName(a)}: ${fmt(a.netPerTurn)} ¢ a turn${a.ceiling ? " (a ceiling: sold to players, never the counter)" : ""}, as Ration Boxes`, marker: "square", big: true, kind: a.id, short: shortName(a) })),
  ];
  const foodFamilies = [...new Set(foodPts.map((p) => p.family))];
  const topBy = (key) => [...foodRows].sort((x, y) => y[key] - x[key])[0];
  const topHunger = topBy("hungerPerTurn");
  const topMood = topBy("moodPerTurn");
  const cookingRows = foodRows.filter((a) => a.family === "cooking");
  const cropDish = model.cooking.cropDish;
  const foodNote = [
    topHunger ? `${esc(topHunger.name)} feeds the most in a turn (${fmt(topHunger.hungerPerTurn, 0)} hunger)` : "",
    topMood ? `${esc(topMood.name)} lifts mood the most (${fmt(topMood.moodPerTurn, 0)})` : "",
  ].filter(Boolean).join(", and ");
  const benchNote = benchmarks.length
    ? ` The hollow squares are the cash benchmarks, each plotted at the hunger and mood its coin a turn would buy as ${esc(box.name)} rations, ${box.buy} ¢ apiece: ${benchmarks.map((a) => { const p = asBoxes(a); return `${esc(shortName(a))} at ${fmt(p.x, 0)} hunger and ${fmt(p.y, 0)} mood`; }).join(", ")}.${benchmarks.some((a) => a.ceiling) ? ` ${listAnd(benchmarks.filter((a) => a.ceiling).map((a) => esc(shortName(a))))} ${benchmarks.filter((a) => a.ceiling).length === 1 ? "is" : "are"} priced at the Black Market's shelf price, what a player might pay, never what the counter does: a ceiling, like the food rows.` : ""}`
    : "";
  const cookingNote = cookingRows.length && cropDish
    ? ` The ${cookingRows.length} dishes are here and not on the cash chart: a dish is worth per Move and a crop dish is ${fmt(cropDish.moves, 2)} of a Move, so at their ¢ value they read ${fmt(Math.min(...cookingRows.map(money)), 0)}–${fmt(Math.max(...cookingRows.map(money)), 0)} ¢ a turn, a ceiling no cook reaches since the counter pays only ${dishSell.min === dishSell.max ? `${dishSell.min} ¢` : `${dishSell.min}–${dishSell.max} ¢`} for a dish. The full table still carries that ¢ figure, priced as "Cooks against farmers" prices it.`
    : "";

  // Input rarity rides on the marker: the hardest input's rank from the sourcing model. A standard recipe (rank 2 or
  // less) is a filled dot, Gated a ring, Scarce a square, None known a cross. Non-craft rows stay large dots.
  const rankOf = (a) => (a.kind === "craft" ? recBy.get(a.slug)?.hardest ?? (a.trinket ? null : 0) : null);
  const markerOf = (rank) => (rank === 3 ? "ring" : rank === 4 ? "square" : rank >= 5 ? "x" : null);
  const rankLabel = (id) => model.sources.ranks.find((r) => r.id === id)?.label ?? `rank ${id}`;
  const pts = cash.map((a) => {
    const rank = rankOf(a);
    const rec = a.kind === "craft" ? recBy.get(a.slug) : null;
    return {
      x: a.skillPoints,
      y: money(a),
      family: a.family,
      label: a.name,
      big: a.kind !== "craft",
      kind: a.family,
      short: { mining: "Mine", farming: "Farm", factory: "Factory" }[a.family] ?? a.family,
      marker: markerOf(rank),
      hardest: rec?.hardestItem ? `${rec.hardestItem} (${rankLabel(rec.hardest)})` : null,
      rank,
    };
  });
  const craftPts = pts.filter((p) => p.rank != null);
  // A recipe with no special item at all (rank 0) counts as Open.
  const rankCounts = model.sources.ranks.map((r) => ({ r, n: craftPts.filter((p) => Math.max(1, p.rank) === r.id).length })).filter((x) => x.n);
  const glyph = (m) =>
    `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:-2px;margin-right:4px">${m === "ring" ? '<circle cx="7" cy="7" r="5" style="fill:none;stroke:var(--fg)" stroke-width="2"/>' : m === "square" ? '<rect x="2" y="2" width="10" height="10" style="fill:none;stroke:var(--fg)" stroke-width="2"/>' : m === "x" ? '<path d="M2 2L12 12M2 12L12 2" style="stroke:var(--fg)" stroke-width="2"/>' : '<circle cx="7" cy="7" r="5" style="fill:var(--fg)"/>'}</svg>`;
  const markerLegend = `<p class="legend">${[
    [null, model.sources.ranks.filter((r) => r.id <= 2).map((r) => r.label).join(" or ")],
    ["ring", rankLabel(3)],
    ["square", rankLabel(4)],
    ["x", rankLabel(5)],
  ].map(([m, l]) => `<span>${glyph(m)}${esc(l)}</span>`).join("")}</p>`;
  return `<section><h2>Every activity, by family</h2>
<h3>Hard finances</h3>
<p class="lede">One dot per activity whose value is coin, net ¢ per turn after materials; food farming and cooking are on the next chart. Hover a dot for its name. ${spreadNote}</p>
${legend(groups.map((g) => g.family))}${stripPlot({ groups })}
<h3>Food, at what it is worth against Rations</h3>
<p class="lede">One dot per activity valued as food: each food crop farmed and eaten raw (a harvest a turn at the farming duty), and each dish cooked for a whole turn. Across is hunger a turn, up is mood a turn. ${foodNote}.${benchNote}${cookingNote}</p>
${legend(foodFamilies)}${scatter({ points: foodPts, xLabel: "hunger per turn", yLabel: "mood per turn", tip: (p) => `${p.label} — ${fmt(p.x, 0)} hunger, ${fmt(p.y, 0)} mood a turn` })}
<h2>Does skill investment pay?</h2>
<p class="lede">Cumulative point cost of the skills an activity needs, against what it pays, for the cash activities above. Mining, farming and the Factory are the large dots. Starting budget is ${params.startingTagPoints} points. A craft's marker says how hard its hardest input is to come by: of the ${craftPts.length} crafts plotted, ${listAnd(rankCounts.map((x) => `${x.n} ${esc(x.r.label)}`))}.</p>
${legend(groups.map((g) => g.family))}${markerLegend}${scatter({ points: pts, tip: (p) => `${p.label} — ${p.x} pt, ${fmt(p.y)} ¢/turn${p.hardest ? `; hardest input: ${p.hardest}` : ""}` })}
${miningPanel()}</section>`;
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
<p class="lede">${model.activities.length} activities, with recipes that take the same inputs and pay the same shown as one line (${collapse(allRanked, (a) => (a.kind === "craft" ? sigOfSlug(a) : null)).length} lines). Click a heading to sort. “Per action” is one press; “Presses / turn” is how often the fatigue rules let you press it, and “free” marks actions that cost no Move (Butcher, the Caving Die), which are limited by what you have to work on. “Drops” is the extra loot per press, valued at what the station pays. “Inputs” prices ⬢ at the sell figure. An ingredient that is food is priced at the counter's price, else its hunger and mood at the Ration Box's rate, never more than the Depot asks; anything else at the Depot's shelf price, else the counter's.</p>
${table({ cols, rows: collapse(allRanked, (a) => (a.kind === "craft" ? sigOfSlug(a) : null)), filters: [{ label: "Family", get: (a) => a.family }, { label: "Skill", get: (a) => a.skill }, { label: "Secret", get: (a) => (a.kind !== "craft" ? "not a craft" : secretMark(recBy.get(a.slug) ?? {}) || "shown") }] })}</section>`;
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
  const mineRows = model.activities.filter((a) => a.kind === "mine" || a.kind === "gather");
  const bars = [];
  for (const a of mineRows) {
    bars.push({ label: `${a.name.replace(/^(Mine|Gather) — /, "")}: ⬢`, value: a.resourcesPerPress * params.rvMined, color: "var(--c0)" });
    bars.push({ label: `${a.name.replace(/^(Mine|Gather) — /, "")}: ${a.kind === "gather" ? "finds" : "drops"}`, value: a.dropsPerAction, color: "var(--c1)" });
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
<p class="lede">Anybody holding a pickaxe gets ⬢ and one draw on this table for a press. Prospecting multiplies the ⬢ by ${params.prospectingMultiplier} and moves the draw to a richer column. The Caves and Depths are the only places with a prospecting column; the Black Hills press draws on the gathering table instead, and its finds are the Black Hills bars in the chart. The base yield is ${params.miningBase.min}–${params.miningBase.max} at a coefficient of 1 before the ${fmt(params.productionCoefficient, 1)} dial and the pickaxe's +${params.pickaxe.bonus}.</p>
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
    { h: "Secret", get: secretMark, style: (r) => (secretMark(r) ? "font-weight:600" : "") },
    { h: "Notes", get: (r) => (r.copy ? "copies something you already hold" : "") },
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
${table({ cols: recCols, rows: collapse([...S.recipes].sort((a, b) => b.hardest - a.hardest || a.name.localeCompare(b.name)), sigOfRecipe), filters: [{ label: "Skill", get: (r) => r.skill }, { label: "Hardest gate", get: (r) => (r.hardest === 0 ? "none" : RANK.find((x) => x.id === r.hardest)?.label) }, { label: "Forge", get: (r) => (r.workshop ? "needs one" : "no") }, { label: "Key copy", get: (r) => (r.copy ? "yes" : "no") }, { label: "Secret", get: (r) => secretMark(r) || "shown" }] })}</section>`;
}

// The same two flags the sourcing model sets (sources.js), as one word for a table cell. See the Secret recipes tab.
function secretMark(r) {
  return r.secretRecipe && r.hiddenUntilHeld ? "Secret, and hidden" : r.secretRecipe ? "Secret" : r.hiddenUntilHeld ? "Hidden until held" : "";
}

// Secret recipes: every craft an ordinary player is not shown, and why each one matters (secrets.js).
function sectionSecrets() {
  const X = model.secrets;
  const c = X.counts;
  const TIERS = ["best in class, or does something nothing in the main catalogue does", "efficient for what it costs", "the rest"];
  const cols = [
    { h: "Product", get: (r) => r.name },
    { h: "Catalogue", get: (r) => r.catalog },
    { h: "Shown", get: (r) => secretMark({ secretRecipe: r.secret, hiddenUntilHeld: r.hidden }), style: () => "font-weight:600" },
    { h: "Skill", get: (r) => r.skill },
    { h: "Pts (the chain)", num: true, get: (r) => r.points },
    { h: "Moves", num: true, get: (r) => fmt(r.moves, 2), sort: (r) => r.moves },
    { h: "⬢", num: true, get: (r) => r.resources },
    { h: "Inputs, and each one's easiest route", raw: true, get: (r) => (r.inputs.length ? r.inputs.map((i) => `${esc(i.label)} ${rankChip(i.rankId)}`).join("<br>") : "—"), sort: (r) => r.inputs.length },
    { h: "Forge", get: (r) => (r.workshop ? "yes" : "no") },
    { h: "Sells for ¢", num: true, get: (r) => r.sells ?? "—", sort: (r) => r.sells ?? -1 },
    { h: "Shelf ¢", num: true, get: (r) => r.shelf ?? "—", sort: (r) => r.shelf ?? -1 },
    { h: "Why it matters", get: (r) => r.why.join(". ") || "nothing found on the other tabs" },
    { h: "Who can reach it today", get: (r) => r.reach },
  ];
  const top = X.rows.slice(0, 3);
  return `<section><h2>Secret recipes</h2>
<p class="lede">A recipe can be kept from players two ways (<code>CRAFTING.md</code> §2). <b>Secret</b>: the product is not in the main catalogue (<code>catalog: gm</code> or <code>secret</code>), so holding an ingredient never shows the recipe; it reaches a character only when a GM hands them the product or the page, or a seat starts holding the product. <b>Hidden until held</b>: the recipe names an ingredient that is not in the main catalogue, so it stays off the Craft menu and the Recipes tab until the character holds one. Of ${model.sources.recipes.length} craftable recipes, <b>${c.total}</b> are one or the other: ${c.secret} secret, ${c.hidden} hidden until held, ${c.both} both. ${c.significant} are best in class or do something no main-catalogue tag does, ${c.efficient} more are efficient for what they cost, and ${c.reachable} are held or makeable by some seat from the start. ${top.length ? `The most significant: ${listAnd(top.map((r) => `<b>${esc(r.name)}</b> (${esc(r.why[r.why.length - 1] ?? "")})`))}.` : ""}</p>
<p class="lede">"Why it matters" is read off the other tabs: the armour verdicts and efficient kits on the Combat tab, a weapon's band steps and its place among weapons of its class, a craft's wage against DEPOT.md §4's rung and the best easy craft a player is actually shown, a dish's worth on the Food tab, and any effect (a cure, what it turns into, a resistance, a mining or carry bonus, a Gambit bonus) that no main-catalogue tag carries. Sorted by that: ${TIERS.map((t, i) => `${i + 1}. ${t}`).join("; ")}.</p>
${table({ cols, rows: X.rows, id: "secrets", filters: [{ label: "Shown", get: (r) => secretMark({ secretRecipe: r.secret, hiddenUntilHeld: r.hidden }) }, { label: "Significance", get: (r) => TIERS[r.tier] }, { label: "Catalogue", get: (r) => r.catalog }] })}</section>`;
}

function sectionSellTax() {
  const X = model.sellTax;
  const run = X.runRate;
  const cmp = run === 25 ? 50 : 25; // the chart sets the run's rate beside another, 25% unless that is the run's
  const rows = X.rows;
  const pct = (v) => (v == null ? "never" : `${fmt(v, 0)}%`);
  const cols = [
    { h: "Business", get: (r) => r.key },
    { h: "Taxable gross ¢ a turn", num: true, get: (r) => fmt(r.gross, 1), sort: (r) => r.gross },
    { h: "Untaxed inputs ¢", num: true, get: (r) => (r.inputs ? fmt(r.inputs, 1) : "—"), sort: (r) => r.inputs },
    { h: "Untaxed value ¢", num: true, get: (r) => (r.untaxed ? fmt(r.untaxed, 1) : "—"), sort: (r) => r.untaxed },
    ...X.rates.map((rate) => ({ h: `${rate}%`, num: true, get: (r) => fmt(r.netAt[rate], 1), sort: (r) => r.netAt[rate], style: (r) => (r.netAt[rate] < 0 ? "color:var(--bad)" : rate === run ? "font-weight:600" : "") })),
    { h: "Breaks even at", num: true, get: (r) => pct(r.breakEven), sort: (r) => r.breakEven ?? 999 },
    { h: "Note", get: (r) => r.note },
  ];
  const netAt = (r, rate) => r.gross * (1 - rate / 100) + r.untaxed - r.inputs;
  const bars = rows.map((r) => ({ label: r.key, value: netAt(r, run), value2: netAt(r, cmp), label2: `at ${cmp}%`, color: "var(--c0)", color2: "var(--bad)" }));
  const breaking = rows.filter((r) => r.breakEven != null).sort((a, b) => a.breakEven - b.breakEven);
  const never = rows.filter((r) => r.breakEven == null);
  const shrink = (key, rate) => {
    const r = rows.find((x) => x.key === key);
    return r ? { r, lost: r.netAt[0] - r.netAt[rate], share: r.netAt[0] > 0 ? (r.netAt[0] - r.netAt[rate]) / r.netAt[0] : null } : null;
  };
  const fac = shrink("Factory solo", 25);
  const pro = shrink("Prospector (Caves)", 25);
  return `<section><h2>What the sell tax does</h2>
<p class="lede">The Meister sets a <b>sell tax</b>, a whole percent from 0 to 100, from /treasury. Every sale the drop box settles when the train leaves pays it on its <b>gross</b>, the unit price times the quantity, before the seller is paid, and the tax goes into the Vault as coin. It touches every counter sale and nothing else: crafts, Trinkets, ore and metals, cubes of Squeeze and ⬢ sold back all pay it; a purchase at the Depot, a trade between players, food eaten and ⬢ bartered do not — farming pays none of it, since Foodstuffs never reach the counter. This run takes <b>${run}%</b> (<code>--sell-tax N</code>; the game's default is ${model.params.sellTaxRateDefault}%).</p>
<p class="lede">Each business below is split into what it sells at the counter (taxable, valued at what the counter pays: a miner's ⬢ at the ${params.rv.sell} ¢ sell-back, not the ${fmt(params.rv.mid, 1)} ¢ barter midpoint the wage table uses, since only a counter sale is taxed), what it buys (never taxed), and anything it makes that never meets the counter. Because the tax is on the gross and not the profit, it bites hardest where the margin is thin. ${breaking.length ? `<b>${esc(breaking[0].key)}</b> breaks even soonest, at ${pct(breaking[0].breakEven)}: it sells ${fmt(breaking[0].gross, 1)} ¢ a turn to clear ${fmt(breaking[0].netAt[0], 1)}, and the tax takes a share of all of it.` : ""} ${never.length ? `${listAnd(never.map((r) => esc(r.key)))} never ${never.length === 1 ? "breaks" : "break"} even: ${never.length === 1 ? "it buys" : "they buy"} nothing, so even a 100% tax only takes what ${never.length === 1 ? "it sells" : "they sell"}.` : ""} ${fac && pro ? `A 25% tax takes ${fmt(fac.lost, 1)} ¢ a turn off the Factory (${fmt(fac.share * 100, 0)}% of it, every cube is sold) against ${fmt(pro.lost, 1)} ¢ off a Prospector (${fmt(pro.share * 100, 0)}% of the counter figure).` : ""}</p>
<p class="lede">The table uses the exact share. The game rounds each settled sale to a whole coin, so ${X.dodgeBelow != null ? `a 1 ¢ item sold on its own pays nothing below a ${X.dodgeBelow}% rate, while a stack does not dodge it: ${X.stackExample.units} of them sold together at ${X.stackExample.rate}% pay ${X.stackExample.tax} ¢` : "no single sale dodges it"}. Breaks even is the rate at which the business clears nothing; "never" means no rate does.</p>
${table({ cols, rows, id: "selltax" })}
<h3>Net a turn at ${run}% against ${cmp}%</h3>
${barChart({ rows: bars, unit: " ¢", labelW: 330, fmtVal: (v) => fmt(v, 1) })}
</section>`;
}

function sectionTransport() {
  const X = model.transport;
  const yn = (b) => (b ? "yes" : "no");
  const carrierCols = [
    { h: "Carrier", get: (c) => c.label },
    { h: "Multiplier", num: true, get: (c) => `×${fmt(c.multiplier, 2)}` },
    { h: "Cap lb", num: true, get: (c) => c.cap },
    { h: "Hard cap lb", num: true, get: (c) => c.hard },
    { h: "Only while equipped", get: (c) => yn(c.equippable) },
  ];
  // One row a flow and a carrier, uncrated and (where it can be) crated.
  const rows = X.flows.flatMap((f) =>
    f.carriers.map((c, i) => ({ f, c, cr: f.crated?.[i] ?? null, first: i === 0 })),
  );
  const cols = [
    { h: "What moves", get: (r) => (r.first ? r.f.what : "") },
    { h: "From → to", get: (r) => (r.first ? `${r.f.from ?? "anywhere"} → ${r.f.to ?? "?"}${r.f.hops != null ? ` (${r.f.hops} hop${r.f.hops === 1 ? "" : "s"})` : ""}` : "") },
    { h: "lb", num: true, get: (r) => (r.first ? `${fmt(r.f.lbs, 1)} ${r.f.per}` : "") },
    { h: "Carrier", get: (r) => r.c.carrier },
    { h: "Units under the cap", num: true, get: (r) => r.c.underCap ?? "—" },
    { h: "Units under the hard cap", num: true, get: (r) => r.c.underHard ?? "—" },
    { h: "Trips", num: true, get: (r) => r.c.trips },
    { h: "Overburdened on a trip", get: (r) => yn(r.c.overburdened), style: (r) => (r.c.overburdened ? "color:var(--bad)" : "") },
    { h: "Crated lb", num: true, get: (r) => (r.cr ? fmt(r.f.cratedLbs, 0) : "—") },
    { h: "Crated trips", num: true, get: (r) => (r.cr ? r.cr.trips : "—") },
    { h: "Crated, Overburdened", get: (r) => (r.cr ? yn(r.cr.overburdened) : "—") },
    { h: "Note", get: (r) => (r.first ? r.f.note : "") },
  ];
  const sq = X.squeezeFlow;
  const cl = X.carryLimited;
  const bare = cl.find((r) => r.key === "bare");
  const crated = cl.find((r) => r.key === "crated");
  const cart = cl.find((r) => r.key === "cart");
  const bars = cl.map((r) => ({ label: `Factory solo, ${r.label}`, value: r.perTurn, color: r.key === "bare" ? "var(--bad)" : "var(--c0)" }));
  const heavy = X.flows.filter((f) => f.lbs > X.base / 2);
  return `<section><h2>Transport: what is hard to carry</h2>
<p class="lede">Measured with the game's own carry rules (<code>db/lib/carry.js</code>): the base cap is <b>${X.base} lb</b> (GameConfig.carryWeightLbs), carry bonuses add to one multiplier, and nothing can be picked up past <b>${fmt(X.hardRatio, 1)}×</b> the cap. Between the cap and the hard cap you are Overburdened, which zeroes the ${X.freeCrossings} free zone crossing${X.freeCrossings === 1 ? "" : "s"} a turn, so a crossing costs the Move. A crate weighs half of what went in, rounded up (up to ${X.packageMaxLbs} lb and ${X.packageMaxUnits} units a crate), and can only be packed where Packaging Equipment is: ${listAnd(X.packaging.map((p) => `the ${esc(p.where)} in ${esc(p.zone)}${p.access.length ? ` (behind the ${esc(listAnd(p.access))})` : ""}`))}. Packing costs no Move. ⬢ cannot go in a hand-packed crate, though a Depot order arrives crated. ${heavy.length ? `${listAnd(heavy.map((f) => esc(f.what)))} weigh${heavy.length === 1 ? "s" : ""} more than half the base cap.` : ""}</p>
${table({ cols: carrierCols, rows: X.carriers, id: "carriers" })}
${table({ cols, rows, id: "transport" })}
<h3>Factory solo, carry-limited</h3>
<p class="lede">A solo refiner's cycle is a shift and a rest turn, and the cubes go to the Depot on one trip a cycle. A shift is ${sq.units} cubes, ${fmt(sq.lbs, 0)} lb, against the ${X.base} lb cap. ${bare ? `Bare and uncrated, only what fits under the hard cap gets there, ${fmt(bare.load, 0)} lb, ${fmt(bare.share * 100, 0)}% of the shift${bare.overburdened ? ", and the trip is Overburdened so its crossing costs the Move (the rest turn's, which a solo refiner has spare)" : ""}; the rest is set down at the Factory and waits: <b>${fmt(bare.perTurn)} ¢ a turn</b>.` : ""} ${crated ? `Crated at the Factory the shift is ${fmt(crated.load, 0)} lb${crated.overburdened ? ", still Overburdened" : ", under the cap"}, and all of it gets there: ${fmt(crated.perTurn)} ¢.` : ""} ${cart ? `With a ${esc(cart.label)}, ${fmt(cart.perTurn)} ¢, though a Cart cannot go indoors (CARRY.md §3), so the cubes are brought out to it.` : ""} The wages tab carries the bare, uncrated figure as its own bar.</p>
${barChart({ rows: bars, unit: " ¢", labelW: 280 })}
</section>`;
}

// Weapons: hands, the best shield a one-handed weapon can carry, and the specialty the resolver pairs with it.
function combatWeapons(K) {
  const cols = [
    { h: "Weapon", get: (w) => w.name },
    { h: "Class", get: (w) => w.kind.replace(/^weapon \((.*)\)$/, "$1") },
    { h: "Hands", num: true, get: (w) => w.hands },
    { h: "With a shield?", get: (w) => (w.withShield ? "yes" : "no") },
    { h: "Points", num: true, get: (w) => (w.points ? w.points : "—"), sort: (w) => w.points },
    { h: "¢", num: true, get: (w) => (w.coin != null ? w.coin : "—"), sort: (w) => w.coin ?? -1 },
    { h: "Weight lb", num: true, get: (w) => w.weight },
    { h: "On the first two rungs", get: (w) => w.onRungs },
    { h: "Best shield: melee / ballistic", get: (w) => (w.shield ? `${w.shield.name}: ${w.shield.melee} / ${w.shield.ballistic}` : "—") },
    { h: "Weapon + shield lb", num: true, get: (w) => (w.shield ? w.shield.total : "—") },
    { h: "With its specialty", get: (w) => (w.specialty ? `${w.specialty.name} (${w.specialty.points} pt): ${w.specialty.band}, +${w.specialty.steps}` : "—") },
  ];
  const tr = K.twoHandTrade;
  const flamboyant = K.weapons.find((w) => w.specialty?.unarmoured);
  return `<h3>Weapons: hands, shields and specialties</h3>
<p class="lede">A two-handed weapon (the catalog's <code>twoHanded</code>) leaves no hand for a shield; a one-handed one can carry the best shield on offer, ${K.bestShield ? `the ${esc(K.bestShield.name)} (melee ${esc(K.bestShield.melee)}, ballistic ${esc(K.bestShield.ballistic)}, ${K.bestShield.weight} lb)` : "none"}. ${tr ? `So the choice at the top is ${esc(tr.two.name)} two-handed at <b>${esc(tr.two.band)}</b> with no shield, against ${esc(tr.one.name)} at <b>${esc(tr.one.band)}</b> with the ${esc(tr.shield.name)} (${esc(tr.shield.melee)} melee, ${esc(tr.shield.ballistic)} ballistic).` : ""} The specialty is the one the resolver pairs with the weapon (a specialism scores with the weapon it names), at its chain's cost and on top of the first two rungs. ${flamboyant ? `${esc(flamboyant.specialty.name)} only counts with no body armour, so it trades against every armour kit below.` : ""}</p>
${table({ cols, rows: K.weapons, id: "combatweapons", filters: [{ label: "Hands", get: (w) => w.hands }] })}`;
}

// Armour kits: every legal one-or-none a slot, both fields, the weight, and the fronts. Rendered twice, the second
// time with the dominant piece held out (combat.js#armourKitsWithout); a switch swaps which one shows. The first is
// visible and the switch hidden in the HTML itself, so with no script the page reads as it always did.
function combatArmourKits(K, E) {
  const W = K.armourKitsWithout;
  if (!W) return armourKitsBody(K.armourKits, "", "", E);
  const A = K.armourKits;
  const h = W.heldOut;
  const inSlot = W.bySlot.find((g) => g.slot === h.slot)?.pieces[0] ?? null;
  const replaced = h.hand
    ? W.bestShield
      ? `the best shield becomes the ${esc(W.bestShield.name)} (melee ${esc(W.bestShield.melee)}, ballistic ${esc(W.bestShield.ballistic)}, ${W.bestShield.weight} lb)`
      : "no shield is left"
    : inSlot
      ? `the best ${esc(h.slot)} piece becomes the ${esc(inSlot.name)}`
      : `nothing is left in ${esc(h.slot)}`;
  const pc1 = (v) => `${fmt(v * 100, 1)}%`;
  const drop = (f) => {
    const pts = Math.round(W.drop[f] * 1000) / 10;
    return pts > 0 ? `drops from ${pc1(A.ceiling[f])} to ${pc1(W.ceiling[f])}, ${fmt(pts, 1)} percentage point${pts === 1 ? "" : "s"}` : `stays at ${pc1(A.ceiling[f])}`;
  };
  const lede = `<p class="lede"><b>With the ${esc(h.name)} held out.</b> It sits in ${h.efficientKits} of the ${h.of} efficient kits, more than any other piece, so this is every kit a player can assemble without it. ${replaced[0].toUpperCase() + replaced.slice(1)}; the ballistic ceiling ${drop("ballistic")}, and the melee ceiling ${drop("melee")}. ${W.efficient.length} kits are efficient without it, against ${A.efficient.length} with it.</p>`;
  return `<p class="switch" id="armour-holdout-switch" hidden><label><input type="checkbox" id="armour-holdout" data-key="economy-report:armour-hold-out"> Hold out the ${esc(h.name)}</label></p>
<div id="armour-with">${armourKitsBody(A, "", "", E)}</div>
<div id="armour-without" hidden>${armourKitsBody(W, "wo", lede, E)}</div>`;
}

function armourKitsBody(A, sfx, heldLede, E) {
  const band = (p) => (p <= 0 ? "var(--c0)" : p < 5 ? "var(--c3)" : p < 10 ? "var(--c1)" : p < 20 ? "var(--c2)" : "var(--c4)");
  const bandLabel = [["var(--c0)", "0 pt"], ["var(--c3)", "1–4 pt"], ["var(--c1)", "5–9 pt"], ["var(--c2)", "10–19 pt"], ["var(--c4)", "20+ pt"]];
  // One dot a distinct (weight, value): the cheapest kit that lands there stands for the rest.
  const dots = (field) => {
    const at = new Map();
    for (const k of A.kits) {
      const key = `${k.weight}|${k[field]}`;
      const cur = at.get(key);
      if (!cur || k.points < cur.points) at.set(key, k);
    }
    return [...at.values()].map((k) => ({ x: k.weight, y: k[field] * 100, family: "armour", color: band(k.points), label: `${k.pieces.join(" + ")} (${k.points} pt${k.blackMarket ? ", a Black Market piece" : ""})`, r: A.fronts[field].includes(k) ? 5 : 2.5, marker: A.fronts[field].includes(k) ? "ring" : null }));
  };
  const chart = (field) => scatter({ points: dots(field), xLabel: "total weight, lb", yLabel: `combined ${field} armour, %`, tip: (p) => `${p.label} — ${fmt(p.x, 0)} lb, ${fmt(p.y, 0)}%` });
  const legendLine = `<p class="legend">${bandLabel.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}<span>a ring marks the front</span></p>`;
  const kitCols = [
    { h: "Pieces", get: (k) => k.pieces.join(" + ") },
    { h: "Wins on", get: (k) => k.winsOn },
    { h: "Ballistic", num: true, get: (k) => `${fmt(k.ballistic * 100, 0)}% ${k.ballisticWord}`, sort: (k) => k.ballistic },
    { h: "Melee", num: true, get: (k) => `${fmt(k.melee * 100, 0)}% ${k.meleeWord}`, sort: (k) => k.melee },
    { h: "Weight lb", num: true, get: (k) => k.weight },
    { h: "Points", num: true, get: (k) => k.points },
    { h: "¢", num: true, get: (k) => (k.coin == null ? "not priced" : k.coin), sort: (k) => k.coin ?? 1e9 },
    { h: "¢ in play", num: true, get: (k) => (k.coinIn == null ? "not priced" : fmt(k.coinIn, 0)), sort: (k) => k.coinIn ?? 1e9 },
    { h: "Takes a hand", get: (k) => (k.hand ? "yes" : "no") },
    { h: "Black Market", get: (k) => (k.blackMarket ? "yes" : "") },
    { h: "Also does", get: (k) => k.also || "—" },
  ];
  const pieceCols = (kit) => [
    ...(kit ? [] : [{ h: "Why", get: (p) => p.reason }]),
    { h: "Piece", get: (p) => p.name },
    { h: "Slot", get: (p) => p.slot },
    { h: "Ballistic", num: true, get: (p) => `${fmt(p.ballistic * 100, 0)}%`, sort: (p) => p.ballistic },
    { h: "Melee", num: true, get: (p) => `${fmt(p.melee * 100, 0)}%`, sort: (p) => p.melee },
    { h: "Weight lb", num: true, get: (p) => p.weight },
    { h: "Points", num: true, get: (p) => p.points },
    { h: "¢", num: true, get: (p) => p.coin ?? "not priced" },
    { h: "Route in", get: (p) => (p.route ? `${p.route}${p.gmCatalog ? " (GM catalogue)" : ""}` : "—") },
    { h: kit ? "Seat that starts with it" : "Held by", get: (p) => p.roles.join(", ") || "—" },
    { h: "Against what anyone can wear", get: (p) => p.verdict ?? "—" },
    { h: "Also does", get: (p) => p.also || "—" },
  ];
  const slotCols = [
    { h: "Slot", get: (p) => p.slot },
    { h: "Piece", get: (p) => p.name },
    { h: "In efficient kits", num: true, get: (p) => p.efficientKits, sort: (p) => p.efficientKits },
    { h: "Ballistic front", num: true, get: (p) => p.frontBallistic, sort: (p) => p.frontBallistic },
    { h: "Melee front", num: true, get: (p) => p.frontMelee, sort: (p) => p.frontMelee },
    { h: "Best-at-a-limit picks", num: true, get: (p) => p.picks, sort: (p) => p.picks },
    { h: "Ballistic", num: true, get: (p) => `${fmt(p.ballistic * 100, 0)}% ${p.ballisticWord}`, sort: (p) => p.ballistic },
    { h: "Melee", num: true, get: (p) => `${fmt(p.melee * 100, 0)}% ${p.meleeWord}`, sort: (p) => p.melee },
    { h: "Weight lb", num: true, get: (p) => p.weight },
    { h: "Points", num: true, get: (p) => p.points },
    { h: "¢", num: true, get: (p) => p.coin ?? "not priced" },
    { h: "¢ in play", num: true, get: (p) => (p.coinIn == null ? "not priced" : fmt(p.coinIn, 0)), sort: (p) => p.coinIn ?? 1e9 },
    { h: "Cheapest way in", get: (p) => p.coinHow ?? "—" },
    { h: "Route in", get: (p) => (p.route ? `${p.route}${p.gmCatalog ? " (GM catalogue)" : ""}` : "—") },
    { h: "Also does", get: (p) => p.also || "—" },
  ];
  // A piece that pays in ¢ a turn besides its armour, against the best-armoured piece in the same slot.
  const payers = A.bySlot.flatMap((g) =>
    g.pieces
      .filter((p) => p.alsoCoin > 0)
      .map((p) => {
        const bestOn = (f) => [...g.pieces].sort((a, b) => b[f] - a[f] || a.weight - b.weight)[0];
        const bb = bestOn("ballistic");
        const bm = bestOn("melee");
        const beat = [bb.slug !== p.slug && bb.ballistic > p.ballistic ? `the ${esc(bb.name)} on ballistic (${fmt(bb.ballistic * 100, 0)}% ${esc(bb.ballisticWord)})` : "", bm.slug !== p.slug && bm.melee > p.melee ? `the ${esc(bm.name)} on melee (${fmt(bm.melee * 100, 0)}% ${esc(bm.meleeWord)})` : ""].filter(Boolean);
        return `In ${esc(g.slot)}, the ${esc(p.name)} (${fmt(p.ballistic * 100, 0)}% ballistic ${esc(p.ballisticWord)}, ${fmt(p.melee * 100, 0)}% melee ${esc(p.meleeWord)}) also clears ${fmt(p.alsoCoin, 1)} ¢ a turn for a miner (the investments tab's figure)${beat.length ? `; the best words in the slot are ${listAnd(beat)}, which pay nothing, so a miner trades those words for the ¢` : ""}.`;
      })
  );
  const slotRows = A.bySlot.flatMap((g) => g.pieces);
  const slotLede = A.bySlot
    .filter((g) => g.pieces.length)
    .map((g) => `${esc(g.slot)}: ${esc(g.pieces[0].name)} (in ${g.pieces[0].efficientKits} of ${A.efficient.length} efficient kits${g.pieces[1] && g.pieces[1].efficientKits ? `, then ${esc(g.pieces[1].name)} in ${g.pieces[1].efficientKits}` : ""})`)
    .join("; ");
  const pickCell = (k, field) => (k ? `${fmt(k[field] * 100, 0)}% (${k.pieces.join(" + ")}, ${k.weight} lb, ${k.points} pt)${k.also ? `; also ${k.also}` : ""}` : "—");
  const limitCols = (unit) => [
    { h: `Up to`, get: (r) => `${r.limit} ${unit}` },
    { h: "Best ballistic", get: (r) => pickCell(r.ballistic, "ballistic") },
    { h: "Best melee", get: (r) => pickCell(r.melee, "melee") },
  ];
  // The ¢ budgets: priced off the equipment tab's REPLACE lens (combat.js#priceKits), the full set last.
  const coinCell = (k, field) => (k ? `${fmt(k[field] * 100, 0)}% ${k[`${field}Word`]} (${k.pieces.join(" + ")}, ${fmt(k.coinIn, 0)} ¢, ${k.weight} lb${k.blackMarket ? ", a Black Market piece" : ""})${k.also ? `; also ${k.also}` : ""}` : "nothing");
  const coinCols = [
    { h: "Up to", get: (r) => (Number.isFinite(r.limit) ? `${r.limit} ¢` : "any ¢") },
    { h: "Best ballistic", get: (r) => coinCell(r.ballistic, "ballistic") },
    { h: "Best melee", get: (r) => coinCell(r.melee, "melee") },
  ];
  const cheapestLine = (field) => listAnd((A.cheapest?.[field] ?? []).filter((x) => x.kit).map((x) => `${esc(x.word)} for ${fmt(x.kit.coinIn, 0)} ¢ (${esc(x.kit.pieces.join(" + "))})`));
  const at = (lim) => A.byCoin?.find((r) => r.limit === lim) ?? null;
  const buys = (r) => (r && (r.ballistic || r.melee) ? (r.ballistic && r.melee && r.ballistic.pieces.join() === r.melee.pieces.join() ? `the ${esc(r.ballistic.pieces.join(" + "))} (${fmt(r.ballistic.ballistic * 100, 0)}% ballistic, ${fmt(r.ballistic.melee * 100, 0)}% melee, ${fmt(r.ballistic.coinIn, 0)} ¢)` : `${r.ballistic ? `the ${esc(r.ballistic.pieces.join(" + "))} for ballistic (${fmt(r.ballistic.ballistic * 100, 0)}%, ${fmt(r.ballistic.coinIn, 0)} ¢)` : "nothing for ballistic"} or ${r.melee ? `the ${esc(r.melee.pieces.join(" + "))} for melee (${fmt(r.melee.melee * 100, 0)}%, ${fmt(r.melee.coinIn, 0)} ¢)` : "nothing for melee"}`) : "nothing");
  const sat = A.coinSaturates ?? {};
  const coinLede = A.byCoin
    ? `<p class="lede">Every kit whose pieces all have a price in play: ${A.coinPriced.kits} of ${A.coinPriced.of}${A.coinPriced.unpricedPieces.length ? ` (${listAnd(A.coinPriced.unpricedPieces.map(esc))} ${A.coinPriced.unpricedPieces.length === 1 ? "has" : "have"} none)` : ""}. A piece's price is the equipment tab's cheapest way in (<code>equipment.js#replaceOf</code>): the shelf where it is stocked, what a maker would take (the counter's sell price, as a floor), or making it yourself, ⬢ at the Depot's price plus inputs and the Moves at ${fmt(E.moveValue, 1)} ¢ each; the "Cheapest way in" column above says which. 25 ¢ buys ${buys(at(25))}. The first 100 ¢ buys ${buys(at(100))}. ${sat.ballistic && sat.melee ? `Money stops mattering at ${fmt(sat.ballistic.coin, 0)} ¢ on ballistic (${fmt(sat.ballistic.value * 100, 0)}%, the ${esc(sat.ballistic.kit.pieces.join(" + "))}) and ${fmt(sat.melee.coin, 0)} ¢ on melee (${fmt(sat.melee.value * 100, 0)}%, the ${esc(sat.melee.kit.pieces.join(" + "))}); past those, more ¢ buys less than a tenth of a percentage point.` : ""} The cheapest kit to each word, ballistic: ${cheapestLine("ballistic")}. Melee: ${cheapestLine("melee")}.</p>`
    : "";
  const lightest = (field) => listAnd(A.lightest[field].map((x) => `${esc(x.word)} at ${x.kit.weight} lb (${esc(x.kit.pieces.join(" + "))})`));
  const steps = (field) => A.steps[field].map((k) => (k ? fmt(k[field] * 100, 0) : "—")).join("%, ");
  const disagree = [...A.byPoints, ...A.byWeight].filter((r) => r.ballistic && r.melee && r.ballistic.pieces.join() !== r.melee.pieces.join());
  const shields = A.pieces.filter((p) => p.hand).sort((a, b) => b.melee - a.melee);
  const shieldSplit = shields.find((p) => p.melee > p.ballistic);
  const shieldOther = shields.find((p) => p.ballistic > p.melee);
  return `<h3>Armour kits: pieces stack across slots</h3>
${heldLede}<p class="lede">Of the ${A.pieces.length + A.kitOnly.length + A.setAside.length} armour pieces, <b>${A.pieces.length}</b> are ones an ordinary player can come by and wear${A.pieces.filter((p) => p.gmCatalog).length ? ` (${A.pieces.filter((p) => p.gmCatalog).length} of those sit in the GM catalogue but have a route in: ${listAnd(A.pieces.filter((p) => p.gmCatalog).map((p) => `${esc(p.name)} by ${esc(p.route)}`))})` : ""}, ${A.kitOnly.length} only a player seat starts with, and ${A.setAside.length} are set aside (${listAnd([...new Set(A.setAside.map((p) => p.reason))].map((r) => `${A.setAside.filter((p) => p.reason === r).length} ${esc(r)}`))}); only the first group is combined. Every legal kit, one piece or none a slot (${esc(A.slots.join(", "))}): ${A.count} kits. Pieces stack on what gets through (<code>armorValue.js#combineArmor</code>), so each piece adds less than the last, and both fields stop at the ${fmt(A.ceiling.cap * 100, 0)}% cap; a full kit reaches ${fmt(A.ceiling.ballistic * 100, 0)}% ballistic and ${fmt(A.ceiling.melee * 100, 0)}% melee. The best one, two and three pieces give ${steps("ballistic")}% ballistic and ${steps("melee")}% melee. The lightest kit to each word, ballistic: ${lightest("ballistic")}. Melee: ${lightest("melee")}. ${disagree.length ? `The two fields disagree on the best kit at ${disagree.length} of the ${A.byPoints.length + A.byWeight.length} limits below, which is the choice a player is actually making` : "The two fields agree on the best kit at every limit below"}${shieldSplit && shieldOther ? `; among shields, the ${esc(shieldSplit.name)} is ${fmt(shieldSplit.melee * 100, 0)}% melee to ${fmt(shieldSplit.ballistic * 100, 0)}% ballistic and the ${esc(shieldOther.name)} ${fmt(shieldOther.melee * 100, 0)}% to ${fmt(shieldOther.ballistic * 100, 0)}%` : ""}. </p>
${legendLine}
<h4>Ballistic, against weight</h4>${chart("ballistic")}
<h4>Melee, against weight</h4>${chart("melee")}
<h4>The efficient kits: nothing lighter stops more on that field</h4>
${table({ cols: kitCols, rows: A.efficient, id: "armourfront" + sfx })}
<h4>Best at each weight, and for each points budget</h4>
${table({ cols: limitCols("lb"), rows: A.byWeight, id: "armourweight" + sfx })}
${table({ cols: limitCols("points"), rows: A.byPoints, id: "armourpoints" + sfx })}
${A.byCoin ? `<h4>Best for each ¢ budget</h4>
${coinLede}
${table({ cols: coinCols, rows: A.byCoin, id: "armourcoin" + sfx })}` : ""}
<h4>Best options by slot</h4>
<p class="lede">A piece is as good as the kits it ends up in: for each slot, the pieces ranked by how many of the ${A.efficient.length} efficient kits hold them (either front), with the best-at-a-limit picks beside. ${slotLede}. ${payers.join(" ")}</p>
${table({ cols: slotCols, rows: slotRows, id: "armourbyslot" + sfx, filters: [{ label: "Slot", get: (p) => p.slot }] })}
<h4>Kit only: pieces a player seat starts with</h4>
<p class="lede">Nobody else can come by these, so they are out of the kits above, but a player in the seat does wear one.</p>
${table({ cols: pieceCols(true), rows: A.kitOnly, id: "armourkitonly" + sfx })}
<h4>Set aside</h4>
<p class="lede">Out of every kit, chart and table above: GM-catalogue or secret pieces, antagonist kit, and pieces with no way into play.</p>
${table({ cols: pieceCols(false), rows: A.setAside, id: "armoursetaside" + sfx, filters: [{ label: "Why", get: (p) => p.reason }] })}`;
}

// Situational tags a GM might count in a cave fight: never on the sheet's number.
function combatSituational(K) {
  const cols = [
    { h: "Tag", get: (r) => r.name },
    { h: "Points (the chain)", num: true, get: (r) => r.points, sort: (r) => r.points },
    { h: "Tiers if counted", num: true, get: (r) => (r.tiers == null ? "—" : fmt(r.tiers, 1)), sort: (r) => r.tiers ?? 0 },
    { h: "Counts", get: (r) => r.condition },
    { h: "Tree", get: (r) => r.tree ?? "—" },
    { h: `An untrained (${esc(K.caveBase)}) caver fights at`, get: (r) => r.band },
    { h: "Gain from untrained / I / II", num: true, get: (r) => [r.gainFromUntrained, r.gainFromI, r.gainFromII].map((g) => (g == null ? "—" : fmt(g, 1))).join(" / "), sort: (r) => r.gainFromUntrained ?? -1e9 },
    { h: "Caver's gain ¢, if counted (average)", num: true, get: (r) => fmt(r.caverGain, 1), sort: (r) => r.caverGain },
  ];
  const best = K.situational.filter((r) => r.caverGainPerPoint != null && r.caverGainPerPoint > 0)[0];
  return `<h3>Situational tags a GM might count underground</h3>
<p class="lede">The resolver never adds a situational tag to the number; a GM does, from the fiction (<code>COMBAT.md</code> §2). These are the ones that plausibly apply in a cave fight, read from the catalog: named ones, and any situational or conditional tag whose description speaks of caves, the dark, monsters or tunnels. <b>None of them is on the sheet's word.</b> Each is scored as if a GM counted it, for an untrained ${esc(K.caveBase)} fighter, at the better of the two trees, and priced under the same assumed band → trouble mix. ${best ? `If a GM counts it, <b>${esc(best.name)}</b> is worth the most per point to a caver, ${fmt(best.caverGainPerPoint, 2)} ¢ an expedition a point.` : ""}</p>
${table({ cols, rows: K.situational, id: "combatsituational" })}`;
}

function sectionMedicine() {
  const M = model.medical;
  const yn = (b) => (b ? "yes" : "no");
  const c = (v) => (Number.isFinite(v) ? fmt(v, 1) : "∞");
  const ladderCols = [
    { h: "Rung", num: true, get: (r) => r.rung },
    { h: "⬢", num: true, get: (r) => r.resources },
    { h: "Move share", num: true, get: (r) => r.turns },
    { h: "Skill", get: (r) => r.skill },
    { h: "Gambit", get: (r) => yn(r.gambit) },
    { h: "Needs a site", get: (r) => yn(r.site) },
    { h: `¢ at ${params.rv.buy} ¢ a ⬢`, num: true, get: (r) => r.coinAtBuy },
    { h: `¢ at ${fmt(params.rv.mid, 1)} ¢ a ⬢`, num: true, get: (r) => fmt(r.coinAtMid, 1) },
    { h: "Health tags on it", get: (r) => r.tags.map((t) => t.name).join(", ") },
    { h: "Off the block", get: (r) => r.offBlock.join(", ") || "—" },
  ];
  const tierCols = [
    { h: "Medic", get: (t) => `${t.name} (${t.points} pt, the chain)` },
    { h: "Free 0-turn cures", num: true, get: (t) => t.freePool },
    { h: "With the one Move", get: (t) => t.perMove.map((p) => `${p.count} rung-${p.rung} (${p.resources} ⬢)`).join(" or ") },
    { h: "Above their tier, a Gambit", get: (t) => t.above.map((a) => `rung ${a.rung}: ${Math.round(a.p * 100)}%`).join(", ") || "—" },
  ];
  const leaveCols = [
    { h: "Health tag", get: (r) => r.name },
    { h: "Rung", num: true, get: (r) => r.rung ?? "—" },
    { h: "Treat now ¢", num: true, get: (r) => c(r.costNow), sort: (r) => r.costNow },
    { h: "By", get: (r) => r.costHow },
    { h: "Wait ¢ (expected)", num: true, get: (r) => c(r.waitCost), sort: (r) => (Number.isFinite(r.waitCost) ? r.waitCost : 1e9) },
    { h: "If left", get: (r) => r.odds },
    { h: "Turns to decide", num: true, get: (r) => r.duration ?? "—" },
    { h: "Verdict", get: (r) => r.verdict, style: (r) => (r.verdict === "treat now" ? "color:var(--bad);font-weight:600" : r.verdict === "wait" ? "color:var(--good);font-weight:600" : "") },
    { h: "Saved by waiting ¢", num: true, get: (r) => (r.saved ? fmt(r.saved, 1) : "—"), sort: (r) => r.saved },
    { h: "Why", get: (r) => r.reason },
  ];
  const triageCols = [
    { h: "#", num: true, get: (r) => r.order },
    { h: "Health tag", get: (r) => r.name },
    { h: "Who takes it", get: (r) => r.who },
    { h: "Why this place in the queue", get: (r) => r.why },
    { h: "A lower tier's Gambit", get: (r) => r.lowerGambit ?? "—" },
  ];
  const reachCols = [
    { h: "Wound", get: (r) => r.name },
    { h: "Turns to death untreated", num: true, get: (r) => r.deadTurns },
    { h: "Needs a site", get: (r) => yn(r.site) },
    ...M.injuryZones.map((z) => ({ h: `From ${z}`, get: (r) => { const b = r.byZone.find((x) => x.zone === z); return `${b.hops ?? "?"} hop${b.hops === 1 ? "" : "s"}${r.site ? (b.inTime ? ", in time" : ", too far") : ""}`; } })),
  ];
  const injCols = [
    { h: "Injury", get: (r) => r.name },
    { h: "A turn", num: true, get: (r) => fmt(r.perTurn, 2), sort: (r) => r.perTurn },
    { h: "From", get: (r) => r.sources.join(", ") },
    { h: "Rung", num: true, get: (r) => r.rung ?? "—" },
    { h: "Needs", get: (r) => (r.tier ? `Medical ${"I".repeat(r.tier)}` : "—") },
    { h: "Medic ¢ a cure", num: true, get: (r) => fmt(r.medicCoin, 1), sort: (r) => r.medicCoin ?? -1 },
    { h: "Cheapest item", get: (r) => (r.item ? `${r.item.name}, ${r.item.coin} ¢${r.item.administer ? ` (needs ${r.item.administer} to apply)` : ""}` : "none") },
    { h: "Item beats a medic", get: (r) => (r.itemBeatsMedic == null ? "—" : yn(r.itemBeatsMedic)) },
  ];
  const capCols = [
    { h: "Work needing", get: (r) => `${r.name} or better` },
    { h: "Medics of that tier or above", num: true, get: (r) => r.medicsAtOrAbove },
    { h: "Moves a turn needed", num: true, get: (r) => fmt(r.movesNeeded, 2) },
    { h: "Surplus", num: true, get: (r) => fmt(r.surplus, 2), style: (r) => (r.surplus < 0 ? "color:var(--bad);font-weight:600" : "") },
  ];
  const bars = [
    ...M.need.map((n) => ({ label: `${n.name} work, Moves a turn`, value: n.moves, color: "var(--bad)" })),
    ...M.medics.map((m) => ({ label: `${m.name} medics (${m.roles.join(", ") || "none"})`, value: m.seats, color: "var(--c0)" })),
  ];
  const waits = M.leave.filter((r) => r.verdict === "wait" && r.saved > 0).slice(0, 4);
  const short = M.capacity.filter((r) => r.surplus < 0);
  const K = M.knobs;
  return `<section><h2>Medicine: what a medic can treat</h2>
<p class="lede">The cure ladder, read off the catalog's health tags: each rung's block is the one its tags carry most often, and anything else on the rung is listed as off the block. Dying sits off the ladder: ${M.dying ? `${M.dying.resources} ⬢, ${M.dying.turns} Move, ${esc(M.dying.skill)}, ${M.dying.gambit ? "always a Gambit" : "no Gambit"}` : "not in the catalog"}. Rungs that need ${esc(M.rungs.find((r) => r.site)?.skill ?? "the top skill")} need a site. The ⬢ is paid by ${esc(M.payer)}.</p>
${table({ cols: ladderCols, rows: M.rungs, id: "medladder" })}
<h3>What one medic can treat a turn</h3>
<p class="lede">Every medic has a free pool of <b>${M.freePool} zero-turn cures</b> a turn; past it each costs ${M.spillShare} of the Move. The one Move buys the Move-costing rungs in shares, or one Gambit heal, which takes it all. Reaching above your tier is a Gambit at the game's own threshold (<code>db/lib/healGambit.js</code>), and a miss leaves the wound on and adds a complication scaled to the margin.</p>
${table({ cols: tierCols, rows: M.tiers, id: "medtiers" })}
<h3>Where</h3>
<p class="lede">Rungs below the site rule can be treated wherever the medic stands; the rest need a site: ${listAnd(M.sites.map((x) => `${esc(x.what)} at the ${esc(x.where)} (${esc(x.zone)})`))}. A Surgical Equipment kit is ${M.buyables.equipment.coin ?? "—"} ¢ or ${M.buyables.equipment.points} points and ${M.buyables.equipment.weight} lb; a ${esc(M.buyables.theater.name)} can be built for ${M.buyables.theater.resources} ⬢ and ${M.buyables.theater.moves} Moves (${esc(M.buyables.theater.skill)}); a ${esc(M.buyables.pack.name)} is a ${esc(M.buyables.pack.skill)} craft (${M.buyables.pack.resources} ⬢, ${M.buyables.pack.moves} Move) and costs −1 on the die when it is the only site. For each wound that can kill, the hops from where injuries happen to the nearest site, walked at the free crossings a turn:</p>
${table({ cols: reachCols, rows: M.reach, id: "medreach" })}
<h3>Leave it or treat it</h3>
<p class="lede">A computed comparison per health tag: what treating it now costs (its ⬢ at ${params.rvMain} ¢, its Move share at ${fmt(model.investments.moveValue, 1)} ¢, or the cheapest item that cures it), against the expected cost of letting its clock run once, each outcome priced at the cheaper of treating it then or waiting again. Anything with no cure and no harmful successor costs nothing; a loss nothing repairs is priced at a labelled ${M.permanentCost} ¢; death is infinite. <b>Wait</b> where waiting is cheaper and the next step is not Dying or death; <b>treat now</b> otherwise. ${waits.length ? `Waiting saves most on ${listAnd(waits.map((r) => `${esc(r.name)} (${fmt(r.saved, 1)} ¢)`))}.` : ""} At the injury rate below, a town that follows the verdicts saves about <b>${fmt(M.townSaved, 1)} ¢ a turn</b>.</p>
${table({ cols: leaveCols, rows: M.leave, id: "medleave", filters: [{ label: "Verdict", get: (r) => r.verdict }] })}
<h3>Triage</h3>
<p class="lede">The queue, by rule: first anything whose next step is Dying or death, soonest first; then anything that treating now saves on, by ¢ saved a Move of the medic's time; then the rest by rung; the ones best left alone last. Who takes it is the tier its cure needs (and a site above the site rule); where a lower tier can gamble, the odds are shown.</p>
${table({ cols: triageCols, rows: M.triage, id: "medtriage" })}
<h3>The town's injuries, and its medics</h3>
<p class="lede">An estimate, and the only typed inputs on this tab: <b>${K.caversPer100} cavers a turn per hundred players</b>, each stopping at ${K.troubleBudget} troubles; the Factory's ${fmt(M.cutsPerTurn, 1)} Godflesh cuts a turn, bare-handed, at the die's injury chance (<code>db/lib/godflesh.js</code>); ${K.turretTargetsPerTurn} turret targets; and one GM-adjudicated fight wound a turn per ${K.fightWoundPer} players. Miners take no injuries: a bad night is fatigue, not a wound. At ${players} players the medics are ${listAnd(M.medics.map((m) => `${m.seats} ${esc(m.name)} (${esc(m.roles.join(", ") || "none")})`))}. ${short.length ? `<b>The town is short of ${listAnd(short.map((r) => `${esc(r.name)}-or-better work by ${fmt(-r.surplus, 1)} Moves a turn`))}</b>, so that is where an item or a second medic pays.` : "The medics cover the estimate."} The town's medicine costs about ${fmt(M.coinPerTurn, 0)} ¢ a turn in ⬢.</p>
${barChart({ rows: bars, unit: "", labelW: 330, fmtVal: (v) => fmt(v, 1) })}
${table({ cols: capCols, rows: M.capacity, id: "medcap" })}
${table({ cols: injCols, rows: M.injuryRows, id: "medinj" })}
</section>`;
}

function sectionCombat() {
  const K = model.combat;
  const E = model.equipment;
  const pc = (v) => `${fmt(v * 100, 0)}%`;
  const cols = [
    { h: "Tag", get: (r) => r.name },
    { h: "Kind", get: (r) => r.kind },
    { h: "Tree", get: (r) => r.tree },
    { h: "Needs first", get: (r) => (r.needsFirst.length ? r.needsFirst.join(" ← ") : "—") },
    { h: "Points (the chain)", num: true, get: (r) => (r.points ? (r.points !== r.ownPoints ? `${r.points} (${r.ownPoints} own)` : r.points) : "—"), sort: (r) => r.points },
    { h: "¢", num: true, get: (r) => (r.coin != null ? `${r.coin} (${r.coinHow})` : "—"), sort: (r) => r.coin ?? -1 },
    { h: "Alone", get: (r) => r.alone, sort: (r) => r.steps },
    { h: "On the first rung", get: (r) => r.onI ?? "—" },
    { h: "On the first two rungs", get: (r) => r.onII ?? "—" },
    { h: "A caver fights at", get: (r) => `${r.caverBand} (${r.caverTree})`, sort: (r) => r.caverGain },
    { h: "Gain from untrained", num: true, get: (r) => (r.gainFromUntrained == null ? "—" : fmt(r.gainFromUntrained, 1)), sort: (r) => r.gainFromUntrained ?? -1e9 },
    { h: "…from I", num: true, get: (r) => (r.gainFromI == null ? "—" : fmt(r.gainFromI, 1)), sort: (r) => r.gainFromI ?? -1e9 },
    { h: "…from II", num: true, get: (r) => (r.gainFromII == null ? "—" : fmt(r.gainFromII, 1)), sort: (r) => r.gainFromII ?? -1e9 },
    { h: "Caver's gain ¢ an expedition", num: true, get: (r) => `${fmt(r.caverGain, 1)}${r.isRung ? " (the step)" : " (average)"}`, sort: (r) => r.caverGain },
    { h: "The step from the rung below", num: true, get: (r) => (r.marginalSteps == null ? "—" : `${r.marginalSteps} step${r.marginalSteps === 1 ? "" : "s"}${r.marginalGain != null ? `, ${fmt(r.marginalGain, 1)} ¢` : ""}`), sort: (r) => r.marginalGain ?? -1e9 },
    { h: "…per point", num: true, get: (r) => (r.caverGainPerPoint != null ? fmt(r.caverGainPerPoint, 2) : "—"), sort: (r) => r.caverGainPerPoint ?? -1e9 },
    { h: "…per ¢", num: true, get: (r) => (r.caverGainPerCoin != null ? fmt(r.caverGainPerCoin, 2) : "—"), sort: (r) => r.caverGainPerCoin ?? -1e9 },
  ];
  const armourCols = [
    { h: "Armour", get: (r) => r.name },
    { h: "Points", num: true, get: (r) => (r.points ? r.points : "—") },
    { h: "¢", num: true, get: (r) => r.coin ?? "—" },
    { h: "Ballistic (turrets roll against it)", get: (r) => r.ballistic },
    { h: "Melee (a GM reads the word)", get: (r) => r.melee },
  ];
  const mixRows = ["caves", "depths"].flatMap((zone) => K.mixByBand[zone].map((b) => ({ zone: zone === "caves" ? "Caves" : "Depths", ...b })));
  const mixCols = [
    { h: "Where", get: (r) => r.zone },
    { h: "Band", get: (r) => `${r.label}${r.baseline ? " (baseline)" : ""}`, sort: (r) => r.rank },
    { h: "Minor", num: true, get: (r) => pc(r.mix.minor), sort: (r) => r.mix.minor },
    { h: "Major", num: true, get: (r) => pc(r.mix.major), sort: (r) => r.mix.major },
    { h: "Lost limb", num: true, get: (r) => pc(r.mix.limb), sort: (r) => r.mix.limb },
    { h: "Death", num: true, get: (r) => pc(r.mix.death), sort: (r) => r.mix.death },
  ];
  const chart = lineChart({
    xLabels: K.byBand.map((b) => b.label),
    series: [
      { label: "no Lucky", color: "var(--c0)", values: K.byBand.map((b) => b.plain) },
      { label: "Lucky", color: "var(--c1)", values: K.byBand.map((b) => b.lucky) },
    ],
    xTitle: "fighting band",
    yTitle: `net ¢, Depths, ${K.budget}-trouble budget`,
    fmtVal: (v) => `${fmt(v, 1)} ¢`,
  });
  const step = K.byBand.length > 1 ? (K.byBand[K.byBand.length - 1].plain - K.byBand[0].plain) / (K.byBand.length - 1) : 0;
  const bp = K.bestPerPoint;
  const bc = K.bestPerCoin;
  return `<section><h2>Combat: what a fighting tag or weapon is worth</h2>
<p class="lede">The game shows how good somebody is in a fight as one of ${K.bands.length} words, ${listAnd(K.bands.map(esc))}, and never the number behind it, so this page does the same. Every tag and weapon a player can come by that carries a <code>fighting:</code> block is scored by the game's own resolver (<code>db/lib/fightingSkill.js</code>) on a made-up character: alone, and on top of the first rung and the first two rungs of its tree. A tag's cost is its whole chain, since you cannot skip to Melee IV: its points include everything it needs first, and "alone" means holding that chain. The step-from-below column is what the tag adds over holding only what it requires, the question a player one rung down is asking. An untrained character is <b>${esc(K.base.melee)}</b> in melee and <b>${esc(K.base.ranged)}</b> at range. For a caver, <b>ranged counts as much as melee, they do not stack, and the better of the two is the band a caver fights at</b>, so every ¢ figure below reads the better of the resolver's two bands (a tag that lifts both trees is scored once, on whichever it lifts higher). A tag is valued by the points it adds to the resolver's score, read on a line between the bands' midpoints, so a half tier is worth half a step wherever you start; valued by the band word alone, a character sitting just under an edge made half a tier look like a whole step. A trait or weapon is scored at three starting positions, untrained, on the first rung of its tree and on the first two, and its caver's gain is the average of the three, which smooths where the value of a point changes from one band to the next. The three columns stay, so a player already at a rung reads their own number. A rung is scored as its step from the rung below, since it is the ladder the positions are measured on. ${bp ? `Per point, <b>${esc(bp.name)}</b> buys the most band (${bp.steps} step${bp.steps === 1 ? "" : "s"} for ${bp.points} points)` : ""}${bc ? `; per ¢, <b>${esc(bc.name)}</b> (${bc.steps} step${bc.steps === 1 ? "" : "s"} for ${bc.coin} ¢)` : ""}.</p>
${(() => {
    // Value per cost: the caver's gain an expedition (the assumption below) divided by what the tag costs,
    // points at creation or ¢ at the shelf or counter. Two charts, since the two budgets are not exchangeable.
    const top = (key, n = 12) => K.tags.filter((r) => r[key] != null && r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, n);
    const perPt = top("caverGainPerPoint");
    const perCoin = top("caverGainPerCoin");
    if (!perPt.length && !perCoin.length) return "";
    return `<h3>Value per cost, for a caver</h3>
<p class="lede">The caver's gain an expedition from the table above, divided by the tag's price: per creation point for what is bought with points, per ¢ for what the shelf or the counter sells. Both trees score, each at the better-of band it gives a caver; the tree is marked on each bar. Armour is on the table with no gain. ${perPt[0] ? `Per point, <b>${esc(perPt[0].name)}</b> leads at ${fmt(perPt[0].caverGainPerPoint, 2)} ¢ a point an expedition` : ""}${perCoin[0] ? `${perPt[0] ? "; per" : "Per"} ¢, <b>${esc(perCoin[0].name)}</b> at ${fmt(perCoin[0].caverGainPerCoin, 2)} ¢ back for each ¢ spent, an expedition` : ""}.</p>
<p class="legend"><span><i style="background:var(--c0)"></i>melee</span><span><i style="background:var(--c1)"></i>ranged</span></p>
${perPt.length ? `<h4>¢ an expedition, per creation point</h4>${barChart({ rows: perPt.map((r) => ({ label: `${r.name} (${r.isRung ? `${r.ownPoints} pt, the step` : `${r.points} pt`}, ${r.caverTree})`, value: r.caverGainPerPoint, color: r.caverTree === "ranged" ? "var(--c1)" : "var(--c0)" })), unit: " ¢", labelW: 280, fmtVal: (v) => fmt(v, 2) })}` : ""}
${perCoin.length ? `<h4>¢ an expedition, per ¢ of price</h4>${barChart({ rows: perCoin.map((r) => ({ label: `${r.name} (${r.coin} ¢, ${r.coinHow}, ${r.caverTree})`, value: r.caverGainPerCoin, color: r.caverTree === "ranged" ? "var(--c1)" : "var(--c0)" })), unit: " ¢", labelW: 280, fmtVal: (v) => fmt(v, 2) })}` : ""}`;
  })()}
${table({ cols, rows: K.tags, id: "combattags", filters: [{ label: "Tree", get: (r) => r.tree }, { label: "Kind", get: (r) => r.kind.replace(/ \(.*\)/, "") }] })}
<h3>Armour</h3>
<p class="lede">Armour shows the two fractions it turns aside in the game's own words.${E.armorNote.turretReadsBallistic || E.armorNote.attackDocReadsArmour ? ` Both matter, with different readers: ballistic is rolled against by code${E.armorNote.turretReadsBallistic ? " (the turrets, <code>db/lib/depotTurret.js</code>)" : ""}; melee has no mechanical reader${E.armorNote.meleeUnread ? " (the schema says so)" : ""}, but a GM reads its word off the sheet when adjudicating a Gambit or an Attack${E.armorNote.attackDocReadsArmour ? " (<code>ATTACK.md</code>)" : ""}.` : ""}</p>
${table({ cols: armourCols, rows: K.armour, id: "combatarmour" })}
${combatWeapons(K)}
${combatArmourKits(K, E)}
${combatSituational(K)}
<h3>What a band step is worth to a caver: an assumption</h3>
<p class="lede">Nothing in the code turns a fighting band into a better outcome on the Caving Die's 1; a GM decides. So the mix below is <b>Bascinet's assumption, pending a real mechanic</b> (<code>caving.js</code> MIX_BY_BAND): the Caving tab's mix belongs to the band an untrained character stands in, so a baseline character's figures do not move, and each band better keeps ${fmt(K.bandStep * 100, 0)}% of the major, limb and death shares, the rest becoming minor wounds. Under it, a Depths caver who stops at ${K.budget} troubles gains about ${fmt(step, 1)} ¢ an expedition a band step on average, from ${fmt(K.byBand[0].plain, 1)} ¢ at ${esc(K.byBand[0].label)} to ${fmt(K.byBand[K.byBand.length - 1].plain, 1)} at ${esc(K.byBand[K.byBand.length - 1].label)} without Lucky. The tags that move the band on their own are on the investments page with that ¢ as their gain.</p>
${chart}
${table({ cols: mixCols, rows: mixRows, id: "combatmix", filters: [{ label: "Where", get: (r) => r.zone }] })}
</section>`;
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
<p class="lede">Mining and gathering are the only ways to make ⬢, and recipes are the sink; anyone with coin can also buy ⬢ at the Depot's ${params.rv.buy} ¢ import price, up to ${params.depotMaxQuantity} an order, so that price caps what a mined ⬢ fetches. A Prospector at the Caves brings in ${fmt(params.minerResourcesPerTurn)} ⬢ a turn (the ${fmt(params.productionCoefficient, 1)} production dial, the base range and the every-other-turn fatigue). Between players a ⬢ should change hands somewhere between the Depot's ${params.rv.sell} ¢ sell-back and its ${params.rv.buy} ¢ import price, so the headline figures for a Prospector value theirs at the midpoint, <b>${fmt(params.rv.mid, 1)} ¢</b>${params.minedValue === "mid" ? "" : ` (this run uses ${fmt(params.rvMined, 1)} ¢ instead)`}. ${params.obolFamilies.length ? `Who will actually pay for it depends on who can use obols instead. The Depot imports ⬢ at ${params.rv.buy} ¢ and buys them back at ${params.rv.sell} ¢, so a buyer who must hold real ⬢ will pay up to ${params.rv.buy} ¢, but <b>a smith can put one obol toward one ⬢</b> (<code>resolveObolSpend</code>, smithing only), so a smith will pay no more than ${params.rv.sell} ¢ and never has to import at all.` : `Every crafter must hold real ⬢ (no craft can be paid in obols), so the Depot's ${params.rv.buy} ¢ import price is the most any of them will pay a Prospector, and its ${params.rv.sell} ¢ sell-back is the least a Prospector will take.`}</p>
<h3>What a Prospector is worth</h3>
${table({ cols: pcols, rows: model.prospectorValue })}
<h3>Who needs ⬢</h3>
<p class="lede">“Prospectors per crafter” is how many Prospectors one crafter of that family needs behind them, working flat out. Gambit-free, median recipe. ${params.obolFamilies.length ? `Brewing, crafting and cooking cannot pay in obols, so they are the buyers who would pay the full ${params.rv.buy} ¢.` : `Nobody can pay in obols, so every family would pay up to the full ${params.rv.buy} ¢.`}</p>
${table({ cols, rows: model.resourceBalance })}</section>`;
}

function sectionLadder() {
  const keys = model.wages.filter((w) => !w.ceiling).map((w) => w.key);
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
  // Cooked (cooking.js's own figure: demand over the cooked harvest, no field pool behind it), then the
  // same town eating the raw harvest instead.
  const supply = [
    { label: "cooked (Basic Meal)", value: model.cooking.farmersToEatTown, color: "var(--c1)" },
    ...model.foodSupply.map((f) => ({ label: `${f.name}, eaten raw`, value: f.farmersNeeded, color: "var(--c3)" })),
  ];
  const floor = model.foodFloor;
  const box = floor.anyone;
  // Two markets: what anybody with coin can order from the Depot, and what a grower would be paid.
  // What a buyer pays at the shelf, which is not the same as what the food is worth (the table's column).
  const fromDepot = model.foods
    .filter((f) => f.shelf)
    .map((f) => ({ label: `${f.name}${f.shelf === "general" ? " (anyone)" : " (Merchant's shelf)"}`, value: f.buy * f.perPersonTurn, color: f.shelf === "general" ? "var(--c3)" : "var(--c1)" }))
    .sort((a, b) => a.value - b.value);
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
    { h: "Worth ¢", num: true, get: (f) => fmt(f.cost, 2), sort: (f) => f.cost },
    { h: "Priced at", get: (f) => ({ buy: "the Depot's price", sell: "what the counter pays", food: "as food, at the Ration Box's rate", dish: "its hunger and mood, at the Ration Box's rate", none: "no price" })[f.basis] ?? "—" },
    { h: "Worth ¢ per person-turn", num: true, get: (f) => fmt(f.costPerPersonTurn, 2), sort: (f) => f.costPerPersonTurn ?? 1e9 },
    { h: "lb per person-turn", num: true, get: (f) => fmt(f.lbPerPersonTurn, 2), sort: (f) => f.lbPerPersonTurn },
  ];
  const sup = model.foodSupply
    .map(
      (f) =>
        `<tr><td>${esc(f.name)}</td><td class="num">${fmt(f.harvest, 1)}</td><td class="num">${fmt(f.personTurnsPerFarm, 0)}</td><td class="num">${fmt(f.lbPerFarm, 1)}</td><td class="num">${fmt(f.farmersNeeded, 1)}</td></tr>`,
    )
    .join("");
  const crop = model.foods.find((f) => f.slug === params.stapleCrop);
  return `<section><h2>Food</h2>
<p class="lede">A person burns ${params.hungerDecayPerDay} hunger a day (${params.hungerDecayPerDayFast} with Big Appetite), split across the turns in a day and truncated per turn (db/lib/hunger.js#perTurnDecay) — <b>${params.hungerDecay} a turn</b> at this run's ${params.turnLengthHours}-hour turn (<code>--turn-hours N</code> tries another length; a live game reads its own <code>Turn.turnLengthHours</code>, which this report has no game to see). One Farm action sows ${params.farmMaxCrops} crops and about 1 in ${params.witherIn} wither, for about ${fmt(params.harvestPerFarm, 0)} Foodstuffs (${fmt(params.harvestPerFarmFert, 0)} fertilized: no wither, and 1 crop in ${params.bountyIn} comes up double). A farmer can take one Farm action every ${params.farmCycle} turns — a Farm action grants Exhausted outright, and Exhausted and Tired both refuse the next one.</p>
<h3>Farmers needed to feed ${players} players</h3>
<p class="lede">About <b>${fmt(model.cooking.farmersToEatTown, 1)} farmers</b> feed the town once their harvest is cooked into Basic Meals — demand over the cooked supply, with no field pool or refill behind it any more. The other bar is the same town eating the raw harvest instead, which takes far more.</p>
${barChart({ rows: supply, unit: " farmers", fmtVal: (v) => fmt(v, 1), labelW: 230 })}
<div class="tablewrap"><table><thead><tr><th>Crop</th><th class="num">Harvest / farm</th><th class="num">Person-turns / farm</th><th class="num">lb / farm</th><th class="num">Farmers needed</th></tr></thead><tbody>${sup}</tbody></table></div>
<h3>What food costs somebody with coin</h3>
<p class="lede">${box ? `The only food anyone can order without a licence is the <b>${esc(box.name)}</b>, ${box.buy} ¢ on the Depot's general shelf. It opens into one of ${floor.outcomes} equally likely outcomes (${floor.draws} draws, including a rat that half the time makes you sick, plus a chance of nothing), so it restores <b>${fmt(box.hunger, 1)} hunger on average</b> and costs <b>${fmt(box.costPerPersonTurn, 2)} ¢ a person-turn</b>, with an average mood of ${fmt(box.mood, 1)}. That is the cost of staying fed for anybody who can reach the counter, ${(() => {
    const realWages = model.wages.filter((w) => !w.ceiling);
    const mid = median(realWages.map((w) => w.value));
    const under = realWages.filter((w) => w.value < box.costPerPersonTurn);
    return `${mid == null ? "" : `${box.costPerPersonTurn < mid ? "under" : "over"} the median wage in this report (${fmt(mid)} ¢ a turn)`}${under.length ? `, though it costs more than ${under.length === 1 ? "one of them pays" : `${under.length} of them pay`}: ${listAnd(under.map((w) => `${esc(w.key)} ${fmt(w.value)} ¢`))}` : ""}`;
  })()}.` : ""}</p>
<p class="lede">${box && crop ? `It also sets the price of everything that has no price of its own. Nobody should pay a grower more than the box charges for the same hunger and mood, and the box charges ${fmt(floor.perPoint * 100, 1)} ¢ per 100 points (a point of mood counted as ${fmt(model.cooking.moodWeight, 2)} of hunger), so a ${crop.hunger}-hunger, ${crop.mood}-mood raw ${esc(crop.name)} is worth about ${fmt(crop.cost, 2)} ¢ to a buyer. ${crop.sell == null ? "The counter does not buy Foodstuffs at all, so a grower's only buyers are other players, and the box caps what they will pay. That is why farming is for eating, not cash." : `Foodstuffs sell to the counter for ${crop.sell} ¢.`}` : ""}</p>
${barChart({ rows: fromDepot, unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 250 })}
<h3>What growers and cooks make it for</h3>
<p class="lede">Not sold at the Depot, so these show what they are worth by the one food valuation: what the counter pays for them where it buys them, else their hunger and mood at the Ration Box's rate. A dish is worth its own hunger and mood at that rate. Dishes show the recipe's own restore only; extra ingredients add more.</p>
${barChart({ rows: fromGrowers, unit: " ¢", fmtVal: (v) => fmt(v, 2), labelW: 190 })}
<h3>Every food</h3>
<p class="lede">${model.foods.length} foods, each ${fmt(model.foods.length ? median(model.foods.map((f) => f.turnsOfFood)) : 0, 2)} of a turn's decay on average (the "Turns of food" a hover would show, not printed as its own column since the three meal classes and Foodstuffs now sit close together rather than in the wide raw/basic/skilled spread the old 36 recipes gave). "Worth" is the report's one food valuation: what the counter pays for it, else its hunger and mood at the Ration Box's rate, never more than the Depot asks; a dish is worth its own hunger and mood at that rate. It is not what a buyer pays at the shelf (the chart above). A food counts if the game restores hunger for it, and a thing that opens into food (the Ration Box) is averaged over what it can turn out.</p>
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
  const cols3 = [
    { h: "Dish", get: (d) => d.name },
    { h: "Made from", get: (d) => d.inputs.join(" + ") },
    { h: "Hunger", num: true, get: (d) => d.hunger, sort: (d) => d.hunger },
    { h: "Mood", num: true, get: (d) => d.mood, sort: (d) => d.mood },
    { h: "Inputs cost ¢", num: true, get: (d) => fmt(d.cost, 1), sort: (d) => d.cost },
    { h: "Worth (hunger + mood) ¢", num: true, get: (d) => fmt(d.value, 1), sort: (d) => d.value },
    { h: "Margin a Move ¢", num: true, get: (d) => fmt(d.marginPerMove, 0), sort: (d) => d.marginPerMove, style: () => "color:var(--bad);font-weight:600" },
  ];
  return `<section><h2>Docs against the model</h2>
<p class="lede">Each row is a number a system doc states, checked against what the catalog and code produce now. A “differs” is either a stale doc or a real bug, and only a person can say which.</p>
${table({ cols, rows: model.claims, sortable: false, filters: [{ label: "Doc", get: (c) => c.doc.split(" §")[0] }, { label: "Status", get: (c) => (c.ok ? "matches" : "differs") }] })}
<h3>Wares off the 60% sell-back rule</h3>
<p class="lede">Most are the wage-floor recipes <code>DEPOT.md</code> §3 names. Anything else, and any row marked ARBITRAGE (sells back for at least the buy price), is worth a look.</p>
${table({ cols: cols2, rows: off })}
<h3>Cooking: dishes losing far more than a bad wage</h3>
<p class="lede">Every wage this report finds elsewhere runs about 1 to 27 ¢ a turn. A dish here loses more than 50 ¢ a Move against its own ingredients' market cost, priced against what the same hunger and mood would cost from a Ration Box (see “Cooks against farmers”, run with <code>--mood-weight ${fmt(model.cooking.moodWeight, 2)}</code>) — spending a Move on nothing but it would leave you deep in the red against even the worst legitimate wage in the game. ${model.cooking.flagged.length ? "Either the ingredients really are that dear for what the dish gives back, or the pricing above missed something — worth a GM's eye." : "None at the moment: nothing here loses that badly."}</p>
${model.cooking.flagged.length ? table({ cols: cols3, rows: model.cooking.flagged, sortable: false }) : ""}</section>`;
}

function sectionAssumptions() {
  const rows = model.assumptions.map((a) => `<tr><td><code>${esc(a.key)}</code></td><td>${esc(a.value)}</td><td>${esc(a.why)}</td></tr>`).join("");
  const p = Object.entries(params)
    .filter(([, v]) => typeof v !== "object")
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(typeof v === "number" ? fmt(v, 2) : v)}</td></tr>`)
    .join("");
  return `<section><h2>What this leans on</h2>
<p class="lede">Read live from the repo (schema defaults, <code>db/lib</code> constants, the YAML masters). To look any catalog figure up yourself, <code>npm run catalog -- tags &lt;slug or name&gt;</code> prints the entry on one line (also roles, zones, locations, rooms and desires, with <code>--grep</code>, <code>--fields</code> and <code>--json</code>).</p>
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
.report-nav{display:flex;flex-wrap:wrap;gap:2px 16px;align-items:center;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:1}
.report-nav a{color:var(--mute);text-decoration:none;font-size:13px;white-space:nowrap;padding:4px 0}
.report-nav a:hover{color:var(--fg)}
.report-nav a[aria-current="page"]{color:var(--fg);font-weight:600;border-bottom:2px solid var(--accent)}
.report-brand{color:var(--fg)!important;font-weight:700;font-size:14px;margin-right:4px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 18px 12px;margin:0 0 18px}
.lede{color:var(--mute);margin:0 0 12px}
.switch{margin:0 0 10px;font-size:14px}.switch input{margin-right:6px;vertical-align:middle}
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
[data-tip]{cursor:default}
.rtip{position:fixed;pointer-events:none;background:var(--fg);color:var(--bg);font-size:12px;line-height:1.3;padding:5px 9px;border-radius:5px;max-width:280px;z-index:50;transform:translate(-50%,-100%);margin-top:-10px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
`;
const js = `
(function(){
  // The armour-kit hold-out switch on the combat tab. Remembering the choice is a convenience: a browser that
  // refuses site data still flips the view for this page load, the way the app's own stores behave.
  const box=document.getElementById('armour-holdout'),wrap=document.getElementById('armour-holdout-switch');
  const withEl=document.getElementById('armour-with'),withoutEl=document.getElementById('armour-without');
  if(!box||!withEl||!withoutEl)return;
  const key=box.dataset.key;
  const show=(on)=>{withEl.hidden=on;withoutEl.hidden=!on;box.checked=on;};
  let on=false;
  try{on=localStorage.getItem(key)==='1';}catch(e){}
  show(on);
  if(wrap)wrap.hidden=false;
  box.addEventListener('change',()=>{show(box.checked);try{localStorage.setItem(key,box.checked?'1':'0');}catch(e){}});
})();
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
});
(function(){
  // A shared tooltip for every chart shape carrying data-tip (bars, dots) — not the browser's native
  // title tooltip, which is slow to appear and did not fire reliably at all inside an iframe in some
  // hosts. One floating div, moved and re-labelled on hover, works the same everywhere.
  let tip=null;
  const place=(e)=>{if(tip){tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}};
  document.addEventListener('mouseover',(e)=>{
    const el=e.target.closest('[data-tip]');
    if(!el)return;
    if(!tip){tip=document.createElement('div');tip.className='rtip';tip.hidden=true;document.body.appendChild(tip);}
    tip.textContent=el.dataset.tip;
    tip.hidden=false;
    place(e);
  });
  document.addEventListener('mousemove',(e)=>{if(tip&&!tip.hidden&&e.target.closest('[data-tip]'))place(e);});
  document.addEventListener('mouseout',(e)=>{
    const el=e.target.closest('[data-tip]');
    if(el&&tip&&!el.contains(e.relatedTarget))tip.hidden=true;
  });
  document.addEventListener('focusin',(e)=>{
    const el=e.target.closest('[data-tip]');
    if(!el)return;
    if(!tip){tip=document.createElement('div');tip.className='rtip';tip.hidden=true;document.body.appendChild(tip);}
    tip.textContent=el.dataset.tip;
    const r=el.getBoundingClientRect();
    tip.style.left=(r.left+r.width/2)+'px';
    tip.style.top=r.top+'px';
    tip.hidden=false;
  });
  document.addEventListener('focusout',(e)=>{if(e.target.closest('[data-tip]')&&tip)tip.hidden=true;});
})();`;

// ---------------------------------------------------------------------------
// one file per section, not one 800 KB page
// ---------------------------------------------------------------------------
// Every section used to land in one `html` string, which made the report exactly as unreadable as its
// subject: 20-odd topics with no way to jump to one of them, and a single file too big to open twice
// while comparing. Each section keeps building its own `<section>…</section>` fragment exactly as it
// always did — nothing about what a section computes or shows has changed — only how the fragments
// become files did. `css`/`js` move to their own files instead of an inline `<style>`/`<script>` on
// every page, so the ~5 KB of both is fetched once and reused, not repeated 20-odd times over.
const SECTIONS = [
  { id: "wages", label: "What a turn is worth", build: sectionWages },
  { id: "baselines", label: "Baselines: the easy crafts", build: sectionBaselines },
  { id: "investments", label: "What each investment pays back", build: sectionInvestments },
  { id: "equipment", label: "Buyable gear, point for point", build: sectionEquipment },
  { id: "combos", label: "Combining activities", build: sectionCombos },
  { id: "transport", label: "Transport: what is hard to carry", build: sectionTransport },
  { id: "spread", label: "Every activity, by family", build: sectionSpread },
  { id: "fatigue", label: "Which work tires you", build: sectionFatigue },
  { id: "drops", label: "What a producer's action also drops", build: sectionDrops },
  { id: "caving", label: "The Caving Die", build: sectionCaving },
  { id: "lucky", label: "Lucky, use by use", build: sectionLucky },
  { id: "trinkets", label: "Trinket forging", build: sectionTrinkets },
  { id: "cooking", label: "Cooks against farmers", build: sectionCooking },
  { id: "desires", label: "Desires as an income", build: sectionDesires },
  { id: "starting", label: "The starting economy", build: sectionStarting },
  { id: "power", label: "Starting power, by role", build: sectionPower },
  { id: "balance", label: "The ⬢ market", build: sectionBalance },
  { id: "selltax", label: "What the sell tax does", build: sectionSellTax },
  { id: "combat", label: "Combat: what a fighting tag is worth", build: sectionCombat },
  { id: "medicine", label: "Medicine: what a medic can treat", build: sectionMedicine },
  { id: "activities", label: "The full table", build: sectionActivities },
  { id: "special", label: "What each recipe needs", build: sectionSpecial },
  { id: "secrets", label: "Secret recipes", build: sectionSecrets },
  { id: "ladder", label: "How long to afford it", build: sectionLadder },
  { id: "food", label: "Food", build: sectionFood },
  { id: "checks", label: "Docs against the model", build: sectionChecks },
  { id: "assumptions", label: "What this leans on", build: sectionAssumptions },
];

// One shared nav on every page — a plain list of links, so it works with no JS and works whether the
// file is opened straight off disk or served through /api/economy/report/[[...path]] (web/lib/economyReport.js).
// The brand link doubles as "home"; each section's own <h2> (inside its build()) is the page's real
// heading, so a section page carries no second, redundant title above it.
function navHtml(activeId) {
  const item = (id, label) =>
    `<a href="${id === "index" ? "index.html" : `${id}.html`}"${id === activeId ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  return `<nav class="report-nav"><a href="index.html" class="report-brand">Bascinet economy</a>${item("index", "The short version")}${SECTIONS.map((s) => item(s.id, s.label)).join("")}</nav>`;
}

function page({ title, activeId, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Bascinet economy</title><link rel="stylesheet" href="report.css"></head><body>
<div class="report-shell">
${navHtml(activeId)}
<main>
<p class="sub">Generated from commit ${esc(commit)} · ${players} players · ${model.counts.tags} tags, ${model.counts.craftable} craftable · <code>npm run economy:report</code></p>
${body}
</main>
</div>
<script src="report-client.js"></script></body></html>`;
}

const shortVersion = `<h1>Bascinet economy</h1><section><h2>The short version</h2><ul class="head">${headlines.map((h) => `<li>${h}</li>`).join("")}</ul></section>`;
const sectionFiles = [
  { name: "index.html", content: page({ title: "The short version", activeId: "index", body: shortVersion }) },
  ...SECTIONS.map((s) => ({ name: `${s.id}.html`, content: page({ title: s.label, activeId: s.id, body: s.build() }) })),
];

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
  `| Occupation | ¢/turn | ¢/turn, ⬢ at ${fmt(params.rv.mid, 1)} ¢ |`,
  "|---|---:|---:|",
  ...model.wages.map((w) => `| ${w.key}${w.ceiling ? " (a ceiling)" : ""} | ${fmt(w.value)} | ${w.valueMid == null ? "" : fmt(w.valueMid)} |`),
  "",
  "## Baselines: the easy crafts (⬢ bought at the Depot)",
  "",
  `| Role | Recipe | Points | ¢/turn bought | ¢/turn mined | ¢/turn, ⬢ at ${fmt(params.rv.mid, 1)} ¢ |`,
  "|---|---|---:|---:|---:|---:|",
  ...model.baselines.map((b) => `| ${b.role} | ${b.key.split(": ")[1]} | ${b.skillPoints} | ${fmt(b.value)} | ${fmt(b.valueMined)} | ${fmt(b.valueMid)} |`),
  "",
  "## Combined activities",
  "",
  `| Skills | Points | With the Factory | Without it | After the sale trip, ${model.travel.base.free} free | …${model.travel.mount.free} free |`,
  "|---|---:|---:|---:|---:|---:|",
  ...model.combos.loadouts.filter((l) => l.points <= params.startingTagPoints).sort((x, y) => y.withFactory.rate - x.withFactory.rate).filter((l, i, a) => a.findIndex((x) => x.skills.join() === l.skills.join()) === i).slice(0, 8).map((l) => {
    const k = l.picked.join("+");
    const best = (t) => (t ? fmt(Math.max(t.withFactory.after, t.noFactory.after)) : "—");
    return `| ${l.skills.join(" + ")} | ${l.points} | ${fmt(l.withFactory.rate)} | ${fmt(l.noFactory.rate)} | ${best(model.travel.base.byKey.get(k))} | ${best(model.travel.mount.byKey.get(k))} |`;
  }),
  "",
  `## Buyable gear, point for point (${fmt(model.equipment.pointValue, 1)} ¢ a point)`,
  "",
  "| Points | Band | Picks | Replace ¢, median | ¢ a point, median |",
  "|---:|---|---:|---:|---:|",
  ...model.equipment.byPoints.map((b) => `| ${b.points} | ${b.band} | ${b.rows} | ${b.medianReplace == null ? "—" : fmt(b.medianReplace, 0)} | ${b.medianRate == null ? "—" : fmt(b.medianRate, 1)} |`),
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
  ["group", "name", "kind", "lasts", "paysThrough", "coin", "moves", "allIn", "points", "gainPerTurn", "paybackTurns", "backPerCoinPerUse", "netOverGame", "perPoint", "does", "cost", "how", "note"].join(","),
  ...model.investments.rows.map((r) =>
    [r.group, r.name, r.kind, r.lasts, r.paysThrough, r.coin, r.moves, r.allIn, r.points, r.gain ?? "", r.paybackTurns ?? "", r.perUse?.backPerCoin ?? "", r.netOverGame ?? "", r.perPoint ?? "", r.does, r.coinHow, r.gainHow ?? "", r.note ?? ""].map(csvCell).join(","),
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
  ["kind", "name", "detail", "sells", "shelf", "inlay", "ruleSays", "apprenticeProfit", "skilledProfit", "skilledLuckyProfit", "apprenticeLuckyProfit"].join(","),
  ...model.trinkets.stones.map((r) => ["stone", r.name, r.group, r.sold, r.shelf ?? "", r.inlay, r.expected ?? "", "", "", "", ""].map(csvCell).join(",")),
  ...[...model.trinkets.combos.bestOwn.map((c) => ({ ...c, kind: "own stones" })), ...model.trinkets.combos.bestShelf.map((c) => ({ ...c, kind: "shelf stones" }))].map((c) =>
    [c.kind, c.stones.join(" + ") || "none", c.stoneCost, "", "", c.inlay, "", c.apprentice, c.skilled, c["skilled-lucky"], c["apprentice-lucky"]].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "trinkets.csv"), trinketsCsv);
const startingCsv = [
  ["role", "group", "seats", "bankCoin", "handCoin", "resourcesOnPerson", "resourcesInItems", "foodHunger", "startingTurn", "dyingTurn", "turnsWithFunds", "keyedRooms", "keyedResources", "keyedCoin", "keyedFoodHunger", "kit", "keys"].join(","),
  ...model.starting.roles.map((r) =>
    [r.name, r.groupName, r.unlimited ? "no cap" : r.seats, r.bank, r.coinHand, r.resources, r.cracked, r.food, r.starveTurn, r.dyingTurn, Number.isFinite(r.turnsWithFunds) ? r.turnsWithFunds.toFixed(1) : "", r.rooms.length, r.keyedResources, r.keyedCoin, r.keyedFood, r.kit.join("; "), r.keys.join("; ")].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "starting.csv"), startingCsv);

const powerCsv = [
  ["role", "group", "seats", "tagKitValuePoints", "tagBonusPoints", "tagValuePoints", "wealthCoin", "reachCoin", "softPower", "composite", "keys", "docElements"].join(","),
  ...model.power.rows.map((r) =>
    [r.name, r.group, r.seats, r.kitValue, r.extraPoints, r.tagValue, r.wealthCoin, r.reachCoin, r.softPower, r.composite, r.keys.join("; "), r.docElements.join("; ")].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "power.csv"), powerCsv);

const equipmentCsv = [
  ["slug", "name", "category", "group", "points", "band", "requires", "howHard", "easiestRoute", "freeWith", "depot", "sell", "makeResources", "makeMoves", "makeSkill", "makeSkillPoints", "makeAllIn", "replace", "replaceVia", "centsPerPoint", "fairPoints", "drift", "verdict", "earnsPerTurn", "earnsOverGame", "fightTiers", "fightCeilingPoints", "meleeArmor", "ballisticArmor", "caveat"].join(","),
  ...model.equipment.rows.map((r) =>
    [r.slug, r.name, r.category, r.group, r.points, r.band, r.requires ?? "", r.rankLabel, r.route, r.kits.join("; "), r.depot ?? "", r.sell ?? "", r.craft?.resources ?? "", r.craft?.moves ?? "", r.craft?.skills ?? "", r.craft?.skillPoints ?? "", r.craft?.allIn ?? "", r.replace ?? "", r.replaceHow ?? "", r.rate ?? "", r.fairPoints ?? "", r.drift ?? "", r.verdict ?? "", r.earnsPerTurn ?? "", r.earnsOverGame ?? "", r.fightTiers ?? "", r.fightCeiling ?? "", r.armor?.melee ?? "", r.armor?.ballistic ?? "", r.flags.join("; ")].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "equipment.csv"), equipmentCsv);

const armorCsv = [
  ["slug", "name", "class", "catalog", "reach", "points", "weightLbs", "melee", "meleeWord", "ballistic", "ballisticWord", "average", "turretNotDyingOrDead", "howHard", "route", "depot", "sell", "makeResources", "makeMoves", "makeSkill", "makeItems", "perks", "bestInClass", "twins", "dominatedBy", "outpricedBy", "heavyForTheStepOver", "verdict"].join(","),
  ...model.armor.rows.map((r) =>
    [r.slug, r.name, r.cls, r.catalog, r.reach, r.points, r.weight, r.melee, r.meleeWord, r.ballistic, r.ballisticWord, r.average, r.turret, r.rankLabel, r.route, r.depot ?? "", r.sell ?? "", r.craft?.resources ?? "", r.craft?.moves ?? "", r.craft?.skills.join(" + ") ?? "", r.craft?.items.join(" + ") ?? "", r.perks.join("; "), r.badges.join("; "), r.twins.join("; "), r.dominatedBy.join("; "), r.outpricedBy.join("; "), r.heavyFor.join("; "), r.verdict].map(csvCell).join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "armor.csv"), armorCsv);

fs.writeFileSync(path.join(outDir, "combos.csv"), combosCsv);
fs.writeFileSync(path.join(outDir, "recipes.csv"), recipesCsv);
fs.writeFileSync(path.join(outDir, "item-sources.csv"), itemsCsv);
// One file per section (SECTIONS above), plus the shared report.css/report-client.js the old inline
// <style>/<script> moved into — index.html is the short-version landing page, not the whole report.
fs.writeFileSync(path.join(outDir, "report.css"), css);
fs.writeFileSync(path.join(outDir, "report-client.js"), js);
for (const f of sectionFiles) fs.writeFileSync(path.join(outDir, f.name), f.content);
fs.writeFileSync(path.join(outDir, "report.md"), md);
fs.writeFileSync(path.join(outDir, "activities.csv"), csv);
fs.writeFileSync(path.join(outDir, "model.json"), JSON.stringify(model, null, 2));
console.log(`economy report -> ${path.join(outDir, "index.html")}`);
console.log(`  ${sectionFiles.length} pages (index + ${SECTIONS.length} sections), navigable from any one of them`);
console.log(`  ${model.activities.length} activities, ${model.priceLadder.length} priced wares, ${model.foods.length} foods`);
console.log(`  ${failing.length} of ${model.claims.length} doc figures differ from the model`);
console.log(`  ${S.summary.special} of ${S.summary.recipes} recipes need a special item; ${S.items.length} distinct items sourced`);

if (diffMode) {
  const { diffMarkdown, diffModel } = require("./reportDiff");
  const readOr = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  const oldMd = readOr(path.join(finalDir, "report.md"));
  const oldModel = readOr(path.join(finalDir, "model.json"));
  console.log(`\nwhat moved against ${finalDir}:`);
  if (oldMd == null) console.log("  (no report there yet)");
  else {
    const mdLines = diffMarkdown(oldMd, md);
    console.log(`\nreport.md: ${mdLines.length ? "" : "no change"}`);
    for (const l of mdLines) console.log(l);
  }
  if (oldModel != null) {
    const { lines, count } = diffModel(JSON.parse(oldModel), JSON.parse(JSON.stringify(model)));
    console.log(`\nmodel.json: ${count ? `${count} figures moved` : "no change"}`);
    for (const l of lines) console.log(l);
  }
  if (diffMode === "copy") {
    fs.mkdirSync(finalDir, { recursive: true });
    fs.cpSync(outDir, finalDir, { recursive: true });
    console.log(`\ncopied to ${finalDir}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}
