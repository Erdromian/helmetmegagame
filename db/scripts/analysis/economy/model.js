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
const depotRules = require("../../../lib/depot");
const { fatigueModel } = require("./fatigue");
const { buildCombos } = require("./combos");
const { buildInvestments } = require("./investments");
const { buildCaving } = require("./caving");
const { buildTrinkets } = require("./trinkets");
const { buildCooking } = require("./cooking");
const { buildDesires } = require("./desires");
const { buildLucky } = require("./lucky");
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

// Every minable Location with the zone it stands in and its authored coefficient. A cave level is
// its own zone (docs/zones.yaml: zones.underground.levels.caves), matching the loot tables' keys.
function loadMiningSites() {
  const doc = readYaml("docs/zones.yaml");
  const out = [];
  const scan = (zone, locations) => {
    for (const [slug, loc] of Object.entries(locations ?? {})) {
      if (typeof loc.mining === "number") out.push({ slug, zone, coeff: loc.mining });
    }
  };
  for (const [zk, zv] of Object.entries(doc.zones)) {
    scan(zk, zv.locations);
    for (const [lk, lv] of Object.entries(zv.levels ?? {})) scan(lk, lv.locations);
  }
  return out;
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
  // No function means no obol path: nothing can be paid that way and the model says so.
  if (!fn) return [];
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

function buildModel({ players = 100, gameTurns = 30, freeMoves = null, resourceValue = "buy", minedValue = "mid", obolPath = "auto", moveValue = null } = {}) {
  const { list, bySlug } = loadCatalog();
  const get = (slug) => bySlug.get(slug);
  const sources = buildSources({ list, bySlug, players });
  // How often each day-verb can be pressed, played out with the game's own gates.
  const fatigue = fatigueModel({ bySlug, gameTurns });
  const mineDuty = fatigue.byId.mine.steady;
  const farmDuty = fatigue.byId.farm.steady;

  const resources = get("resources");
  // The Depot's ⬢ prices are the CONSTANTS in db/lib/depot.js: the depot page and its order action build
  // the ⬢ row from them and never read the `resources` tag, whose own prices are "decorative for this
  // surface" (that file says so). So the valuations read the constants, and a claim below checks the tag's
  // copy still agrees.
  const rv = { sell: depotRules.RESOURCE_EXPORT_PRICE, buy: depotRules.RESOURCE_IMPORT_PRICE };
  const resourceTagCopy = { sell: resources.sellablePrice ?? null, buy: resources.depotPrice ?? null };
  // A sell-back is taxed by Depot.sellTaxRate (a whole percent the Meister sets; default 0), taken off every
  // settled sale before the seller is paid (db/lib/trainDeparturePass.js). Shown, not applied: at the default
  // it changes nothing, and a set rate takes that share off every sell-side figure in this report.
  const sellTaxRate = schemaDefault("sellTaxRate");
  // Which price a ⬢ is valued at in the headline figures. The default is the Depot's BUY price:
  // that is what a ⬢ costs somebody who needs one and holds none. `--resource-value sell` gives the
  // 1 ¢ sell-back instead. Both are always in the tables, named.
  if (resourceValue !== "buy" && resourceValue !== "sell") throw new Error("resourceValue must be 'buy' or 'sell'");
  const rvMain = resourceValue === "sell" ? rv.sell : rv.buy;
  // What a Prospector's own ⬢ is worth. A Prospector will not get the Depot's import price, which is what a
  // buyer pays only when nobody else has any to sell, and would not take the 1 ¢ sell-back from another
  // player either. The two meet in the middle, so the headline mining figures value a mined ⬢ at the
  // midpoint of the Depot's two prices (2 ¢ at 3 in and 1 out). `--mined-value buy|sell` moves it to either end.
  rv.mid = (rv.buy + rv.sell) / 2;
  if (!["buy", "mid", "sell"].includes(minedValue)) throw new Error("minedValue must be 'buy', 'mid' or 'sell'");
  const rvMined = rv[minedValue];
  const productionCoefficient = schemaDefault("productionCoefficient");
  const farmMaxCrops = schemaDefault("farmMaxCrops");
  const stableCapacity = schemaDefault("stableCapacity");
  const startingTagPoints = schemaDefault("startingTagPoints");
  const miningLocations = loadMiningSites();

  // `obolPath: "off"` previews the game with the obol payment removed. "auto" reads the source.
  const obolFamilies = obolPath === "off" ? [] : obolPayableFamilies();
  const params = {
    players,
    rv,
    resourceTagCopy,
    sellTaxRate,
    rvMain,
    rvMined,
    minedValue,
    obolFamilies,
    obolPath,
    resourceValue,
    productionCoefficient,
    farmMaxCrops,
    stableCapacity,
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
    // What a maker pays for one: the Depot's price where the shelf sells it (a round trip with the
    // Merchant buys its inputs there), otherwise what it would fetch instead.
    if (t.depotPrice != null) return t.depotPrice;
    if (t.sellablePrice != null) return t.sellablePrice;
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
      caves: {
        plain: dropTable(sources.drops.prospecting.caves.plain.dist),
        skilled: dropTable(sources.drops.prospecting.caves.skilled.dist),
      },
      depths: {
        plain: dropTable(sources.drops.prospecting.depths.plain.dist),
        skilled: dropTable(sources.drops.prospecting.depths.skilled.dist),
      },
    },
    caving: {
      caves: dropTable(sources.drops.caving.caves.dist, SOURCE_RULES.cavingFindChance),
      depths: dropTable(sources.drops.caving.depths.dist, SOURCE_RULES.cavingFindChance),
    },
    butcher: [],
  };
  const lootEv = (zoneKey, skilled) => ({ ev: evOf(producerDrops.prospecting[zoneKey][skilled ? "skilled" : "plain"]) });

  // The gate is a held Pickaxe; Prospecting multiplies both the ⬢ (x1.7) and the loot column
  // (docs/systemdocs/MINING.md §1). The pickaxe's own +1 counts, on the reading that anybody who
  // holds one wears it. `mining.computeRate` is the game's own arithmetic, rounding and all.
  const pickaxe = get("pickaxe");
  const pickBonus = pickaxe?.miningBonus?.amount ?? 0;
  params.pickaxe = { price: pickaxe?.depotPrice ?? null, points: pickaxe?.pointCost ?? 0, bonus: pickBonus };
  params.miningBase = mining.MINING_RATE;
  params.prospectingMultiplier = mining.PROSPECTING_YIELD_MULTIPLIER;
  // Sites, from the map: each cave level's distinct coefficients, the poorest named for the level
  // and any richer one named for what it is (the deepest seam).
  const miningSites = [];
  for (const zone of ["caves", "depths"]) {
    const coeffs = [...new Set(miningLocations.filter((l) => l.zone === zone).map((l) => l.coeff))].sort((x, y) => x - y);
    const zoneName = zone[0].toUpperCase() + zone.slice(1);
    coeffs.forEach((coeff, i) => miningSites.push({ site: i === 0 ? zoneName : `${zoneName}, richest seam`, zone, coeff }));
  }
  const prospectingTag = get("prospecting");
  for (const s of miningSites) {
    for (const skilled of [false, true]) {
      const range = mining.computeRate(productionCoefficient, s.coeff, skilled);
      const resources = (range.min + range.max) / 2 + pickBonus;
      const loot = lootEv(s.zone, skilled);
      const flags = [
        "needs a pickaxe, held",
        "payout lands at the press",
        "Lifeweb failure not modelled",
        "loot valued at sell price: a floor",
      ];
      push({
        id: `mine:${s.site}:${skilled ? "skilled" : "unskilled"}`,
        name: `Mine — ${s.site}, ${skilled ? "Prospecting" : "pickaxe only"}`,
        kind: "mine",
        family: "mining",
        skill: skilled ? "prospecting" : "—",
        skillPoints: skilled ? prospectingTag.pointCost : 0,
        moves: 1,
        revenue: null,
        inputs: 0,
        inputsBuy: 0,
        duty: mineDuty,
        resourcesPerPress: resources,
        lootEv: loot.ev,
        dropsPerAction: loot.ev,
        perAction: resources * rvMined + loot.ev,
        baseNetPerTurn: resources * rvMined * mineDuty,
        netPerTurn: (resources * rvMined + loot.ev) * mineDuty,
        netPerTurnSell: (resources * rv.sell + loot.ev) * mineDuty,
        netPerTurnMid: (resources * rv.mid + loot.ev) * mineDuty,
        netPerTurnBuy: (resources * rv.buy + loot.ev) * mineDuty,
        flags,
      });
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
    { key: "Miner, pickaxe only (Caves)", value: byId("mine:Caves:unskilled")?.netPerTurn },
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
  // What eating one of a thing restores, the way the game reckons it (db/lib/hunger.js#foodHungerFor):
  // a dish's own hunger, an ingredient's, or the flat default for anything that just grants
  // `ate-meal`. Anything that OPENS into food is averaged over its outcomes: the Ration Box is one of
  // six equally likely draws (four foods, a rat that half the time makes you sick, and nothing).
  const eaten = (slug, seen = []) => {
    const t = get(slug);
    if (!t || slug === "nothing" || seen.includes(slug)) return { hunger: 0, mood: 0 };
    const own = hunger.foodHungerFor(t);
    if (own > 0) return { hunger: own, mood: t.cooked?.mood ?? t.mealMood ?? 0 };
    let hungerSum = 0;
    let moodSum = 0;
    for (const entry of t.consumesInto ?? []) {
      const options = typeof entry === "string" ? [entry] : entry.oneOf ? entry.oneOf.map((o) => (typeof o === "string" ? o : o.slug)) : [entry.slug];
      const share = 1 / options.length;
      for (const o of options.filter(Boolean)) {
        if (o === "ate-meal") hungerSum += share * hunger.DEFAULT_FOOD_HUNGER;
        else {
          const inner = eaten(o, [...seen, slug]);
          hungerSum += share * inner.hunger;
          moodSum += share * inner.mood;
        }
      }
    }
    return { hunger: hungerSum, mood: hungerSum > 0 ? moodSum || (t.cooked?.mood ?? 0) : 0 };
  };
  const shelfOf = (t) => (t.depotPrice == null ? null : t.manifest ?? "merchant");
  const foods = [];
  for (const t of list) {
    const e = eaten(t.slug);
    if (!(e.hunger > 0)) continue;
    const shelf = shelfOf(t);
    // A person with coin can BUY it only where the Depot sells it. Everything else is priced at what
    // the counter pays a grower, which is a floor on what a buyer would be asked.
    const cost = t.depotPrice ?? t.sellablePrice ?? null;
    const perPersonTurn = params.hungerDecay / e.hunger; // units that feed one person for one turn
    const opens = (t.consumesInto ?? []).some((x) => typeof x !== "string" && x.oneOf);
    foods.push({
      slug: t.slug,
      name: t.name,
      kind: opens && hunger.foodHungerFor(t) === 0 ? "box" : t.craftable && t.requirement?.turnsCost != null && t.mealHunger != null ? "dish" : "foodstuff",
      hunger: Math.round(e.hunger * 100) / 100,
      mood: Math.round(e.mood * 10) / 10,
      weight: t.weight ?? 0,
      buy: t.depotPrice ?? null,
      sell: t.sellablePrice ?? null,
      shelf,
      source: shelf === "general" ? "Depot, general shelf" : shelf ? `Depot, ${shelf} shelf` : "not sold at the Depot",
      basis: t.depotPrice != null ? "buy" : "sell",
      moves: t.requirement?.turnsCost ?? null,
      // Nobody wrote a hunger figure for it: the game falls back to the flat default (db/lib/hunger.js).
      defaulted: !Number.isInteger(t.mealHunger) && !Number.isInteger(t.cooked?.hunger) && hunger.foodHungerFor(t) > 0,
      costPerPersonTurn: cost == null ? null : cost * perPersonTurn,
      lbPerPersonTurn: (t.weight ?? 0) * perPersonTurn,
    });
  }
  foods.sort((a, b) => (a.costPerPersonTurn ?? 1e9) - (b.costPerPersonTurn ?? 1e9));
  // What food costs somebody who just has coin: the cheapest thing anyone can order, and the cheapest
  // on any shelf. The Ration Box sets a ceiling on what a buyer will pay a grower per hunger.
  const buyable = foods.filter((f) => f.shelf && f.costPerPersonTurn != null);
  const generalShelf = buyable.filter((f) => f.shelf === "general");
  const foodFloor = {
    anyone: generalShelf[0] ?? null,
    anyShelf: buyable[0] ?? null,
    ceilingPerHunger: generalShelf[0] ? (generalShelf[0].buy ?? 0) / generalShelf[0].hunger : null,
  };
  // The Box's own draws are priced as a set (a spread around, not up to, a turn), so the tier check leaves them out.
  const boxTag = get(foodFloor.anyone?.slug);
  const boxDraws = (boxTag?.consumesInto ?? [])
    .flatMap((x) => (typeof x === "string" ? [x] : x.oneOf ? x.oneOf : [x.slug]))
    .map((o) => (typeof o === "string" ? o : o?.slug))
    .filter((o) => o && o !== "nothing");
  foodFloor.draws = boxDraws.length;
  foodFloor.outcomes = boxDraws.length + ((boxTag?.consumesInto ?? []).some((x) => typeof x !== "string" && x.oneOf?.includes("nothing")) ? 1 : 0);
  // TURN-ENGINE.md §5 prices every food against one turn's decay: a raw ingredient about a third of a
  // turn (6-18 of 35), a basic cooked meal one turn (30-42), a skilled meal a turn and a half (46-56).
  // The bands are held as fractions of a turn, so a change to the decay that leaves the foods where they
  // were pushes them out of their band, which is exactly the drift this exists to catch. A change that
  // moves both together passes, and the figures in the report follow it.
  const FOOD_TIER_BANDS = { raw: [6 / 35, 18 / 35], basic: [30 / 35, 42 / 35], skilled: [46 / 35, 56 / 35] };
  const tierOf = (turnsOfFood) => Object.keys(FOOD_TIER_BANDS).find((k) => turnsOfFood >= FOOD_TIER_BANDS[k][0] - 1e-9 && turnsOfFood <= FOOD_TIER_BANDS[k][1] + 1e-9) ?? null;
  for (const f of foods) {
    f.turnsOfFood = f.hunger / params.hungerDecay;
    f.tier = f.kind === "box" || boxDraws.includes(f.slug) ? "box" : tierOf(f.turnsOfFood);
  }
  const foodTiers = {
    bands: FOOD_TIER_BANDS,
    counts: Object.fromEntries(["raw", "basic", "skilled", "box"].map((k) => [k, foods.filter((f) => f.tier === k).length])),
    offTier: foods.filter((f) => f.tier == null),
    defaulted: foods.filter((f) => f.defaulted),
    boxTurns: foodFloor.anyone ? foodFloor.anyone.hunger / params.hungerDecay : null,
  };

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

  // A Prospector's worth, four ways: ⬢ bartered at the midpoint (the headline), ⬢ sold back at the Depot, ⬢ as the Depot would charge you for
  // them (what they are worth to somebody who must hold them), and ⬢ paid to a smith, who puts one
  // obol toward one ⬢ and so will pay no more than that. Drops are the same in all three.
  const prospectorValue = activities
    .filter((a) => a.kind === "mine" && a.skillPoints > 0)
    .map((a) => ({
      name: a.name.replace("Mine — ", ""),
      resourcesPerTurn: a.resourcesPerPress * a.duty,
      dropsPerTurn: a.dropsPerAction * a.duty,
      atSell: a.netPerTurnSell,
      atMid: a.netPerTurnMid,
      atBuy: a.netPerTurnBuy,
      atSmith: (a.resourcesPerPress * OBOL_PAR + a.dropsPerAction) * a.duty,
    }));

  // --- tools -------------------------------------------------------------------
  const tools = list
    .filter((t) => t.miningBonus?.amount)
    .map((t) => {
      const price = t.depotPrice ?? t.sellablePrice ?? null;
      const perTurn = t.miningBonus.amount * rvMined * mineDuty;
      return { slug: t.slug, name: t.name, price, bonus: t.miningBonus.amount, paybackTurns: price != null ? price / perTurn : null };
    });

  const cookingRecipeCount = list.filter(
    (t) => t.craftable && t.requirement?.skills?.some((sk) => /^cooking/.test(sk)),
  ).length;

  // --- what the docs say, against what this says --------------------------------
  const moveValueUsed = moveValue ?? activities.find((a) => a.id === "mine:Caves:unskilled")?.netPerTurn ?? 5;
  const caving = buildCaving({ get, list, rv, rvMined, sources, moveValue: moveValueUsed, activities, gameTurns });
  // What the Merchant's floor pays a maker per Move, by the cumulative skill points the recipe is gated
  // behind, with every ⬢ bought at the Depot's import price (DEPOT.md §4). Prices are set from this table:
  // sell = inputs at the Depot's price + import price × ⬢ + round(rate × turns^1.3). Read here as the
  // intent the catalog is checked against, so a new recipe priced off the old ⬢-at-1 arithmetic shows up.
  const IMPORT_PRICE = rv.buy;
  const PROFIT_RATE_BY_POINTS = { 0: 1, 2: 1, 5: 2, 10: 4, 15: 5, 19: 6 };
  const rateAt = (pts) => PROFIT_RATE_BY_POINTS[Object.keys(PROFIT_RATE_BY_POINTS).map(Number).filter((k) => k <= pts).sort((a, b) => b - a)[0]];
  // Depot shelf prices and previous sell prices are left alone, so a recipe is fitted to its price by moving its
  // ⬢ cost instead. Two cannot be fitted that way: the Pickaxe (a quarter-Move craft moves in steps of 4 ¢ a
  // turn) and the Autoinjector (its inputs cost more than its shelf price).
  const HELD_BACK = new Set(["pickaxe", "autoinjector"]);
  // Bars are the one input-worked recipe priced by scarcity rather than by the formula: the ore cannot be
  // bought, so the ore is the bottleneck and the bar's price is free to be large next to it (Bascinet, 2026-09-20).
  const BARS = new Set(["iron", "copper", "nickel"]);
  const tierFamilies = ["smithing", "crafting", "brewing"];
  const hasItemInput = (a) => (get(a.slug)?.requirement?.items ?? []).length > 0;
  const inScope = (a) => a.kind === "craft" && a.revenue > 0 && tierFamilies.includes(a.craftFamily ?? a.family);
  const profitRows = activities
    .filter((a) => inScope(a) && !hasItemInput(a) && a.netPerTurnBuy != null && !HELD_BACK.has(a.slug))
    .map((a) => ({ slug: a.slug, name: a.name, family: a.craftFamily ?? a.family, points: a.skillPoints, rate: rateAt(a.skillPoints), got: a.netPerTurnBuy, moves: a.totalMoves }));
  // Prices and ⬢ are whole numbers, so a craft's profit moves in whole ¢: allow 2 ¢ a Move, half the rate, or a
  // craft and a half of slack (a wide 6 ¢ a Move on a quarter-Move piece), whichever is widest.
  const offRate = profitRows.filter((r) => Math.abs(r.got - r.rate) > Math.max(2, 0.5 * r.rate, 1.5 / r.moves));
  const profitTiers = [...new Set(profitRows.map((r) => r.points))].sort((a, b) => a - b).map((pts) => {
    const rows = profitRows.filter((r) => r.points === pts);
    const got = rows.map((r) => r.got);
    return { points: pts, rate: rateAt(pts), n: rows.length, min: Math.min(...got), max: Math.max(...got), median: median(got), families: [...new Set(rows.map((r) => r.family))] };
  });
  // A recipe that works an input is priced off the input instead: its wage, its ⬢ at the import price, and the
  // input at nearly twice its sell price when the input is raw (ore, cave finds, organs, crops), once when it is
  // itself crafted. The multiplier is the doc's "nearly 2x"; a whole-¢ round on each side allows 1 ¢ of slack.
  const INPUT_PREMIUM = 1.9;
  const inputPrice = (slug) => get(slug)?.sellablePrice ?? get(slug)?.depotPrice ?? 0;
  const workedInput = (a) => {
    const t = get(a.slug);
    const r = t.requirement;
    const y = r.yield ?? 1;
    const turns = r.turnsCost ?? 0;
    const rate = rateAt(a.skillPoints);
    const wage = turns > 0 ? rate * turns ** 1.3 : r.perTurn ? rate / r.perTurn : 0;
    let inputs = 0;
    for (const raw of r.items ?? []) {
      const one = (slug) => (get(slug)?.craftable ? 1 : INPUT_PREMIUM) * inputPrice(slug);
      if (typeof raw === "string") inputs += one(raw);
      else if (raw.anyOf) inputs += Math.min(...raw.anyOf.map((o) => one(typeof o === "string" ? o : o.tag)));
      else if (raw.tag) inputs += (raw.count ?? 1) * one(raw.tag);
    }
    const expected = (Math.round(wage) + IMPORT_PRICE * (r.resourceCost ?? 0) + inputs) / y;
    return { name: a.name, slug: a.slug, got: t.sellablePrice, expected: Math.round(expected) };
  };
  const workedRows = activities.filter((a) => inScope(a) && hasItemInput(a) && !HELD_BACK.has(a.slug) && !BARS.has(a.slug)).map(workedInput);
  const offWorked = workedRows.filter((r) => Math.abs(r.got - r.expected) > 1);
  const cooking = buildCooking({ get, list, rv, params, sources, foodFloor, players });
  const trinkets = buildTrinkets({ get, list, rv, rvMined, producerDrops, profitTiers, moveValue: moveValueUsed });
  const lucky = buildLucky({ get, rv, caving, trinkets, moveValue: moveValueUsed, gameTurns });
  const tiersRise = profitTiers.every((t, i) => i === 0 || t.median >= profitTiers[i - 1].median);
  const red = byId("craft:ravenheart-red");
  const potato = byId("farm:potato");
  const claims = [
    {
      doc: "DEPOT.md §3",
      claim: "The Depot imports ⬢ at 3 ¢ and buys them back at 1 ¢ (RESOURCE_IMPORT_PRICE, RESOURCE_EXPORT_PRICE)",
      docValue: "3 in / 1 out",
      model: `${rv.buy} in / ${rv.sell} out`,
      ok: rv.buy === 3 && rv.sell === 1,
    },
    {
      doc: "db/lib/depot.js",
      claim: "The `resources` tag's own depotPrice and sellablePrice match the two constants (\"change both together or they drift\")",
      docValue: `${rv.buy} in / ${rv.sell} out`,
      model: `${resourceTagCopy.buy} in / ${resourceTagCopy.sell} out`,
      ok: resourceTagCopy.buy === rv.buy && resourceTagCopy.sell === rv.sell,
      note: "The counter prices ⬢ off the constants, so a drifted tag copy misprices anything valued AGAINST ⬢ (the sync's buy/sell check, for one).",
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
      claim: "Every Depot-sold smithing, crafting and brewing recipe that works no input earns its skill tier's profit per Move (1 / 2 / 4 / 5 / 6 at 2 / 5 / 10 / 15 / 19 points) with ⬢ bought at the Depot",
      docValue: `${profitRows.length} recipes on the table`,
      model: offRate.length ? `${offRate.length} off it: ${offRate.slice(0, 5).map((r) => `${r.name} ${round1(r.got)} against ${r.rate}`).join(", ")}${offRate.length > 5 ? ", …" : ""}` : `${profitRows.length} on it`,
      ok: offRate.length === 0,
      note: "Slack is 2 ¢ a Move, half the rate, or a craft and a half of profit, whichever is widest. The Pickaxe and the Autoinjector are held back: the shelf prices they are fitted to leave no whole-⬢ recipe that lands on the rung.",
    },
    {
      doc: "DEPOT.md §4",
      claim: "More skill points never pay less: the median profit per Move rises with each tier",
      docValue: "rising",
      model: profitTiers.map((t) => `${t.points} pts: ${round1(t.median)}`).join(", "),
      ok: tiersRise,
    },
    {
      doc: "DEPOT.md §4",
      claim: "A recipe that works an input sells for its wage, its ⬢ at 3 ¢, and nearly twice a raw input's sell price (once a crafted input's)",
      docValue: `${workedRows.length} recipes on the formula`,
      model: offWorked.length ? `${offWorked.length} off it: ${offWorked.slice(0, 5).map((r) => `${r.name} ${r.got} against ${r.expected}`).join(", ")}${offWorked.length > 5 ? ", …" : ""}` : `${workedRows.length} on it`,
      ok: offWorked.length === 0,
      note: "Brews and gear made from cave finds, organs, silver or another craft. They deviate from the wage table on purpose, by up to 0.9 times the raw input. The Autoinjector keeps its shelf price, and the Iron, Copper and Nickel bars are priced by the scarcity of their ore, so the claim leaves them out.",
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
      claim: "A Prospector at the Caves makes about 21 ¢ a turn with the ⬢ valued at the Depot's 3 ¢ buy price",
      docValue: 21,
      model: round1(byId("mine:Caves:skilled")?.netPerTurnBuy),
      ok: Math.abs(byId("mine:Caves:skilled").netPerTurnBuy - 21) < 1,
    },
    {
      doc: "DEPOT.md §4",
      claim: "A recipe is paid in ⬢ and nothing else: no craft family can be paid in obols (CRAFTING.md, 2026-09-20)",
      docValue: "none",
      model: obolFamilies.length ? `${obolFamilies.join(", ")} can` : "none",
      ok: obolFamilies.length === 0,
      note: "Read from crafting.js. If a family is listed, the obol payment is back and the smithing figures need the par column again.",
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
      claim: "Moonshine brews in a quarter turn, the same as Alcohol",
      docValue: 0.25,
      model: get("moonshine")?.requirement?.turnsCost,
      ok: get("moonshine")?.requirement?.turnsCost === 0.25,
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
      claim: "A farmer makes about 13 ¢ a turn, a Prospector at the Caves about 8 (⬢ sold back at 1 ¢)",
      docValue: "13 / 8",
      model: `${round1(potato?.netPerTurnSell)} / ${round1(byId("mine:Caves:skilled")?.netPerTurnSell)}`,
      ok: potato && Math.abs(potato.netPerTurnSell - 13) < 1 && Math.abs(byId("mine:Caves:skilled").netPerTurnSell - 8) < 0.6,
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
      claim: "Hunger decays 35 a turn and Hungry starts at 35, exactly one turn's decay",
      docValue: "35 / 35",
      model: `${hunger.HUNGER_DECAY_PER_TURN} / ${hunger.HUNGRY_THRESHOLD}`,
      ok: hunger.HUNGER_DECAY_PER_TURN === 35 && hunger.HUNGRY_THRESHOLD === 35,
    },
    {
      doc: "TURN-ENGINE.md §5",
      claim: "Every food sits in one of three tiers against a turn's decay: raw about a third (6-18 of 35), basic cooked one turn (30-42), skilled about a turn and a half (46-56)",
      docValue: "none outside",
      model: foodTiers.offTier.length ? `${foodTiers.offTier.length} outside: ${foodTiers.offTier.slice(0, 6).map((f) => `${f.name} ${f.hunger}`).join(", ")}${foodTiers.offTier.length > 6 ? ", …" : ""}` : "none outside",
      ok: foodTiers.offTier.length === 0,
    },
    {
      doc: "TURN-ENGINE.md §5",
      claim: "Every food has a hunger figure of its own; none rides on the flat default",
      docValue: "0 defaulted",
      model: foodTiers.defaulted.length ? `${foodTiers.defaulted.length} defaulted to ${hunger.DEFAULT_FOOD_HUNGER}: ${foodTiers.defaulted.slice(0, 6).map((f) => f.name).join(", ")}${foodTiers.defaulted.length > 6 ? ", …" : ""}` : "0 defaulted",
      ok: foodTiers.defaulted.length === 0,
    },
    {
      doc: "tags.yaml, Ration Box",
      claim: "One Ration Box a turn does not quite feed a person: it averages under a turn's decay but over half of it",
      docValue: "between 0.5 and 1 turn",
      model: foodTiers.boxTurns == null ? "no Ration Box on the general shelf" : `${Math.round(foodFloor.anyone.hunger * 10) / 10} of ${params.hungerDecay} (${Math.round(foodTiers.boxTurns * 100) / 100} turn)`,
      ok: foodTiers.boxTurns != null && foodTiers.boxTurns < 1 && foodTiers.boxTurns > 0.5,
    },
    {
      doc: "COOKING.md §2a",
      claim: "Every cooking recipe can be made: each fixed base input has a way into the game",
      docValue: "0 dishes stuck",
      model: cooking.unreachableDishes.length ? `${cooking.unreachableDishes.length} stuck: ${cooking.unreachableDishes.map((d) => `${d.name} (${d.unreachable.join(", ")})`).join("; ")}` : "0 dishes stuck",
      ok: cooking.unreachableDishes.length === 0,
      note: "An input with no data route and no reference in the code cannot be got, so every recipe that needs it is unmakeable today.",
    },
    {
      doc: "COOKING.md §3",
      claim: "The rat the caves drop is the rat the recipes take",
      docValue: "same tag",
      model: cooking.ratGap.caveRatSlug !== cooking.ratGap.recipeRatSlug ? `caves drop ${cooking.ratGap.caveRatSlug}; ${cooking.ratGap.dishes.join(", ")} take ${cooking.ratGap.recipeRatSlug}, which nothing produces` : `one tag, ${cooking.ratGap.caveRatSlug}`,
      ok: cooking.ratGap.caveRatSlug === cooking.ratGap.recipeRatSlug,
    },
    {
      doc: "TRINKETS.md §1",
      claim: "The tier table (Awful 1 ×0.5 up to Masterwork 27 ×2) is the one in trinketPass.js",
      docValue: "6 tiers",
      model: trinkets.checks.tiersMatchDoc ? "match" : "the code's TIERS differ from the doc's table",
      ok: trinkets.checks.tiersMatchDoc,
    },
    {
      doc: "TRINKETS.md §3",
      claim: "Every stone's inlay is 2 × its sell price + 4, held one under the Merchant's price where he stocks it",
      docValue: "0 off the rule",
      model: trinkets.checks.offRule.length ? trinkets.checks.offRule.map((x) => `${x.name} ${x.inlay}, rule says ${x.expected}`).join("; ") : "0 off the rule",
      ok: trinkets.checks.offRule.length === 0,
      note: "Silver's shelf price went from 14 to 19 on 2026-09-20 and its inlay was not raised with it. Raising it to 18 makes forging silver pay more, so it was left for a decision.",
    },
    {
      doc: "TRINKETS.md §3",
      claim: "No stone inlays for as much as the Merchant charges for it",
      docValue: "0 stones",
      model: trinkets.checks.overShelf.length ? trinkets.checks.overShelf.map((x) => x.name).join(", ") : "0 stones",
      ok: trinkets.checks.overShelf.length === 0,
    },
    {
      doc: "TRINKETS.md §3",
      claim: "Forging stones bought off the shelf earns no more per Move than the top rung of the wage table",
      docValue: `${trinkets.shelfLoop.topWage} ¢ a Move`,
      model: `${round1(trinkets.shelfLoop.bestApprentice?.apprentice)} ¢ for a Smithing smith, ${round1(trinkets.shelfLoop.bestSkilled?.skilled)} ¢ for Smithing II (${(trinkets.shelfLoop.bestSkilled?.stones ?? []).join(" + ")})`,
      ok: (trinkets.shelfLoop.bestSkilled?.skilled ?? 0) <= trinkets.shelfLoop.topWage && (trinkets.shelfLoop.bestApprentice?.apprentice ?? 0) <= trinkets.shelfLoop.topWage,
      note: "The doc's cap stops one stone converting into a dearer Trinket, but a Trinket also adds its own tier price, and a multiplier above 1, so a round trip through the Merchant pays whatever the cap says.",
    },
    {
      doc: "tags.yaml, Lucky",
      claim: "Lucky's description names only dice that exist: it says the Caving Die and the laboring die",
      docValue: "2 dice named",
      model: /laboring/i.test(get("lucky")?.description ?? "") ? "there is no laboring die: mining rolls no die (db/lib/mining.js), so it names 1 that exists" : "names only real dice",
      ok: !/laboring/i.test(get("lucky")?.description ?? ""),
      note: "Mining pays a flat range and a table draw now, and nothing in db/lib/advantage.js is called from it.",
    },
    {
      doc: "CAVING.md §2",
      claim: "Every place that rolls with advantage is known to this report, so a new die cannot go unnoticed",
      docValue: "0 unlabelled",
      model: caving.rolls.unlabelled.length ? `${caving.rolls.unlabelled.length}: ${caving.rolls.unlabelled.join(", ")}` : "0 unlabelled",
      ok: caving.rolls.unlabelled.length === 0,
    },
    {
      doc: "DEPOT.md §4",
      claim: "Buying a metal at the shelf and cracking it for ⬢ never pays: the shelf price is at least the ⬢ it gives back at the 1 ¢ sell-back",
      docValue: "0 that pay",
      model: (() => {
        const bad = list.filter((t) => t.consumesIntoResources && t.depotPrice != null && t.depotPrice < t.consumesIntoResources * rv.sell);
        return bad.length ? bad.map((t) => `${t.name} ${t.depotPrice} ¢ for ${t.consumesIntoResources} ⬢`).join(", ") : "0 that pay";
      })(),
      ok: list.every((t) => !(t.consumesIntoResources && t.depotPrice != null) || t.depotPrice >= t.consumesIntoResources * rv.sell),
      note: "An unlimited coin loop if it ever fails. Iron's shelf price was cut to 3 for a few hours on 2026-09-20 and this is what caught it.",
    },
    {
      doc: "DEPOT.md §4",
      claim: "The Depot pays a metal at least what cracking it for ⬢ is worth at the sell-back, so a bar is never worth more cracked than sold",
      docValue: "0 below",
      model: (() => {
        const bad = list.filter((t) => t.consumesIntoResources && t.sellablePrice != null && t.sellablePrice < t.consumesIntoResources * rv.sell);
        return bad.length ? bad.map((t) => `${t.name} sells ${t.sellablePrice}, cracks for ${t.consumesIntoResources}`).join("; ") : "0 below";
      })(),
      ok: list.every((t) => !(t.consumesIntoResources && t.sellablePrice != null) || t.sellablePrice >= t.consumesIntoResources * rv.sell),
      note: "Iron, Copper and Nickel fail by design: their sell price follows the input-premium formula, and cracking them pays more. Nobody sells a bar to the counter.",
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

  const investments = buildInvestments({
    caving,
    trinkets,
    lucky,
    get,
    list,
    rv,
    rvMined,
    params,
    activities,
    producerDrops,
    profitTiers,
    pointsOf: (slug) => skillChain(slug).points,
    moveValue: moveValueUsed,
    gameTurns,
  });
  const desires = buildDesires({
    get,
    list,
    rv,
    rvMined,
    moveValue: moveValueUsed,
    gameTurns,
    slots: schemaDefault("desireSlots"),
    lockTurns: schemaDefault("desireSlotLockTurns"),
    cookingDishes: cooking.dishes,
    investments,
    startingPoints: startingTagPoints,
  });
  claims.push(
    {
      doc: "desires.yaml, cooldown policy",
      claim: "A Desire that costs nothing per attempt is on the inverted ladder (5 / 4 / 3 turns at tiers 1 / 2 / 3), except consumables",
      docValue: "0 off the ladder",
      model: (() => {
        const ladder = { 1: 5, 2: 4, 3: 3 };
        const off = desires.satisfiers.filter((r) => r.open && !r.once && !r.consumable && !r.variance && r.netCoin <= 0 && ladder[r.tier] != null && r.cooldown < ladder[r.tier]);
        return off.length ? off.map((r) => `${r.name}: tier ${r.tier}, cooldown ${r.cooldown} against ${ladder[r.tier]}`).join("; ") : "0 off the ladder";
      })(),
      ok: !desires.satisfiers.some((r) => r.open && !r.once && !r.consumable && !r.variance && r.netCoin <= 0 && ({ 1: 5, 2: 4, 3: 3 })[r.tier] != null && r.cooldown < ({ 1: 5, 2: 4, 3: 3 })[r.tier]),
      note: "Holding 100 ¢ is the case: the coin is only tied up, never spent, so the wording of the policy (a goal that costs nothing but cooperation takes the ladder) says it belongs there.",
    }
  );

  return {
    params,
    assumptions: ASSUMPTIONS,
    activities,
    wages,
    priceLadder,
    priceRule,
    resourceBalance,
    foodFloor,
    foodTiers,
    profitTiers,
    profitRows,
    workedRows,
    investments,
    caving,
    trinkets,
    cooking,
    lucky,
    desires,
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
