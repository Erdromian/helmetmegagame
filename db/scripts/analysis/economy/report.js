#!/usr/bin/env node
// Renders the economic model (./model.js) as a report you can open.
//
//   npm run economy:report                    # -> economy-report/index.html
//   npm run economy:report -- --players 150   # a bigger town
//   npm run economy:report -- --turns 40      # a longer game (fatigue over N turns)
//   npm run economy:report -- --free-moves 2  # free zone crossings a turn (2 with a mount)
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

const model = buildModel({ players, gameTurns, freeMoves });
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
            // A sort key only when it differs from what is shown; the sorter reads the text otherwise.
            const sortAttr = c.sort ? ` data-v="${esc(c.sort(r) ?? "")}"` : "";
            const style = c.style ? c.style(r) : "";
            return `<td${c.num ? ' class="num"' : ""}${sortAttr}${style ? ` style="${style}"` : ""}>${
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
const allRanked = [...model.activities].sort((a, b) => (money(b) ?? -1e9) - (money(a) ?? -1e9) || (b.perAction ?? -1e9) - (a.perAction ?? -1e9));

const RANK = model.sources.ranks;
const rankChip = (r) =>
  r === 0 ? `<span class="rk r0">none</span>` : `<span class="rk r${r}">${RANK.find((x) => x.id === r)?.label}</span>`;
const wage = (key) => model.wages.find((w) => w.key === key)?.value;
const floorW = wage("Unskilled miner (Caves)");
const proW = wage("Prospector (Caves)");
const farmW = wage("Farmer (potato, sold)");
const factW = wage("Factory solo");
const baselineOf = (role) => model.baselines.find((b) => b.role === role);
const potatoFood = model.foodSupply.find((f) => f.crop === "potato");
const failing = model.claims.filter((c) => !c.ok);

const headlines = [
  `Money a turn is worth: an unskilled miner earns about <b>${fmt(floorW)} ¢</b>, a Prospector <b>${fmt(proW)} ¢</b>, a farmer selling potatoes <b>${fmt(farmW)} ¢</b>, and a solo Factory worker <b>${fmt(factW)} ¢</b>. The Factory pays about ${fmt(factW / proW, 0)} times what the skilled miner does.`,
  `The easy-craft baselines, with ⬢ bought at the Depot: a starter smith ${fmt(baselineOf("Starter smith")?.value)} ¢ a turn (${baselineOf("Starter smith")?.key.split(": ")[1]}), a skilled smith ${fmt(baselineOf("Skilled smith")?.value)} ¢ (${baselineOf("Skilled smith")?.key.split(": ")[1]}), a crafter ${fmt(baselineOf("Crafter")?.value)} ¢, a skilled brewer ${fmt(baselineOf("Skilled brewer")?.value)} ¢. A cook earns nothing from the counter, since no dish can be sold there, but feeds ${fmt(model.cheapestMeal?.personTurnsPerMove, 0)} person-turns per Move for ${fmt(model.cheapestMeal?.costPerPersonTurn, 2)} ¢ each.`,
  `Mining is the only source of ⬢ (${fmt(params.minerResourcesPerTurn)} ⬢/turn for a Prospector at the Caves) yet a median smithing recipe burns <b>${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.medianBurn)} ⬢/turn</b> — roughly ${fmt(model.resourceBalance.find((r) => r.family === "smithing")?.minersPerCrafter, 1)} miners per smith just to keep one forge fed.`,
  `Food demand is small and steady: ${players} players burn ${players * params.hungerDecay} hunger a turn. One Farm action makes ~${fmt(potatoFood.personTurnsPerFarm, 0)} person-turns of food, so about <b>${fmt(potatoFood.farmersNeeded, 0)} farmers</b> feed the whole town.`,
  (() => {
    const at8 = model.combos.loadouts.filter((l) => l.points <= params.startingTagPoints).sort((x, y) => y.withFactory.rate - x.withFactory.rate || x.points - y.points)[0];
    const refAlone = model.combos.alone.find((a) => /^Refine/.test(a.label));
    return `The best mix at the starting budget (${params.startingTagPoints} points) is <b>${esc(at8.skills.join(" + "))}</b>, worked as <span class="mono">${esc(at8.withFactory.pattern.split(" ").slice(0, 8).join(" "))}</span> (R refine, C craft, F farm, M mine), for <b>${fmt(at8.withFactory.rate)} ¢ a turn</b>, against ${fmt(refAlone.rate)} refining alone. Refining tires you the way mining does, so a crafter fills the off turns. Only ${params.refinerySeats} people can refine in a turn; with a crowd the mix falls back on crafts and farming.`;
  })(),
  `Fatigue: ${model.fatigue.rows.filter((r) => r.tires).map((r) => `${r.label.toLowerCase().replace(/ \(.*\)/, "")} can be pressed ${r.steady >= 0.999 ? "every turn" : `1 turn in ${fmt(1 / r.steady, 0)}`}`).join(", ")}. ${model.fatigue.rows.filter((r) => !r.tires).map((r) => r.label.toLowerCase().replace(/ \(.*\)/, "")).join(", ")} never tire you.`,
  `A Prospector's press in the Caves is worth ${fmt(model.activities.find((a) => a.id === "mine:Caves:skilled").resourcesPerPress * params.rv.sell)} ¢ of ⬢ plus ${fmt(model.activities.find((a) => a.id === "mine:Caves:skilled").dropsPerAction, 2)} ¢ of drops; in the Depths the drops are ${fmt(model.activities.find((a) => a.id === "mine:Depths:skilled").dropsPerAction, 2)} ¢.`,
  `${model.sources.summary.special} of ${model.sources.summary.recipes} recipes need a special item (${model.sources.summary.copies} of those only copy a key). Of the rest, ${model.sources.summary.byHardest[4]} are held back by a Scarce item and ${model.sources.summary.byHardest[5]} by an item with no known source.`,
  `${failing.length} of ${model.claims.length} figures the docs quote do not match what the catalog and code produce (see “Docs against the model”).`,
];

function sectionWages() {
  const rows = model.wages.map((w) => ({ label: w.key, value: w.value, color: w.baseline ? "var(--c1)" : "var(--c0)" }));
  return `<section><h2>What a turn is worth</h2>
<p class="lede">Net ¢ per turn for a typical holder of each occupation. Producers (miners, farmers, the Factory) are valued with ⬢ at what the Depot pays for it (${params.rv.sell} ¢). The gold bars are the <b>easy-craft baselines</b> (next section): a crafter buys ⬢ at the Depot's ${params.rv.buy} ¢, so these are the wage of somebody starting from nothing but coin. Mining is halved for the fatigue duty cycle and farming is spread over its lockout.</p>
${barChart({ rows })}</section>`;
}

const recBy = new Map(model.sources.recipes.map((r) => [r.slug, r]));
const needsCell = (slug) => {
  const r = recBy.get(slug);
  if (!r || !r.items.length) return "nothing";
  return r.items.map((i) => `${esc(i.label)} <span class="via">${esc(i.easy ?? i.route)}</span>`).join("<br>");
};
const craftCols = () => [
  { h: "Recipe", get: (a) => a.name },
  { h: "Skill", get: (a) => `${a.skill.replace(/, fundamentalist/, "")} (${a.skillPoints} pt)`, sort: (a) => a.skillPoints },
  { h: "Moves", num: true, get: (a) => fmt(a.totalMoves, 2), sort: (a) => a.totalMoves },
  { h: "⬢", num: true, get: (a) => fmt(a.resourceCost, 0) },
  { h: "Sells ¢", num: true, get: (a) => a.revenue },
  { h: "Also needs", raw: true, get: (a) => needsCell(a.slug), sort: (a) => (recBy.get(a.slug)?.items.length ?? 0) },
  { h: "Forge?", get: (a) => (a.workshop ? "yes" : "no") },
  { h: "¢/turn, ⬢ bought", num: true, get: (a) => fmt(a.netPerTurnBuy), sort: (a) => a.netPerTurnBuy },
  { h: "¢/turn, ⬢ mined", num: true, get: (a) => fmt(a.netPerTurnSell), sort: (a) => a.netPerTurnSell },
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
    { h: "Dish", get: (c) => c.name },
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
<p class="lede">What somebody can earn from a standing start, using only what is easy to get. A recipe is <b>easy</b> when every input is on the Depot's general shelf, is farmed, is an ore on at least ${fmt(100 * 0.1, 0)}% of Prospecting presses, is a cave find on at least 1 in 50 arrivals, or is a craft from those. ⬢ comes from the Depot at ${params.rv.buy} ¢, and the second column shows the pay if the crafter mined it instead. Recipes that need an ore supply of more than two Prospectors per crafter are flagged and left out of the baselines. These baselines are what the rest of the report compares against.</p>
${table({ cols: baseCols, rows: model.baselines })}

<h3>Smithing</h3>
<p class="lede">Every smithing recipe needs Workshop Equipment within reach. Iron, Copper and Nickel head the list but need one ore per quarter Move, which is far more than Prospectors can supply, so read them as ceilings.</p>
${table({ cols: craftCols(), rows: L.smithing.slice(0, 12) })}

<h3>Crafting (the basic skill)</h3>
<p class="lede">Crafting costs 2 points and needs no forge. At the Depot's ⬢ price the Dead Simple pieces (Sling, Quarterstaff, Padded Armor and the rest) earn nothing: they sell for 6 ¢ and cost 3 ⬢, which is 6 ¢ to buy. They only pay if you mine your own ⬢. The Prospector's Pick is the one crafting recipe that pays on bought ⬢.</p>
${table({ cols: craftCols(), rows: L.crafting.slice(0, 12) })}

<h3>Brewing</h3>
<p class="lede">Brewing needs no forge. Most brews need 10 points (Brewing II). Cave Fungus, the one cave find these use, turns up on ${fmt((model.sources.items.find((i) => i.slug === "cave-fungus")?.routes[0] ?? "").match(/([\d.]+)%/)?.[1] ?? 0, 1)}% of arrivals. Alcohol is a 0.25-Move recipe, so the brews that use it include that work.</p>
${table({ cols: craftCols(), rows: L.brewing.slice(0, 10) })}

<h3>Cooking</h3>
<p class="lede">No dish can be sold to the Depot, so a cook has no wage. What a cook makes is food and mood, so the table ranks dishes by what a person-turn of food costs in ingredients (crops priced at what the counter pays). One person burns ${params.hungerDecay} hunger a turn. ${top ? `The cheapest is ${esc(top.name)}: ${top.hunger} hunger from ingredients worth ${fmt(top.costPerDish, 1)} ¢, against ${fmt(model.foods.find((f) => f.slug === "wheat")?.costPerPersonTurn, 2)} ¢ a person-turn for raw wheat, which also costs mood and nauseates. A Move of ${esc(top.name)} is ${fmt(top.dishesPerMove, 0)} dishes and needs about ${fmt(top.dishesPerMove * unitsPerDish, 0)} ingredient units, roughly one Farm action's harvest (${fmt(cropsPerFarm, 0)}), so the crop supply binds long before the Move does.` : ""}</p>
${table({ cols: cookCols, rows: L.cooking.slice(0, 12) })}

<h3>Without Workshop Equipment</h3>
<p class="lede">Brewing, cooking and Crafting never need a forge. Only smithing does, so the question is what the smithing family can do without one. The answer is the crafting-skill recipes plus Workshop Equipment itself, which is exempt from its own requirement.</p>
${table({ cols: craftCols(), rows: L.noWorkshop.slice(0, 8) })}
<p class="lede">Best without a forge: <b>${esc(L.noWorkshop[0]?.name)}</b> at ${fmt(L.noWorkshop[0]?.netPerTurnBuy)} ¢ a turn (${fmt(L.noWorkshop[0]?.netPerTurnSell)} ¢ with mined ⬢), against ${fmt(baselineOf("Skilled smith")?.value)} ¢ for a skilled smith with one. Where the forge comes from: ${ws ? ws.routes.map(esc).join("; ") : "n/a"}. A Smithing II smith can make their own: ${weAct ? `${fmt(weAct.resourceCost, 0)} ⬢ and ${fmt(weAct.totalMoves, 0)} Moves, worth ${weAct.revenue} ¢ if sold` : ""}. The Metalsmith starts with the Smithy Key to the Storeroom's, and the Engineer starts with Smithing II, so the forge is a small blocker for the main smiths and a real one for everybody else.</p>
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
<li><b>Skill points.</b> Farm needs Soilery (7) and Mine needs Prospecting (7), so a starting budget of ${params.startingTagPoints} cannot hold both. Refine and cutting Godflesh need no skill.</li>
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
    { h: "Activity", get: (a) => a.name },
    { h: "Family", get: (a) => a.family, style: (a) => `border-left:4px solid ${famColor(a.family)}` },
    { h: "Skill", get: (a) => a.skill },
    { h: "Pts", num: true, get: (a) => a.skillPoints },
    { h: "Moves", num: true, get: (a) => fmt(a.moves, 2), sort: (a) => a.moves },
    { h: "Revenue", num: true, get: (a) => fmt(a.revenue), sort: (a) => a.revenue ?? -1 },
    { h: "Inputs", num: true, get: (a) => fmt(a.inputs), sort: (a) => a.inputs },
    { h: "Per action ¢", num: true, get: (a) => fmt(a.perAction), sort: (a) => a.perAction ?? -1e9 },
    { h: "Drops ¢", num: true, get: (a) => (a.dropsPerAction != null ? fmt(a.dropsPerAction, 2) : "—"), sort: (a) => a.dropsPerAction ?? -1 },
    { h: "Presses / turn", num: true, get: (a) => (a.moves === 0 && a.netPerTurnSell == null ? "free" : fmt(a.duty, 2)), sort: (a) => a.duty ?? 0 },
    { h: "¢/turn (⬢ at sell)", num: true, get: (a) => fmt(money(a)), sort: (a) => money(a) ?? -1e9 },
    { h: "¢/turn (⬢ at buy)", num: true, get: (a) => fmt(a.netPerTurnBuy), sort: (a) => a.netPerTurnBuy ?? -1e9 },
    { h: "Notes", get: (a) => a.flags.join("; ") },
  ];
  return `<section><h2>The full table</h2>
<p class="lede">${model.activities.length} activities. Click a heading to sort. “Per action” is one press; “Presses / turn” is how often the fatigue rules let you press it, and “free” marks actions that cost no Move (Butcher, the Caving Die), which are limited by what you have to work on. “Drops” is the extra loot per press, valued at what the station pays. “Inputs” prices ⬢ at the sell figure and ingredients at their sale price (or purchase price if unsellable).</p>
${table({ cols, rows: allRanked })}</section>`;
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
  const mineRows = model.activities.filter((a) => a.kind === "mine" && a.skillPoints > 0);
  const bars = [];
  for (const a of mineRows) {
    bars.push({ label: `${a.name.replace("Mine — ", "")}: ⬢`, value: a.resourcesPerPress * params.rv.sell, color: "var(--c0)" });
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
<h3>Mining with Prospecting: per press</h3>
<p class="lede">A Prospecting press pays ⬢ and rolls this table once. Without the skill you get less ⬢ and no roll. The Caves and Depths are the only places with a column.</p>
${barChart({ rows: bars, unit: " ¢", labelW: 250, fmtVal: (v) => fmt(v, 1) })}
${table({ cols: dropCols("Caves", "Depths"), rows: union(P.prospecting.caves, P.prospecting.depths).slice(0, 18) })}
<p class="lede">Total drops per press: Caves ${fmt(total(P.prospecting.caves), 2)} ¢, Depths ${fmt(total(P.prospecting.depths), 2)} ¢.</p>
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
    { h: "Recipe", get: (r) => r.name },
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
${table({ cols: itemCols, rows: S.items })}
<h3>Every recipe</h3>
${table({ cols: recCols, rows: [...S.recipes].sort((a, b) => b.hardest - a.hardest || a.name.localeCompare(b.name)) })}</section>`;
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
<p class="lede">Mining is the faucet and recipes are the sink. A Prospector at the Caves brings in ${fmt(params.minerResourcesPerTurn)} ⬢ a turn (average of the ${fmt(params.productionCoefficient, 1)} production dial, the base range and the every-other-turn fatigue). “Miners per crafter” is how many of them one crafter of that family needs, working flat out. The Depot sells ⬢ at ${params.rv.buy} ¢, so a shortfall can be bought rather than mined.</p>
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
.mono{font-family:var(--mono)}
.rk{display:inline-block;padding:0 7px;border-radius:9px;font-size:11px;font-weight:600;color:var(--bg);background:var(--r0);white-space:nowrap}
.rk.r1{background:var(--r1)}.rk.r2{background:var(--r2)}.rk.r3{background:var(--r3)}.rk.r4{background:var(--r4)}.rk.r5{background:var(--r5)}
.via{color:var(--mute);font-size:11px}
.ranks{list-style:none;padding:0;margin:0 0 8px;font-size:13px}.ranks li{margin:3px 0}
`;
const js = `
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
${sectionWages()}${sectionBaselines()}${sectionCombos()}${sectionSpread()}${sectionFatigue()}${sectionDrops()}${sectionBalance()}${sectionActivities()}${sectionSpecial()}${sectionLadder()}${sectionFood()}${sectionChecks()}${sectionAssumptions()}
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
