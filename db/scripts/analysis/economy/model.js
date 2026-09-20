// The economic model behind `npm run economy:report`.
//
// Everything here is DERIVED. The catalog (docs/tags.yaml), the map
// (docs/zones.yaml), the schema defaults and the rules modules in db/lib are
// read at run time, so a price change or a retuned constant shows up the next
// time the report is generated — there is no second copy of any number to fall
// behind. The one exception is ASSUMPTIONS below: things the game does that no
// file states as a number. Each is named, sourced and printed in the report so
// a reader can see what the model is leaning on.
//
// Pure and Prisma-free. Reads files, never a database.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { entriesOf } = require("../../../lib/yamlEntries");
const mining = require("../../../lib/mining");
const soilery = require("../../../lib/soilery");
const hunger = require("../../../lib/hunger");
const refinery = require("../../../lib/refinery");
const godflesh = require("../../../lib/godflesh");
const mutilate = require("../../../lib/mutilate");
const corpses = require("../../../lib/corpses");
const { buildSources, RULES: SOURCE_RULES } = require("./sources");
const { fatigueModel } = require("./fatigue");
const { buildCombos } = require("./combos");
const { turretTable } = require("../../../lib/depotTurret");

const REPO = path.resolve(__dirname, "../../../..");
const readYaml = (rel) => yaml.load(fs.readFileSync(path.join(REPO, rel), "utf8"));

// ---------------------------------------------------------------------------
// What the model assumes but the repo does not state as a number.
// ---------------------------------------------------------------------------
const ASSUMPTIONS = [
  {
    key: "MOVES_PER_TURN",
    value: 1,
    why: "A turn gives one Move; a recipe's turnsCost is a fraction of it (TAGS.md, Move economy).",
  },
  {
    key: "CRAFT_DUTY",
    value: 1,
    why: "Nothing rations crafting beyond the Move itself, except a recipe's own perTurn (read from the catalog).",
  },
  {
    key: "RESOURCE_VALUE",
    value: "Depot sell price and buy price, both shown",
    why: "One obol is one ⬢ (ECONOMY.md §1), but a ⬢ is worth 1 ¢ if you sell it and 2 ¢ if you must buy it. Every wage is reported at both ends of that range.",
  },
  {
    key: "ITEM_VALUE",
    value: "sellablePrice, else depotPrice, else 0 (flagged)",
    why: "What a spent ingredient is worth: what you could have sold it for; failing that, what it costs to buy.",
  },
];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function loadCatalog() {
  const tagsDoc = readYaml("docs/tags.yaml");
  const list = entriesOf(tagsDoc.tags, "slug");
  const bySlug = new Map(list.map((t) => [t.slug, t]));
  return { list, bySlug };
}

// `productionCoefficient Float @default(0.9)` and friends, straight off the
// schema so a retune there moves the model. Falls back loudly, never silently.
function schemaDefault(field) {
  const src = fs.readFileSync(path.join(REPO, "db/prisma/schema.prisma"), "utf8");
  const m = src.match(new RegExp(`\\b${field}\\s+\\w+\\s+@default\\(([-0-9.]+)\\)`));
  if (!m) throw new Error(`economy model: could not read @default for ${field} in schema.prisma`);
  return Number(m[1]);
}

// Every Location's authored mining coefficient, keyed by slug.
function loadMiningCoefficients() {
  const zones = readYaml("docs/zones.yaml");
  const found = {};
  (function walk(node, trail) {
    if (!node || typeof node !== "object") return;
    if (typeof node.mining === "number") found[trail[trail.length - 1]] = node.mining;
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, [...trail, k]);
  })(zones, []);
  return found;
}

// Slugs of every Location carrying a boolean attribute (godflesh, refinery...).
function locationsWithAttribute(attr) {
  const zones = readYaml("docs/zones.yaml");
  const hits = [];
  (function walk(node, trail) {
    if (!node || typeof node !== "object") return;
    if (node.attributes && node.attributes[attr] === true) hits.push(trail[trail.length - 1]);
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, [...trail, k]);
  })(zones, []);
  return hits;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
// The nine pieces an untouched human body gives up to Butcher (mutilate.js).
function corpseOrgans() {
  return mutilate.harvestableOrgans([]).map((o) => ({ slug: o.itemSlug, quantity: o.quantity }));
}

// Which craft families may put held OBOLS toward a recipe's ⬢ cost. The rule lives in
// web/app/(app)/character/actions/crafting.js#resolveObolSpend ("Smithing only"), so it is read
// from the source rather than remembered, and this fails loudly if that function is reshaped.
function obolPayableFamilies() {
  const src = fs.readFileSync(path.join(REPO, "web/app/(app)/character/actions/crafting.js"), "utf8");
  const fn = src.match(/function resolveObolSpend[\s\S]*?\n}\n/);
  if (!fn) throw new Error("model.js: could not find resolveObolSpend in crafting.js");
  const families = [...fn[0].matchAll(/craftFamily\(tag\) !== "([a-z]+)"/g)].map((m) => m[1]);
  if (families.length !== 1) throw new Error("model.js: resolveObolSpend no longer has one family gate; read it and update the model");
  return families;
}
// Mirrors web/lib/tagRequests.js#craftFamily: the first of these a recipe's skills belong to.
const CRAFT_FAMILIES = ["brewing", "cooking", "smithing", "builder", "crafting"];
function craftFamilyOf(skills) {
  const prefixes = new Set((skills ?? []).map((s) => s.split("-")[0]));
  return CRAFT_FAMILIES.find((f) => prefixes.has(f)) ?? [...prefixes].filter(Boolean).sort()[0] ?? "craft";
}
// One obol is one ⬢ (ECONOMY.md §1), so paying a cost in obols values a ⬢ at exactly 1 obol.
const OBOL_PAR = 1;

function buildModel({ players = 100, gameTurns = 30, freeMoves = null, resourceValue = "buy" } = {}) {
  const { list, bySlug } = loadCatalog();
  const get = (slug) => bySlug.get(slug);
  const sources = buildSources({ list, bySlug, players });
  // How often each day-verb can be pressed, played out with the game's own gates.
  const fatigue = fatigueModel({ bySlug, gameTurns });
  const mineDuty = fatigue.byId.mine.steady;
  const farmDuty = fatigue.byId.farm.steady;

  const resources = get("resources");
  const rv = { sell: resources.sellablePrice ?? 1, buy: resources.depotPrice ?? 2 };
  // Which price a ⬢ is valued at in the headline figures. The default is the Depot's BUY price:
  // that is what a ⬢ costs somebody who needs one and holds none. `--resource-value sell` gives the
  // 1 ¢ sell-back instead. Both are always in the tables, named.
  if (resourceValue !== "buy" && resourceValue !== "sell") throw new Error("resourceValue must be 'buy' or 'sell'");
  const rvMain = resourceValue === "sell" ? rv.sell : rv.buy;
  const productionCoefficient = schemaDefault("productionCoefficient");
  const farmMaxCrops = schemaDefault("farmMaxCrops");
  const startingTagPoints = schemaDefault("startingTagPoints");
  const miningCoeffs = loadMiningCoefficients();

  const obolFamilies = obolPayableFamilies();
  const params = {
    players,
    rv,
    rvMain,
    obolFamilies,
    resourceValue,
    productionCoefficient,
    farmMaxCrops,
    startingTagPoints,
    carryWeightLbs: schemaDefault("carryWeightLbs"),
    squeezeLbs: get("squeeze")?.weight ?? null,
    hungerDecay: hunger.HUNGER_DECAY_PER_TURN,
    hungerMax: hunger.HUNGER_MAX,
    witherIn: soilery.WITHER_IN,
    refineryYield: refinery.REFINERY_YIELD,
  };

  // --- pricing helpers -----------------------------------------------------
  function unitValue(slug, flags) {
    if (slug === "resources") return null; // valued per scenario by the caller
    const t = get(slug);
    if (!t) {
      flags.push(`unknown ingredient ${slug}`);
      return 0;
    }
    if (t.sellablePrice != null) return t.sellablePrice;
    if (t.depotPrice != null) return t.depotPrice;
    flags.push(`unpriced input: ${slug}`);
    return 0;
  }
  function itemsValue(items, flags) {
    let total = 0;
    for (const raw of items ?? []) {
      if (typeof raw === "string") total += unitValue(raw, flags);
      else if (raw.anyOf) {
        const opts = raw.anyOf.map((o) => unitValue(typeof o === "string" ? o : o.tag ?? o.customOf, flags));
        total += opts.length ? Math.min(...opts) : 0;
      } else if (raw.group) flags.push(`ingredient by group: ${raw.group}`);
      else total += (raw.count ?? 1) * unitValue(raw.tag ?? raw.customOf, flags);
    }
    return total;
  }

  // Cumulative point cost of a skill and everything it hangs off: the skill's
  // own cost plus everything reached through `parentTag` (a tier) or
  // `requiredTag` (a mastery's prerequisite). Each tag counts once.
  function skillChain(slug) {
    const seen = new Set();
    let root = slug;
    (function walk(s) {
      if (!s || seen.has(s)) return;
      const t = get(s);
      if (!t) return;
      seen.add(s);
      walk(t.parentTag);
      walk(t.requiredTag);
      if (!t.parentTag && !t.requiredTag) root = s;
    })(slug);
    let pts = 0;
    for (const s of seen) pts += get(s)?.pointCost ?? 0;
    return { points: pts, root };
  }
  const familyOf = (root) => {
    if (/smith/.test(root)) return "smithing";
    if (/^crafting/.test(root)) return "crafting";
    if (/brew/.test(root)) return "brewing";
    if (/cook/.test(root)) return "cooking";
    if (/medic|heal|surg/.test(root)) return "medicine";
    return root || "no skill";
  };

  const activities = [];
  const push = (a) => {
    a.netPerTurnSell = a.netPerTurnSell ?? null;
    a.netPerTurnBuy = a.netPerTurnBuy ?? null;
    // The headline figure: ⬢ valued at rvMain. Rows with no ⬢ in them are the same either way.
    if (a.netPerTurn === undefined) a.netPerTurn = resourceValue === "sell" ? a.netPerTurnSell : a.netPerTurnBuy;
    if (a.perAction === undefined) a.perAction = a.revenue != null ? a.revenue - ((resourceValue === "sell" ? a.inputs : a.inputsBuy) ?? a.inputs ?? 0) : null;
    activities.push(a);
  };

  // --- crafts --------------------------------------------------------------
  const recBySlug = new Map(sources.recipes.map((r) => [r.slug, r]));
  const nameOf = (slug) => get(slug)?.name ?? slug;
  // An input that is itself a plain recipe (no items, no forge) and that the
  // general shelf does not sell is made at home, at its own cost in ⬢ and Moves.
  const baseCraft = (slug) => {
    const t = get(slug);
    const r = t?.requirement;
    if (!t?.craftable || !r || (r.items ?? []).length || recBySlug.get(slug)?.workshop) return null;
    return { moves: r.turnsCost ?? 0, res: r.resourceCost ?? 0 };
  };
  const onGeneralShelf = (slug) => get(slug)?.depotPrice != null && (get(slug)?.manifest ?? "merchant") === "general";
  // Cooked dishes and everything under them, priced at the ingredients' sale
  // prices: { cost, moves } to make ONE unit.
  function expandRecipe(slug, seen = []) {
    const t = get(slug);
    const r = t?.requirement;
    if (!r || seen.includes(slug)) return { cost: 0, moves: 0, flags: [] };
    const flags = [];
    let cost = 0;
    let moves = r.turnsCost ?? 0;
    for (const raw of r.items ?? []) {
      if (typeof raw === "string") cost += unitValue(raw, flags) ?? 0;
      else if (raw.anyOf) {
        const opts = raw.anyOf.map((o) => unitValue(typeof o === "string" ? o : o.tag ?? o.customOf, flags) ?? 0);
        cost += Math.min(...opts);
      } else if (raw.customOf) {
        const sub = expandRecipe(raw.customOf, [...seen, slug]);
        cost += (raw.count ?? 1) * sub.cost;
        moves += (raw.count ?? 1) * sub.moves;
        flags.push(...sub.flags);
      } else if (raw.tag) cost += (raw.count ?? 1) * (unitValue(raw.tag, flags) ?? 0);
    }
    return { cost, moves, flags };
  }
  for (const t of list) {
    if (!t.craftable || !t.requirement || t.sellablePrice == null) continue;
    const r = t.requirement;
    const flags = [];
    const yieldN = r.yield ?? 1;
    const itemCost = itemsValue(r.items, flags);
    const resCost = r.resourceCost ?? 0;
    const revenue = t.sellablePrice * yieldN;
    const turnsCost = r.turnsCost ?? 0;
    const skillSlugs = r.skills ?? [];
    let points = 0;
    let root = "";
    for (const s of skillSlugs) {
      const c = skillChain(s);
      if (c.points >= points) {
        points = c.points;
        root = c.root;
      }
    }

    // Inputs made at home instead of bought.
    let extraRes = 0;
    let extraMoves = 0;
    let itemCostAdj = itemCost;
    const madeAtHome = [];
    for (const raw of r.items ?? []) {
      const slug = typeof raw === "string" ? raw : raw.keep || raw.anyOf || raw.group || raw.customOf ? null : raw.tag;
      if (!slug || onGeneralShelf(slug)) continue;
      const bc = baseCraft(slug);
      if (!bc) continue;
      const n = typeof raw === "string" ? 1 : raw.count ?? 1;
      extraRes += n * bc.res;
      extraMoves += n * bc.moves;
      itemCostAdj -= n * (unitValue(slug, []) ?? 0);
      madeAtHome.push(`${nameOf(slug)}${n > 1 ? ` ×${n}` : ""}`);
    }
    if (madeAtHome.length) flags.push(`makes its own ${madeAtHome.join(", ")}`);
    const cf = craftFamilyOf(skillSlugs);
    const parPayable = obolFamilies.includes(cf);
    if (parPayable && resCost + extraRes > 0) flags.push("the ⬢ can be paid in obols, 1 for 1");
    const totalMoves = Math.round((turnsCost + extraMoves) * 10000) / 10000;
    const per = (rvPrice) => revenue - itemCostAdj - (resCost + extraRes) * rvPrice;
    let perTurnSell = null;
    let perTurnBuy = null;
    if (turnsCost > 0) {
      perTurnSell = per(rv.sell) / totalMoves;
      perTurnBuy = per(rv.buy) / totalMoves;
    } else if (r.perTurn != null) {
      perTurnSell = per(rv.sell) * r.perTurn;
      perTurnBuy = per(rv.buy) * r.perTurn;
      flags.push(`free action, capped at ${r.perTurn}/turn`);
    } else {
      flags.push("free action, uncapped");
    }
    push({
      id: `craft:${t.slug}`,
      name: t.name,
      slug: t.slug,
      kind: "craft",
      family: familyOf(root),
      skill: skillSlugs.join(", ") || "—",
      skillPoints: points,
      moves: turnsCost,
      totalMoves,
      revenue,
      inputs: itemCostAdj + (resCost + extraRes) * rv.sell,
      inputsBuy: itemCostAdj + (resCost + extraRes) * rv.buy,
      resourceCost: resCost + extraRes,
      resourcesPerTurn: totalMoves > 0 ? (resCost + extraRes) / totalMoves : r.perTurn != null ? resCost * r.perTurn : null,
      duty: 1,
      netPerTurnSell: perTurnSell,
      netPerTurnBuy: perTurnBuy,
      easy: recBySlug.get(t.slug)?.easy ?? false,
      workshop: recBySlug.get(t.slug)?.workshop ?? false,
      copy: recBySlug.get(t.slug)?.copy ?? false,
      madeAtHome,
      craftFamily: cf,
      parPayable,
      // ⬢ paid as obols, one for one. Only where the game lets you (obolFamilies); null elsewhere.
      netPerTurnObols: parPayable && turnsCost > 0 ? (revenue - itemCostAdj - (resCost + extraRes) * OBOL_PAR) / totalMoves : null,
      // Ore comes off Prospecting presses, at most one a turn and half the turns.
      // How many Prospectors does one crafter working flat out need behind them?
      oreNeeds: (recBySlug.get(t.slug)?.items ?? [])
        .filter((i) => i.easyKind === "ore" && totalMoves > 0)
        .map((i) => ({ item: i.label, perTurn: i.count / totalMoves, prospectors: i.count / totalMoves / (i.easyRate * mineDuty) })),
      flags,
    });
  }

  // --- mining --------------------------------------------------------------
  // What a primary producer's action also drops, as tables. The chances come
  // from sampling the game's own loot functions (sources.js), so a retuned
  // table moves the numbers. Valued at the station's sell price; an item the
  // station will not buy counts 0 and is marked, so the totals are a floor.
  const sellOf = (slug) => get(slug)?.sellablePrice ?? 0;
  const dropTable = (dist, scale = 1) =>
    [...dist.entries()]
      .map(([slug, p]) => ({
        slug,
        name: get(slug)?.name ?? slug,
        p: p * scale,
        unit: sellOf(slug),
        priced: get(slug)?.sellablePrice != null,
        ev: p * scale * sellOf(slug),
      }))
      .sort((x, y) => y.ev - x.ev || y.p - x.p);
  const evOf = (tbl) => tbl.reduce((sum, row) => sum + row.ev, 0);
  const producerDrops = {
    prospecting: {
      caves: dropTable(sources.drops.prospecting.caves.dist),
      depths: dropTable(sources.drops.prospecting.depths.dist),
    },
    caving: {
      caves: dropTable(sources.drops.caving.caves.dist, SOURCE_RULES.cavingFindChance),
      depths: dropTable(sources.drops.caving.depths.dist, SOURCE_RULES.cavingFindChance),
    },
    butcher: [],
  };
  const lootEv = (zoneKey) => ({ ev: evOf(producerDrops.prospecting[zoneKey]) });

  const pick = get("prospectors-pick");
  const pickBonus = pick?.miningBonus?.amount ?? 0;
  const miningSites = [
    { site: "Caves", zone: "caves", coeff: miningCoeffs["caves-approach"] },
    { site: "Depths", zone: "depths", coeff: miningCoeffs["depths-obelisk"] },
    { site: "Depths chasm", zone: "depths", coeff: miningCoeffs["depths-chasm"] },
  ];
  const prospecting = get("prospecting");
  for (const s of miningSites) {
    if (s.coeff == null) continue;
    for (const skilled of [false, true]) {
      for (const withPick of skilled && s.site === "Caves" ? [false, true] : [false]) {
        const range = skilled ? mining.MINING_RATE : mining.UNSKILLED_MINING_RATE;
        const meanBase = (range.min + range.max) / 2;
        const resources = meanBase * productionCoefficient * s.coeff + (withPick ? pickBonus : 0);
        const loot = skilled ? lootEv(s.zone) : { ev: 0 };
        const flags = ["payout lands at the press", "Lifeweb failure not modelled", ...(skilled ? ["loot valued at sell price: a floor"] : [])];
        push({
          id: `mine:${s.site}:${skilled ? "skilled" : "unskilled"}${withPick ? ":pick" : ""}`,
          name: `Mine — ${s.site}, ${skilled ? "Prospecting" : "no skill"}${withPick ? " + Pick" : ""}`,
          kind: "mine",
          family: "mining",
          skill: skilled ? "prospecting" : "—",
          skillPoints: skilled ? prospecting.pointCost : 0,
          moves: 1,
          revenue: null,
          inputs: 0,
          inputsBuy: 0,
          duty: mineDuty,
          resourcesPerPress: resources,
          lootEv: loot.ev,
          dropsPerAction: loot.ev,
          perAction: resources * rvMain + loot.ev,
          baseNetPerTurn: resources * rvMain * mineDuty,
          netPerTurn: (resources * rvMain + loot.ev) * mineDuty,
          netPerTurnSell: (resources * rv.sell + loot.ev) * mineDuty,
          netPerTurnBuy: (resources * rv.buy + loot.ev) * mineDuty,
          flags,
        });
      }
    }
  }

  // --- farming -------------------------------------------------------------
  const farmCycle = Math.round(1 / farmDuty);
  params.farmCycle = farmCycle;
  params.gameTurns = gameTurns;
  const soileryTag = get("soilery");
  const foodCrops = soilery.CROPS.filter((c) => c.crop !== "pigtails");
  const farmRows = [];
  for (const c of foodCrops) {
    const crop = get(c.crop);
    const bag = get(`${c.crop}-seed-bag`);
    const flags = [`lockout: one farm every ${farmCycle} turns`];
    const harvest = farmMaxCrops * (1 - 1 / soilery.WITHER_IN);
    const seedCost = bag?.depotPrice ?? 0;
    if (!bag) flags.push("no seed bag in catalog");
    const revenue = harvest * (crop.sellablePrice ?? 0);
    farmRows.push({ crop: c.crop, harvest, revenue, seedCost, hunger: crop.cooked?.hunger ?? 0, weight: crop.weight ?? 0 });
    push({
      id: `farm:${c.crop}`,
      name: `Farm — ${crop.name}`,
      kind: "farm",
      family: "farming",
      skill: "soilery",
      skillPoints: soileryTag.pointCost,
      moves: 1,
      revenue,
      inputs: seedCost,
      inputsBuy: seedCost,
      duty: farmDuty,
      harvest,
      netPerTurnSell: (revenue - seedCost) * farmDuty,
      netPerTurnBuy: (revenue - seedCost) * farmDuty,
      flags,
    });
  }

  // --- the Factory ---------------------------------------------------------
  const squeeze = get(refinery.REFINERY_OUTPUT_SLUG);
  const cubeValue = squeeze.sellablePrice ?? 0;
  const shift = refinery.REFINERY_YIELD * cubeValue;
  // Expected Godflesh per cut, by walking the real die: every face once.
  const expectedCut = (tags) => {
    let sum = 0;
    let bad = 0;
    for (let face = 1; face <= 6; face++) {
      const r = godflesh.rollExtraction(tags, () => (face - 0.5) / 6);
      sum += r.quantity;
      if (r.injury) bad++;
    }
    return { godflesh: sum / 6, injuryChance: bad / 6 };
  };
  const bare = expectedCut([]);
  const saw = expectedCut([{ equipped: true, tag: { slug: godflesh.CHAINSAW_SLUG ?? "chainsaw" } }]);
  const refineDuty = fatigue.byId.refine.steady;
  params.refinerySeats = refinery.REFINERY_MAX_WORKERS;
  params.refineDuty = refineDuty;
  push({
    id: "factory:refine-supplied",
    name: "Refine — Godflesh supplied",
    kind: "refine",
    family: "factory",
    skill: "—",
    skillPoints: 0,
    moves: 1,
    revenue: shift,
    inputs: 0,
    inputsBuy: 0,
    duty: refineDuty,
    netPerTurnSell: shift * refineDuty,
    netPerTurnBuy: shift * refineDuty,
    flags: [
      "someone else pays the cutting risk",
      `a shift tires you, so it is worked ${refineDuty >= 0.999 ? "every turn" : `1 turn in ${(1 / refineDuty).toFixed(0)}`}`,
      `only ${refinery.REFINERY_MAX_WORKERS} people may refine in a turn`,
    ],
  });
  // The cut is free and once a turn, and a shift needs one lump, so Godflesh never binds a worker
  // who refines on the ladder's schedule; the ladder does.
  const soloRate = shift * Math.min(refineDuty, bare.godflesh);
  push({
    id: "factory:solo",
    name: "Factory solo — cut, then refine",
    kind: "refine",
    family: "factory",
    skill: "—",
    skillPoints: 0,
    moves: 1,
    revenue: shift,
    inputs: 0,
    inputsBuy: 0,
    duty: Math.min(refineDuty, bare.godflesh),
    cutGodflesh: bare.godflesh,
    injuryChance: bare.injuryChance,
    netPerTurnSell: soloRate,
    netPerTurnBuy: soloRate,
    flags: [
      `the cut costs no Move (misc.js extractGodfleshRequestImpl)`,
      `${(bare.injuryChance * 100).toFixed(0)}% a cut goes wrong; bare hands`,
      `only ${refinery.REFINERY_MAX_WORKERS} people may refine in a turn`,
      `carry cap not modelled`,
    ],
  });
  params.cut = { bare, saw };

  // --- Butchering and the Caving Die: free actions with drops ----------------
  // Neither spends a Move, so there is no ¢/turn. What limits them is the
  // input: a body, a monster corpse, an arelitz, or a walk into the dark.
  const butcherSkill = get("butcher");
  const butcherRow = (id, name, outs, inputs, flags) => {
    const revenue = outs.reduce((sum, o) => sum + o.quantity * sellOf(o.slug), 0);
    producerDrops.butcher.push({
      name,
      outputs: outs.map((o) => ({ slug: o.slug, name: get(o.slug)?.name ?? o.slug, quantity: o.quantity, unit: sellOf(o.slug), priced: get(o.slug)?.sellablePrice != null })),
      revenue,
      inputs,
    });
    push({
      id: `butcher:${id}`,
      name: `Butcher — ${name}`,
      kind: "butcher",
      family: "butchery",
      skill: "butcher",
      skillPoints: butcherSkill?.pointCost ?? 0,
      moves: 0,
      revenue,
      inputs,
      inputsBuy: inputs,
      duty: 1,
      netPerTurnSell: null,
      netPerTurnBuy: null,
      flags: ["free action: no Move, no ⬢", ...flags],
    });
  };
  butcherRow(
    "human",
    "a human corpse, all organs",
    corpseOrgans(),
    0,
    ["needs a body", "Human Flesh feeds (12 hunger) but cannot be sold", "does not free the soul"],
  );
  const monsterYields = sources.monsterYields;
  for (const [corpse, out] of Object.entries(monsterYields)) {
    butcherRow(`monster:${corpse}`, `${get(corpse)?.name ?? corpse}`, [{ slug: out, quantity: 1 }], 0, ["needs a monster's corpse"]);
  }
  const adult = corpses.LIVESTOCK_YIELDS[sources.livestockAdultSlug];
  const arelitzBuy = get(sources.livestockAdultSlug)?.depotPrice ?? 0;
  butcherRow("arelitz-adult", "an adult arelitz", adult, arelitzBuy, [`priced at the ${arelitzBuy} ¢ Depot price; raised from an egg it costs feed only`]);
  const young = corpses.LIVESTOCK_YIELDS[sources.livestockYoungSlug];
  butcherRow("arelitz-young", "a young arelitz", young, 0, ["raised in a stable"]);

  for (const [zoneKey, label] of [["caves", "Caves"], ["depths", "Depths"]]) {
    const ev = evOf(producerDrops.caving[zoneKey]);
    push({
      id: `cave:${zoneKey}`,
      name: `Caving Die — ${label} (per arrival)`,
      kind: "cave-walk",
      family: "caving",
      skill: "—",
      skillPoints: 0,
      moves: 0,
      revenue: ev,
      inputs: 0,
      inputsBuy: 0,
      dropsPerAction: ev,
      duty: 1,
      netPerTurnSell: null,
      netPerTurnBuy: null,
      flags: ["free: walking wakes the Die", `${(SOURCE_RULES.cavingFindChance * 100).toFixed(0)}% of arrivals find, and 1 in 6 is Trouble`, "loot valued at sell price: a floor"],
    });
  }

  // --- cooking: food, not money ------------------------------------------------
  // No dish can be sold to the Depot, so a cook has no ¢/turn. What a cook
  // makes is hunger and mood, so that is what is measured: how many
  // person-turns of food a Move produces, and what the ingredients cost.
  const cookRows = [];
  for (const t of list) {
    const r = t.requirement;
    if (!t.craftable || !r?.skills?.some((sk) => /^cooking/.test(sk))) continue;
    const ex = expandRecipe(t.slug);
    let points = 0;
    for (const sk of r.skills) points = Math.max(points, skillChain(sk).points);
    const hungerRestored = t.mealHunger ?? 0;
    const personTurns = hungerRestored / params.hungerDecay;
    const rec = recBySlug.get(t.slug);
    cookRows.push({
      slug: t.slug,
      name: t.name,
      skill: r.skills.join(", "),
      skillPoints: points,
      moves: Math.round(ex.moves * 10000) / 10000,
      hunger: hungerRestored,
      mood: t.mealMood ?? 0,
      ingredients: (rec?.items ?? []).map((i) => i.label),
      costPerDish: ex.cost,
      costPerPersonTurn: personTurns > 0 ? ex.cost / personTurns : null,
      dishesPerMove: ex.moves > 0 ? Math.round((1 / ex.moves) * 100) / 100 : null,
      personTurnsPerMove: ex.moves > 0 ? Math.round((personTurns / ex.moves) * 100) / 100 : null,
      easy: rec?.easy ?? false,
      hardest: rec?.hardest ?? 0,
      hardestItem: rec?.hardestItem ?? null,
      flags: ex.flags,
    });
  }

  // --- wages: the benchmarks the price ladder is measured against ----------
  const byId = (id) => activities.find((a) => a.id === id);
  const median = (xs) => {
    const s = [...xs].sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  };

  // The easy-craft baselines. A crafter BUYS ⬢ at the Depot (${rv.buy} ¢), so
  // these are ranked with ⬢ at the buy price. "Easy" means every input is on
  // the general shelf, farmed, or extremely common (sources.js), and the recipe
  // can be worked without an ore supply of a dozen Prospectors behind it.
  const crafts = activities.filter((a) => a.kind === "craft" && !a.copy && a.netPerTurnBuy != null && a.totalMoves > 0);
  const oreLimited = (a) => (a.oreNeeds ?? []).some((o) => o.prospectors > 2);
  const easyCrafts = crafts.filter((a) => a.easy);
  const shortlist = (pred) => easyCrafts.filter(pred).sort((x, y) => y.netPerTurnBuy - x.netPerTurnBuy || x.skillPoints - y.skillPoints);
  const isCrafting = (a) => a.skill.split(", ").includes("crafting");
  const smithFam = (a) => a.family === "smithing" || isCrafting(a);
  const shortlists = {
    smithing: shortlist((a) => a.family === "smithing" && !isCrafting(a)),
    crafting: shortlist(isCrafting),
    brewing: shortlist((a) => a.family === "brewing"),
    noWorkshop: shortlist((a) => smithFam(a) && !a.workshop),
    cooking: cookRows.filter((c) => c.easy).sort((x, y) => (x.costPerPersonTurn ?? 1e9) - (y.costPerPersonTurn ?? 1e9) || y.mood - x.mood),
  };
  const bestOf = (rows, maxPts) => rows.filter((a) => a.skillPoints <= maxPts && !oreLimited(a))[0];
  const baselineRows = [
    { key: "Crafter", note: "Crafting, 2 pt, no forge", act: bestOf(shortlists.crafting, 2) },
    { key: "Starter smith", note: "Smithing I, 5 pt", act: bestOf(shortlists.smithing, 5) },
    { key: "Skilled smith", note: "Smithing II, 10 pt", act: bestOf(shortlists.smithing, 10) },
    { key: "Starter brewer", note: "Brewing I, 5 pt", act: bestOf(shortlists.brewing, 5) },
    { key: "Skilled brewer", note: "Brewing II, 10 pt", act: bestOf(shortlists.brewing, 10) },
  ].filter((b) => b.act);
  const baselines = baselineRows.map((b) => ({
    key: `${b.key}: ${b.act.name}`,
    role: b.key,
    note: b.note,
    slug: b.act.slug,
    value: b.act.netPerTurnBuy,
    valueMined: b.act.netPerTurnSell,
    skillPoints: b.act.skillPoints,
  }));
  const cheapestMeal = shortlists.cooking.find((c) => c.costPerPersonTurn != null);
  const wages = [
    { key: "Unskilled miner (Caves)", value: byId("mine:Caves:unskilled")?.netPerTurn },
    { key: "Prospector (Caves)", value: byId("mine:Caves:skilled")?.netPerTurn },
    ...baselines.map((b) => ({ key: b.key, value: b.value, baseline: true })),
    { key: "Farmer (potato, sold)", value: byId("farm:potato")?.netPerTurn },
    { key: "Factory solo", value: byId("factory:solo")?.netPerTurn },
  ].filter((w) => w.value != null && w.value > 0);

  // --- combining day-verbs ----------------------------------------------------
  const combos = buildCombos({
    activities,
    fatigue,
    bySlug,
    params,
    gameTurns,
    free: freeMoves ?? schemaDefault("freeZoneMovesPerTurn"),
    seats: refinery.REFINERY_MAX_WORKERS,
  });

  // --- the price ladder ------------------------------------------------------
  const priceLadder = list
    .filter((t) => t.depotPrice != null && t.slug !== "resources")
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      price: t.depotPrice,
      sellBack: t.sellablePrice ?? null,
      manifest: t.manifest ?? "merchant",
      turns: Object.fromEntries(wages.map((w) => [w.key, t.depotPrice / w.value])),
    }))
    .sort((a, b) => a.price - b.price);

  // --- pricing-rule consistency ----------------------------------------------
  const priceRule = list
    .filter((t) => t.depotPrice != null && t.sellablePrice != null && t.slug !== "resources")
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      buy: t.depotPrice,
      sell: t.sellablePrice,
      ratio: t.sellablePrice / t.depotPrice,
      expected: Math.max(1, Math.round(t.depotPrice * 0.6)),
      craftable: !!t.craftable,
    }))
    .map((r) => ({ ...r, off: r.sell - r.expected, arbitrage: r.sell >= r.buy }));

  // --- food -------------------------------------------------------------------
  const foods = [];
  for (const t of list) {
    const h = t.cooked?.hunger ?? t.mealHunger ?? null;
    if (!h) continue;
    const cost = t.depotPrice ?? t.sellablePrice ?? null;
    const perPersonTurn = params.hungerDecay / h; // units that feed one person for one turn
    foods.push({
      slug: t.slug,
      name: t.name,
      kind: t.craftable && t.requirement?.turnsCost != null && t.mealHunger != null ? "dish" : "foodstuff",
      hunger: h,
      weight: t.weight ?? 0,
      buy: t.depotPrice ?? null,
      sell: t.sellablePrice ?? null,
      moves: t.requirement?.turnsCost ?? null,
      costPerPersonTurn: cost == null ? null : cost * perPersonTurn,
      lbPerPersonTurn: (t.weight ?? 0) * perPersonTurn,
    });
  }
  foods.sort((a, b) => (a.costPerPersonTurn ?? 1e9) - (b.costPerPersonTurn ?? 1e9));

  // Supply against demand: how many farmers does a town need?
  const demandPerTurn = players * params.hungerDecay;
  const foodSupply = farmRows.map((f) => {
    const hungerPerFarmTurn = (f.harvest * f.hunger) / farmCycle;
    return {
      crop: f.crop,
      harvest: f.harvest,
      hungerPerFarm: f.harvest * f.hunger,
      personTurnsPerFarm: (f.harvest * f.hunger) / params.hungerDecay,
      farmersNeeded: hungerPerFarmTurn > 0 ? demandPerTurn / hungerPerFarmTurn : null,
      lbPerFarm: f.harvest * f.weight,
    };
  });

  // --- the ⬢ balance ------------------------------------------------------
  // Mining is the faucet; recipes are the sink. How many miners does one
  // crafter of each family keep in material?
  const bestMiner = byId("mine:Caves:skilled");
  const minerPerTurn = bestMiner.resourcesPerPress * bestMiner.duty;
  const resourceBalance = [...new Set(activities.filter((a) => a.kind === "craft").map((a) => a.family))]
    .map((family) => {
      const burn = activities
        .filter((a) => a.family === family && a.resourcesPerTurn != null)
        .map((a) => a.resourcesPerTurn);
      return {
        family,
        recipes: burn.length,
        medianBurn: median(burn),
        maxBurn: burn.length ? Math.max(...burn) : 0,
        minersPerCrafter: median(burn) / minerPerTurn,
        // Who can pay in obols, and so what the most a buyer will give for a Prospector's ⬢ is: a
        // smith can put one obol toward one ⬢, so 1 ¢; anybody else must HOLD ⬢, and the alternative
        // is importing them at the Depot's buy price.
        payInObols: obolFamilies.includes(family),
        ceiling: obolFamilies.includes(family) ? OBOL_PAR : rv.buy,
      };
    })
    .filter((r) => r.recipes > 0)
    .sort((a, b) => b.medianBurn - a.medianBurn);
  params.minerResourcesPerTurn = minerPerTurn;

  // A Prospector's worth, three ways: ⬢ sold back at the Depot, ⬢ as the Depot would charge you for
  // them (what they are worth to somebody who must hold them), and ⬢ paid to a smith, who puts one
  // obol toward one ⬢ and so will pay no more than that. Drops are the same in all three.
  const prospectorValue = activities
    .filter((a) => a.kind === "mine" && a.skillPoints > 0)
    .map((a) => ({
      name: a.name.replace("Mine — ", ""),
      resourcesPerTurn: a.resourcesPerPress * a.duty,
      dropsPerTurn: a.dropsPerAction * a.duty,
      atSell: a.netPerTurnSell,
      atBuy: a.netPerTurnBuy,
      atSmith: (a.resourcesPerPress * OBOL_PAR + a.dropsPerAction) * a.duty,
    }));

  // --- tools -------------------------------------------------------------------
  const tools = list
    .filter((t) => t.miningBonus?.amount)
    .map((t) => {
      const price = t.depotPrice ?? t.sellablePrice ?? null;
      const perTurn = t.miningBonus.amount * rv.sell * mineDuty;
      return { slug: t.slug, name: t.name, price, bonus: t.miningBonus.amount, paybackTurns: price != null ? price / perTurn : null };
    });

  const cookingRecipeCount = list.filter(
    (t) => t.craftable && t.requirement?.skills?.some((sk) => /^cooking/.test(sk)),
  ).length;

  // --- what the docs say, against what this says --------------------------------
  const red = byId("craft:ravenheart-red");
  const potato = byId("farm:potato");
  const claims = [
    {
      doc: "DEPOT.md §3",
      claim: "⬢ import at 2 ¢, sell back at 1 ¢",
      docValue: "2 in / 1 out",
      model: `${rv.buy} in / ${rv.sell} out`,
      ok: rv.buy === 2 && rv.sell === 1,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A supplied refining day is 40 ¢",
      docValue: 40,
      model: shift,
      ok: shift === 40,
    },
    {
      doc: "DEPOT.md §4",
      claim: "Ravenheart Red pays about 12 ¢ a turn",
      docValue: 12,
      model: red ? round1(red.netPerTurnSell) : null,
      ok: red && Math.abs(red.netPerTurnSell - 12) < 0.5,
      note: "The doc prices the alcohol at its 4 ¢ shelf price, but it is on the Merchant's shelf. Made at home it is 0.25 Move and 2 ⬢ more, which is what the model does.",
    },
    {
      doc: "FACTORY.md §6",
      claim: "A solo Factory worker refines every other turn, for 20 ¢ a turn",
      docValue: 20,
      model: round1(soloRate),
      ok: Math.abs(soloRate - 20) < 0.5,
    },
    {
      doc: "FACTORY.md §4",
      claim: "Five people may refine at the Factory in a turn",
      docValue: 5,
      model: refinery.REFINERY_MAX_WORKERS,
      ok: refinery.REFINERY_MAX_WORKERS === 5,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A Prospector at the Caves makes about 9 ¢ a turn with the ⬢ valued at the Depot's 2 ¢ buy price",
      docValue: 9,
      model: round1(byId("mine:Caves:skilled")?.netPerTurnBuy),
      ok: Math.abs(byId("mine:Caves:skilled").netPerTurnBuy - 9) < 0.5,
    },
    {
      doc: "DEPOT.md §4",
      claim: "\"Paying a recipe's cost with held obols still works\" (read as any recipe)",
      docValue: "any recipe",
      model: `${obolFamilies.join(", ")} only`,
      ok: false,
      note: "resolveObolSpend in crafting.js returns at once unless the recipe is in the smithing family. Brewing, crafting and the rest must hold real ⬢.",
    },
    {
      doc: "SOILERY.md §1",
      claim: "Every crop sells for 1 ¢: farming is for eating, not cash",
      docValue: 1,
      model: Math.max(...soilery.CROPS.filter((c) => c.crop !== "pigtails").map((c) => get(c.crop)?.sellablePrice ?? 0)),
      ok: soilery.CROPS.filter((c) => c.crop !== "pigtails").every((c) => (get(c.crop)?.sellablePrice ?? 0) <= 1),
    },
    {
      doc: "BREWING.md §3",
      claim: "Moonshine costs no Move, and one Godflesh is its whole limit",
      docValue: 0,
      model: get("moonshine")?.requirement?.turnsCost,
      ok: get("moonshine")?.requirement?.turnsCost === 0,
    },
    {
      doc: "FACTORY.md §3",
      claim: "Exactly one Location carries godflesh (the Refuse Pit)",
      docValue: 1,
      model: locationsWithAttribute("godflesh").join(", ") || "none",
      ok: locationsWithAttribute("godflesh").length === 1,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A Farm action nets about 38 ¢ (potato, after the seed bag)",
      docValue: 38,
      model: potato ? round1(potato.revenue - potato.inputs) : null,
      ok: potato && Math.abs(potato.revenue - potato.inputs - 38) < 1,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A farmer makes about 13 ¢ a turn, a Prospector at the Caves about 5 (⬢ sold back at 1 ¢)",
      docValue: "13 / 5",
      model: `${round1(potato?.netPerTurnSell)} / ${round1(byId("mine:Caves:skilled")?.netPerTurnSell)}`,
      ok: potato && Math.abs(potato.netPerTurnSell - 13) < 1 && Math.abs(byId("mine:Caves:skilled").netPerTurnSell - 5) < 0.6,
    },
    {
      doc: "SOILERY.md §6",
      claim: "A seed bag costs 4 ¢",
      docValue: 4,
      model: get("wheat-seed-bag")?.depotPrice,
      ok: get("wheat-seed-bag")?.depotPrice === 4,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A cube weighs 17 lb",
      docValue: 17,
      model: squeeze.weight,
      ok: squeeze.weight === 17,
    },
    {
      doc: "TURN-ENGINE.md §5",
      claim: "Hunger decays 10 a turn and Hungry starts at 30",
      docValue: "10 / 30",
      model: `${hunger.HUNGER_DECAY_PER_TURN} / ${hunger.HUNGRY_THRESHOLD}`,
      ok: hunger.HUNGER_DECAY_PER_TURN === 10 && hunger.HUNGRY_THRESHOLD === 30,
    },
    {
      doc: "DEPOT.md §3",
      claim: "Sell-back is 60% of the buy price, rounded",
      docValue: "60%",
      model: `${priceRule.filter((r) => Math.abs(r.off) <= 1).length} of ${priceRule.length} within ±1 ¢`,
      ok: priceRule.every((r) => Math.abs(r.off) <= 1),
      note: "Wage-floor wares and hand-priced entries are expected to differ; see the pricing table.",
    },
    {
      doc: "DEPOT.md §4",
      claim: "A buy price at or below a sell price would let anyone print coin, so none exists",
      docValue: "0 wares",
      model: `${priceRule.filter((r) => r.arbitrage).length} wares: ${priceRule.filter((r) => r.arbitrage).map((r) => `${r.slug} ${r.buy}→${r.sell}`).join(", ") || "none"}`,
      ok: priceRule.every((r) => !r.arbitrage),
      note: "syncTags only warns on an inversion. A ware bought from the Black Market and dropped in the box pays the difference, less the sell tax.",
    },
    {
      doc: "MINING.md §5",
      claim: "Somebody mining flat out works every other turn",
      docValue: 0.5,
      model: round1(fatigue.byId.mine.steady * 100) / 100,
      ok: Math.abs(fatigue.byId.mine.steady - 0.5) < 0.01,
    },
    {
      doc: "SOILERY.md §5a",
      claim: "A farmer works one turn in three",
      docValue: "1 in 3",
      model: `1 in ${round1(1 / fatigue.byId.farm.steady)}`,
      ok: Math.abs(fatigue.byId.farm.steady - 1 / 3) < 0.01,
    },
    {
      doc: "FACTORY.md §6",
      claim: "Refining climbs the Tired and Exhausted ladder like Mine; cutting Godflesh does not",
      docValue: "refine yes, cut no",
      model: `refine ${fatigue.byId.refine.tires ? "yes" : "no"}, cut ${fatigue.byId.cut.tires ? "yes" : "no"}`,
      ok: fatigue.byId.refine.tires && !fatigue.byId.cut.tires,
    },
    {
      doc: "DEPOT.md §0i",
      claim: "Unarmoured, the turret grazes 6%, wounds 14/16/24%, leaves 22% dying and 18% dead",
      docValue: "6/14/16/24/22/18 %",
      model: ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"]
        .map((k) => Math.round(turretTable(null)[k] * 1000) / 10)
        .join("/") + " %",
      ok: ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"].every(
        (k, i) => Math.abs(turretTable(null)[k] - [0.06, 0.14, 0.16, 0.24, 0.22, 0.18][i]) < 0.005,
      ),
      note: "Code comment in depotTurret.js says three fifths dying or dead, and ARMOR_GAIN is 0.25, not the 3 the doc's armour formula uses.",
    },
    {
      doc: "DEPOT.md §4",
      claim: "No smithing recipe out-earns the Gunpowder rung (about 22.5 ¢ a turn); the curve never falls",
      docValue: 22.5,
      model: (() => {
        const top = activities
          .filter((a) => a.family === "smithing" && a.netPerTurnSell != null)
          .sort((a, b) => b.netPerTurnSell - a.netPerTurnSell)[0];
        return `${round1(top.netPerTurnSell)} (${top.name})`;
      })(),
      ok: activities.filter((a) => a.family === "smithing" && a.netPerTurnSell != null).every((a) => a.netPerTurnSell <= 23),
      note: "Iron, Glass Eye, Prosthetic Hand and the iron-cored 1-turn pieces sit above the rungs the doc says they cannot overtake.",
    },
    {
      doc: "COOKING.md §2a",
      claim: "31 named cooking recipes",
      docValue: 31,
      model: cookingRecipeCount,
      ok: cookingRecipeCount === 31,
    },
    {
      doc: "COOKING.md §3",
      claim: "58 tags carry a cooked block",
      docValue: 58,
      model: list.filter((t) => t.cooked).length,
      ok: list.filter((t) => t.cooked).length === 58,
    },
    {
      doc: "DEPOT.md §0d",
      claim: "Sealed shipping is eight named wares",
      docValue: 8,
      model: list.filter((t) => t.sealedShipping).length,
      ok: list.filter((t) => t.sealedShipping).length === 8,
    },
  ];

  return {
    params,
    assumptions: ASSUMPTIONS,
    activities,
    wages,
    priceLadder,
    priceRule,
    resourceBalance,
    prospectorValue,
    combos,
    shortlists: { ...shortlists, cookingAll: cookRows },
    baselines,
    cheapestMeal,
    fatigue,
    sources,
    producerDrops,
    foods,
    foodSupply,
    tools,
    claims,
    counts: { tags: list.length, craftable: list.filter((t) => t.craftable).length },
  };
}

const assumptions = Object.fromEntries(ASSUMPTIONS.map((a) => [a.key, a.value]));
const round1 = (n) => Math.round(n * 10) / 10;

module.exports = { buildModel, ASSUMPTIONS };
