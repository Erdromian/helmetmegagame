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
const cavingLoot = require("../../../lib/cavingLoot");
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
    key: "MINING_DUTY",
    value: 0.5,
    why: "A day's mining steps Tired -> Exhausted and Exhausted refuses the next day, so flat-out mining works every other turn (MINING.md §5). Derivable from db/lib/fatigue.js; kept as a stated number.",
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

function withSeededRandom(seed, fn) {
  const real = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
function buildModel({ players = 100 } = {}) {
  const { list, bySlug } = loadCatalog();
  const get = (slug) => bySlug.get(slug);

  const resources = get("resources");
  const rv = { sell: resources.sellablePrice ?? 1, buy: resources.depotPrice ?? 2 };
  const productionCoefficient = schemaDefault("productionCoefficient");
  const farmMaxCrops = schemaDefault("farmMaxCrops");
  const startingTagPoints = schemaDefault("startingTagPoints");
  const miningCoeffs = loadMiningCoefficients();

  const params = {
    players,
    rv,
    productionCoefficient,
    farmMaxCrops,
    startingTagPoints,
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

  // Cumulative point cost of a skill and everything it hangs off.
  function skillChain(slug) {
    const seen = new Set();
    let pts = 0;
    let root = slug;
    for (let s = slug; s && !seen.has(s); ) {
      seen.add(s);
      const t = get(s);
      if (!t) break;
      pts += t.pointCost ?? 0;
      root = s;
      s = t.parentTag ?? null;
    }
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
    activities.push(a);
  };

  // --- crafts --------------------------------------------------------------
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

    const per = (rvPrice) => revenue - itemCost - resCost * rvPrice;
    let perTurnSell = null;
    let perTurnBuy = null;
    if (turnsCost > 0) {
      perTurnSell = per(rv.sell) / turnsCost;
      perTurnBuy = per(rv.buy) / turnsCost;
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
      revenue,
      inputs: itemCost + resCost * rv.sell,
      inputsBuy: itemCost + resCost * rv.buy,
      resourceCost: resCost,
      resourcesPerTurn: turnsCost > 0 ? resCost / turnsCost : r.perTurn != null ? resCost * r.perTurn : null,
      duty: 1,
      netPerTurnSell: perTurnSell,
      netPerTurnBuy: perTurnBuy,
      flags,
    });
  }

  // --- mining --------------------------------------------------------------
  // Loot table: draw the REAL function under a seeded PRNG rather than
  // re-deriving its weights, so a retuned table moves the number.
  const lootEv = (zoneKey) =>
    withSeededRandom(20260920, () => {
      const N = 200000;
      let sum = 0;
      let hits = 0;
      for (let i = 0; i < N; i++) {
        const d = cavingLoot.drawProspectingLoot(zoneKey);
        if (!d) continue;
        hits++;
        sum += get(d.slug)?.sellablePrice ?? 0;
      }
      return { ev: sum / N, hitRate: hits / N };
    });

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
        const flags = ["payout lands at the press", "Lifeweb failure not modelled"];
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
          duty: assumptions.MINING_DUTY,
          resourcesPerPress: resources,
          lootEv: loot.ev,
          netPerTurnSell: (resources * rv.sell + loot.ev) * assumptions.MINING_DUTY,
          netPerTurnBuy: (resources * rv.buy + loot.ev) * assumptions.MINING_DUTY,
          flags,
        });
      }
    }
  }

  // --- farming -------------------------------------------------------------
  const exhausted = get("exhausted");
  const tired = get("tired");
  const farmCycle = 1 + (exhausted?.durationTurns ?? 1) + (tired?.durationTurns ?? 1);
  params.farmCycle = farmCycle;
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
      duty: 1 / farmCycle,
      harvest,
      netPerTurnSell: ((revenue - seedCost) * 1) / farmCycle,
      netPerTurnBuy: ((revenue - seedCost) * 1) / farmCycle,
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
    duty: 1,
    netPerTurnSell: shift,
    netPerTurnBuy: shift,
    flags: ["someone else pays the cutting risk"],
  });
  const soloRate = shift * Math.min(1, bare.godflesh);
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
    duty: Math.min(1, bare.godflesh),
    cutGodflesh: bare.godflesh,
    injuryChance: bare.injuryChance,
    netPerTurnSell: soloRate,
    netPerTurnBuy: soloRate,
    flags: [
      `the cut costs no Move (misc.js extractGodfleshRequestImpl)`,
      `${(bare.injuryChance * 100).toFixed(0)}% a cut goes wrong; bare hands`,
      `carry cap not modelled`,
    ],
  });
  params.cut = { bare, saw };

  // --- wages: the benchmarks the price ladder is measured against ----------
  const byId = (id) => activities.find((a) => a.id === id);
  const smithing = activities.filter(
    (a) => a.family === "smithing" && a.moves > 0 && a.netPerTurnSell != null,
  );
  const median = (xs) => {
    const s = [...xs].sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  };
  const wages = [
    { key: "Unskilled miner (Caves)", value: byId("mine:Caves:unskilled")?.netPerTurnSell },
    { key: "Prospector (Caves)", value: byId("mine:Caves:skilled")?.netPerTurnSell },
    { key: "Farmer (potato, sold)", value: byId("farm:potato")?.netPerTurnSell },
    { key: "Factory solo", value: byId("factory:solo")?.netPerTurnSell },
    { key: "Smith (median rung)", value: median(smithing.map((a) => a.netPerTurnSell)) },
  ].filter((w) => w.value != null && w.value > 0);

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
      };
    })
    .filter((r) => r.recipes > 0)
    .sort((a, b) => b.medianBurn - a.medianBurn);
  params.minerResourcesPerTurn = minerPerTurn;

  // --- tools -------------------------------------------------------------------
  const tools = list
    .filter((t) => t.miningBonus?.amount)
    .map((t) => {
      const price = t.depotPrice ?? t.sellablePrice ?? null;
      const perTurn = t.miningBonus.amount * rv.sell * assumptions.MINING_DUTY;
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
    },
    {
      doc: "FACTORY.md §6",
      claim: "Cut, walk and refine every turn: a solo Factory worker makes 40 ¢ a turn",
      docValue: 40,
      model: round1(soloRate),
      ok: Math.abs(soloRate - 40) < 0.5,
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
      claim: "A Farm action nets about 79 ¢ (potato, after the seed bag)",
      docValue: 79,
      model: potato ? round1(potato.revenue - potato.inputs) : null,
      ok: potato && Math.abs(potato.revenue - potato.inputs - 79) < 1,
    },
    {
      doc: "FACTORY.md §6",
      claim: "A farmer makes about 26 ¢ a turn, a Prospector at the Caves about 5",
      docValue: "26 / 5",
      model: `${round1(potato?.netPerTurnSell)} / ${round1(byId("mine:Caves:skilled")?.netPerTurnSell)}`,
      ok: potato && Math.abs(potato.netPerTurnSell - 26) < 1 && Math.abs(byId("mine:Caves:skilled").netPerTurnSell - 5) < 0.6,
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
