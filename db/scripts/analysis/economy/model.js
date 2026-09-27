// The economic model behind `npm run economy:report`.
//
// Everything here is DERIVED. The catalog (docs/tags.yaml), the map
// (docs/zones.yaml), the schema defaults and the rules modules in db/lib are
// read at run time, so a price change or a retuned constant shows up the next
// time the report is generated — there is no second copy of any number to fall
// behind. The one exception is assumptionsFor() below: things the game does that no
// file states as a number. Each is named, sourced and printed in the report so
// a reader can see what the model is leaning on.
//
// Pure and Prisma-free. Reads files, never a database.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { entriesOf } = require("../../../lib/yamlEntries");
const mining = require("../../../lib/mining");
const cavingLoot = require("../../../lib/cavingLoot");
const { DISTILLING_DOUBLES_SLUGS, BREWING_DISTILLING_SLUG, FOODSTUFFS_SLUG } = require("../../../lib/constants");
const { GATHERING_ZONE_SLUGS } = require("../../../lib/gathering");
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
const { buildEquipment } = require("./equipment");
const { buildArmor } = require("./armor");
const { buildCaving } = require("./caving");
const { buildTrinkets } = require("./trinkets");
const { buildCooking } = require("./cooking");
const { buildDesires } = require("./desires");
const { buildStarting } = require("./starting");
const { buildPower } = require("./power");
const { buildLucky } = require("./lucky");
const { makeFoodValue } = require("./foodValue");
const { median } = require("./stats");
const { taxOn } = require("../../../lib/trainDeparturePass");
const { buildSellTax } = require("./sellTax");
const { buildMiningRisk } = require("./miningRisk");
const { buildCombat, priceKits } = require("./combat");
const { buildTransport } = require("./transport");
const { buildTravel } = require("./travel");
const { buildMedical } = require("./medical");
const { buildSecrets } = require("./secrets");
const mounts = require("../../../lib/mounts");
const { turretTable } = require("../../../lib/depotTurret");

const REPO = path.resolve(__dirname, "../../../..");
const readYaml = (rel) => yaml.load(fs.readFileSync(path.join(REPO, rel), "utf8"));

// ---------------------------------------------------------------------------
// What the model assumes but the repo does not state as a number.
// ---------------------------------------------------------------------------
// Built per run, since the ⬢ line quotes the Depot's two prices and the midpoint a mined ⬢ is valued at.
function assumptionsFor({ rv, rvMined, minedValue, resourceValue, sellTaxRate, turnLengthHours, turnsPerDay, hungerDecay }) {
  return [
    {
      key: "MOVES_PER_TURN",
      value: 1,
      why: "A turn gives one Move; a recipe's turnsCost is a fraction of it (TAGS.md, Move economy).",
    },
    {
      key: "TURN_LENGTH",
      value: turnsPerDay >= 1 ? `${turnsPerDay} turns an in-game day` : `${turnLengthHours} hours a turn`,
      why: `A Turn's turnLengthHours is a live per-game setting (6, 8, 12 or 24), and GameConfig.turnsPerDay can roll the in-game day every N turns instead; this report has no game to read either from, so it takes the schema defaults (a ${schemaDefault("turnLengthHours")}-hour turn, turnsPerDay ${schemaDefault("turnsPerDay")}) unless --turn-hours N or --turns-per-day N says otherwise. Hunger decays a flat ${hunger.HUNGER_DECAY_PER_DAY} a day (${hunger.HUNGER_DECAY_PER_DAY_FAST} with Big Appetite), split across the turns in a day (db/lib/hunger.js#perTurnDecay: truncated by hours, rounded up by turnsPerDay), so this run's turn burns ${hungerDecay}.`,
    },
    {
      key: "SELL_TAX",
      value: `${sellTaxRate}% of the gross of every counter sale`,
      why: "Depot.sellTaxRate, a whole percent the Meister sets from /treasury; this run takes it from --sell-tax, else the schema default. It comes off the gross of each settled drop-box sale (trainDeparturePass.js#taxOn), never off profit, and touches nothing that is not sold at the counter: not a Depot purchase, a trade between players, food eaten, or ⬢ bartered. Every craft figure is shown before tax (raw) and at this rate (net).",
    },
    {
      key: "CRAFT_DUTY",
      value: 1,
      why: "Nothing rations crafting beyond the Move itself, except a recipe's own perTurn (read from the catalog).",
    },
    {
      key: "RESOURCE_VALUE",
      value: `a ⬢ spent at ${resourceValue === "sell" ? rv.sell : rv.buy} ¢, a ⬢ mined at ${rvMined} ¢`,
      why: `One obol is one ⬢ (ECONOMY.md §1), but a ⬢ is worth ${rv.sell} ¢ if you sell it to the Depot and ${rv.buy} ¢ if you must buy it there. A ⬢ a crafter spends is valued at the ${resourceValue === "sell" ? "sell-back" : "buy price"}; a ⬢ a Prospector brings up at the ${minedValue === "mid" ? `midpoint, ${rv.mid} ¢,` : minedValue === "buy" ? "buy price" : "sell-back"} which is what it should barter for. The full table shows every activity with ⬢ at both ends.`,
    },
    {
      key: "ITEM_VALUE",
      value: "a food input: sellablePrice, else the lower of depotPrice and its food worth at the Ration Box's rate; anything else: depotPrice, else sellablePrice, else 0 (flagged)",
      why: "What a recipe input costs its maker (foodValue.js#inputCost). A food is priced the way the cooking tab prices it: what the counter pays for it, else what the same hunger and mood cost from a Ration Box, never more than the Depot asks for it. Anything else is what a maker pays at the shelf, and failing that what it would fetch at the counter.",
    },
  ];
}

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

// The cave levels: the levels of a `kind: group` zone (docs/zones.yaml), which the game runs as CAVE_LEVEL zones,
// where the Caving Die rolls on every arrival and the mood pass reads the place as a cave.
function loadCaveLevels() {
  const doc = readYaml("docs/zones.yaml");
  return Object.values(doc.zones).filter((z) => z.kind === "group").flatMap((z) => Object.keys(z.levels ?? {}));
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
// DEPOT.md §3: the counter buys back at 60% of the shelf price, rounded. The pricing check holds the catalog
// to it and the Caving Die estimates an unsellable find with it.
const SELL_BACK_SHARE = 0.6;

function buildModel({ players = 100, gameTurns = 30, freeMoves = null, resourceValue = "buy", minedValue = "mid", obolPath = "auto", moveValue = null, moodWeight = 1.5, pointValue = null, sellTax = null, turnHours = null, turnsPerDay = null } = {}) {
  const { list, bySlug } = loadCatalog();
  // A Turn's turnLengthHours and GameConfig.turnsPerDay are live game settings this report has no game to
  // read, so both default to the schema's (a 24-hour turn, and 0: the day rolls by the clock). --turn-hours
  // tries another length (6, 8 or 12); --turns-per-day N rolls the day every N turns, which is what
  // decides the hunger a turn burns once it is set (db/lib/hunger.js#perTurnDecay).
  const turnLengthHours = turnHours ?? schemaDefault("turnLengthHours");
  const turnsPerDaySetting = turnsPerDay ?? schemaDefault("turnsPerDay");
  const get = (slug) => bySlug.get(slug);
  const sources = buildSources({ list, bySlug, players });
  // How often each day-verb can be pressed, played out with the game's own gates.
  const fatigue = fatigueModel({ bySlug, gameTurns });
  // The share of turns each tiring verb can be pressed, played out on the game's own ladder. Every
  // "every other turn" in the report is one of these, so read them rather than type a half.
  const mineDuty = fatigue.byId.mine.steady;
  const farmDuty = fatigue.byId.farm.steady;
  const refineDuty = fatigue.byId.refine.steady;
  const farmCycle = Math.round(1 / farmDuty);

  const resources = get("resources");
  // The Depot's ⬢ prices are the CONSTANTS in db/lib/depot.js: the depot page and its order action build
  // the ⬢ row from them and never read the `resources` tag, whose own prices are "decorative for this
  // surface" (that file says so). So the valuations read the constants, and a claim below checks the tag's
  // copy still agrees.
  const rv = { sell: depotRules.RESOURCE_EXPORT_PRICE, buy: depotRules.RESOURCE_IMPORT_PRICE };
  const resourceTagCopy = { sell: resources.sellablePrice ?? null, buy: resources.depotPrice ?? null };
  // Every counter sale is taxed at Depot.sellTaxRate, a whole percent the Meister sets (default 0), taken off the
  // gross of each settled sale before the seller is paid (db/lib/trainDeparturePass.js#taxOn). `--sell-tax N` tries
  // another rate. `tax(gross)` is the game's own rounding, used on every figure that meets the counter.
  const sellTaxRate = sellTax ?? schemaDefault("sellTaxRate");
  if (!Number.isInteger(sellTaxRate) || sellTaxRate < 0 || sellTaxRate > 100) throw new Error("sellTax must be a whole number from 0 to 100");
  const tax = (gross) => (gross > 0 ? taxOn(gross, sellTaxRate) : 0);
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
    sellTaxRateDefault: schemaDefault("sellTaxRate"),
    // Read by the Caving tab's roll audit, which calls out a die the description names that no longer exists.
    luckyDescription: get("lucky")?.description ?? "",
    // The most ⬢ (or any ware) one Depot order line may carry (db/lib/depot.js, the order action's clamp).
    depotMaxQuantity: depotRules.DEPOT_MAX_QUANTITY,
    rvMain,
    rvMined,
    minedValue,
    obolFamilies,
    obolPath,
    resourceValue,
    moodWeight,
    productionCoefficient,
    farmMaxCrops,
    stableCapacity,
    startingTagPoints,
    carryWeightLbs: schemaDefault("carryWeightLbs"),
    squeezeLbs: (() => {
      const w = get("squeeze")?.weight;
      if (w == null) throw new Error("economy model: the squeeze tag has no weight in docs/tags.yaml");
      return w;
    })(),
    turnLengthHours,
    turnsPerDay: turnsPerDaySetting,
    // The doc's rate is a day, 17 (24 with Big Appetite); a turn burns perTurnDecay(perDay, turnLengthHours),
    // truncated (db/lib/hunger.js). At the default 24-hour turn that is the day figure whole.
    hungerDecayPerDay: hunger.HUNGER_DECAY_PER_DAY,
    hungerDecayPerDayFast: hunger.HUNGER_DECAY_PER_DAY_FAST,
    hungerDecay: hunger.perTurnDecay(hunger.HUNGER_DECAY_PER_DAY, turnLengthHours, turnsPerDaySetting),
    hungerDecayFast: hunger.perTurnDecay(hunger.HUNGER_DECAY_PER_DAY_FAST, turnLengthHours, turnsPerDaySetting),
    hungerMax: hunger.HUNGER_MAX,
    hungryThreshold: hunger.HUNGRY_THRESHOLD,
    starvingThreshold: hunger.STARVING_THRESHOLD,
    foodstuffHunger: hunger.FOODSTUFF_HUNGER,
    witherIn: soilery.WITHER_IN,
    bountyIn: soilery.BOUNTY_IN,
    farmPlants: soilery.FARM_PLANTS,
    refineryYield: refinery.REFINERY_YIELD,
    mineDuty,
    farmDuty,
    refineDuty,
    farmCycle,
    gameTurns,
    sellBackShare: SELL_BACK_SHARE,
    caveLevels: loadCaveLevels(),
    freeZoneMoves: schemaDefault("freeZoneMovesPerTurn"),
  };

  // --- food: what eating a thing restores, and what food is worth -------------
  // One Farm action plants FARM_PLANTS crops; each survivor (5 in soilery.WITHER_IN) is 1 Foodstuff
  // (db/lib/soilery.js#reapFoodstuffs). These are the EXPECTED counts the die averages to over many
  // farms — a real harvest varies turn to turn. Fertilizer removes the wither die entirely and 1 crop in
  // soilery.BOUNTY_IN comes up double, so every fertilized crop yields at least 1.
  const STAPLE = FOODSTUFFS_SLUG;
  params.stapleCrop = STAPLE;
  // One Foodstuff per surviving crop; kept so callers that used to scale by a plant's crop count still work.
  params.cropsPerPlant = 1;
  params.harvestPerFarm = farmMaxCrops * (1 - 1 / soilery.WITHER_IN);
  params.harvestPerFarmFert = farmMaxCrops * (1 + 1 / soilery.BOUNTY_IN);

  // What eating one of a thing restores, the way the game reckons it (db/lib/hunger.js#foodHungerFor):
  // a dish's own hunger, an ingredient's, or nothing. Anything that OPENS into food is averaged over its
  // outcomes: the Ration Box is one of six equally likely draws (four foods, a rat that half the time
  // makes you sick, and nothing).
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
        const inner = eaten(o, [...seen, slug]);
        hungerSum += share * inner.hunger;
        moodSum += share * inner.mood;
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
    const opens = (t.consumesInto ?? []).some((x) => typeof x !== "string" && x.oneOf);
    foods.push({
      slug: t.slug,
      name: t.name,
      kind: opens && hunger.foodHungerFor(t) === 0 ? "box" : t.craftable && t.requirement?.turnsCost != null && t.mealHunger != null ? "dish" : "foodstuff",
      hunger: Math.round(e.hunger * 100) / 100,
      // A raw ingredient (a cooked block, not a dish) is eaten raw here, so it carries the raw-eating penalty
      // (db/lib/hunger.js#rawFoodMoodTerms), as the cooking tab's raw diets do.
      mood: Math.round((e.mood + (t.cooked && t.mealHunger == null && hunger.foodHungerFor(t) > 0 ? hunger.RAW_FOOD_MOOD : 0)) * 10) / 10,
      weight: t.weight ?? 0,
      buy: t.depotPrice ?? null,
      sell: t.sellablePrice ?? null,
      shelf,
      source: shelf === "general" ? "Depot, general shelf" : shelf ? `Depot, ${shelf} shelf` : "not sold at the Depot",
      moves: t.requirement?.turnsCost ?? null,
      perPersonTurn: params.hungerDecay / e.hunger, // units that feed one person for one turn
      lbPerPersonTurn: (t.weight ?? 0) * (params.hungerDecay / e.hunger),
    });
  }
  // What food costs somebody who just has coin: the cheapest thing anyone can order, and the cheapest on any
  // shelf. Only what a shelf sells can be bought, so these read the Depot's price.
  const onShelf = foods.filter((f) => f.shelf).sort((a, b) => a.buy * a.perPersonTurn - b.buy * b.perPersonTurn);
  const floorRow = (f) => (f ? { ...f, cost: f.buy, basis: "buy", costPerPersonTurn: f.buy * f.perPersonTurn } : null);
  const foodFloor = {
    anyone: floorRow(onShelf.find((f) => f.shelf === "general")),
    anyShelf: floorRow(onShelf[0]),
  };
  // The one food valuation (foodValue.js), anchored on the box. Every crop, ingredient and dish in the report is
  // priced through it, so the farmer's wage, a dish's cost and the Food tab cannot disagree.
  const food = makeFoodValue({ box: foodFloor.anyone, moodWeight });
  foodFloor.perHunger = food.perHunger;
  foodFloor.perPoint = food.perPoint;
  for (const f of foods) {
    // What each food is worth, by the one rule. A dish is worth its own hunger and mood at the box's rate, since
    // what the counter pays for one is a floor, not what it is worth to an eater.
    const t = get(f.slug);
    const dish = f.kind === "dish";
    f.cost = dish ? food.asFood(t.mealHunger, t.mealMood ?? 0) : food.of(t);
    f.basis = dish ? "dish" : food.basisOf(t);
    f.costPerPersonTurn = f.cost * f.perPersonTurn;
  }
  foods.sort((a, b) => a.costPerPersonTurn - b.costPerPersonTurn);
  params.cropValue = food.of(get(STAPLE));
  params.cropsSell = get(STAPLE)?.sellablePrice != null;
  // The Box's own draws are priced as a set (a spread around, not up to, a turn), so the tier check leaves them out.
  const boxTag = get(foodFloor.anyone?.slug);
  const boxDraws = (boxTag?.consumesInto ?? [])
    .flatMap((x) => (typeof x === "string" ? [x] : x.oneOf ? x.oneOf : [x.slug]))
    .map((o) => (typeof o === "string" ? o : o?.slug))
    .filter((o) => o && o !== "nothing");
  foodFloor.draws = boxDraws.length;
  foodFloor.outcomes = boxDraws.length + ((boxTag?.consumesInto ?? []).some((x) => typeof x !== "string" && x.oneOf?.includes("nothing")) ? 1 : 0);
  // How much of a turn's decay a food covers, for the Food page's table. The old three-tier banding
  // (raw about a third of a turn, basic one turn, skilled about two) belonged to the 36 named recipes
  // and does not survive the rework: a meal class is now 15-20 hunger against a Foodstuff's 4, all
  // within about a turn of each other, so there is no wide band left to sort them into.
  for (const f of foods) f.turnsOfFood = f.hunger / params.hungerDecay;
  const foodTiers = {
    boxTurns: foodFloor.anyone ? foodFloor.anyone.hunger / params.hungerDecay : null,
  };


  // --- pricing helpers -----------------------------------------------------
  // What a recipe input costs its maker: the ITEM_VALUE rule (foodValue.js#inputCost). A tag with no price and no
  // food in it counts nothing, and says so.
  function unitValue(slug, flags) {
    if (slug === "resources") return null; // valued per scenario by the caller
    const t = get(slug);
    if (!t) {
      flags.push(`unknown ingredient ${slug}`);
      return 0;
    }
    const v = food.inputCost(t);
    const basis = food.inputBasisOf(t);
    if (basis === "none" || v === 0) flags.push(`unpriced input: ${slug}`);
    else if (basis === "food") flags.push(`${t.name} valued as food, at the Ration Box's rate`);
    return v;
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
  for (const t of list) {
    // The two drinks Distilling doubles sell to players, not the counter: Alcohol has a Black Market shelf
    // price and no sellablePrice. It is priced at the shelf price as a CEILING and flagged, so the rung can
    // be seen; a ceiling row never joins the wage-rung claims, the easy-craft baselines or the planner.
    const ceiling = t.sellablePrice == null && DISTILLING_DOUBLES_SLUGS.has(t.slug) && t.depotPrice != null;
    if (!t.craftable || !t.requirement || (t.sellablePrice == null && !ceiling)) continue;
    // A dish is not priced by its sale: the counter pays only a coin or so for one, so its worth is what it feeds. cooking.js
    // prices every one of them by hunger and mood at the Ration Box's rate, and those rows join the
    // activities after buildCooking below. Pricing them here too, at the counter's 2–4 ¢ less the
    // ingredients, is how the activity tabs showed an Omelette at −160 ¢ a turn while the cooking
    // tab showed it feeding a table at a profit.
    if (t.mealHunger != null && (t.requirement.skills ?? []).some((s) => /^cooking/.test(s))) continue;
    const r = t.requirement;
    // Distilling doubles the stack of the two drinks it names, for the same ingredients, ⬢ and Move
    // (web/app/(app)/character/actions/crafting.js, DISTILLING_DOUBLES_SLUGS): a second row for each, at
    // the whole chain's points (Brewing II plus the 3-point tag), so the rung shows on the tables the way
    // the game plays it.
    const variants = DISTILLING_DOUBLES_SLUGS.has(t.slug) && get(BREWING_DISTILLING_SLUG) ? [false, true] : [false];
    for (const distilled of variants) {
    const flags = [];
    if (ceiling) flags.push(`no counter sale: valued at the Black Market's ${t.depotPrice} ¢ shelf price, a ceiling — it sells to players, not the counter, so no sell tax either`);
    if (distilled) flags.push("Distilling: twice the stack from the same mash");
    // Who is shown the recipe at all, off the sourcing model's two flags (the Secret recipes tab).
    if (recBySlug.get(t.slug)?.secretRecipe) flags.push("Secret: the product is not in the main catalogue, so no ordinary player is shown this recipe");
    if (recBySlug.get(t.slug)?.hiddenUntilHeld) flags.push("Hidden: off the Craft menu until you hold a gated ingredient");
    const yieldN = (r.yield ?? 1) * (distilled ? 2 : 1);
    const itemCost = itemsValue(r.items, flags);
    const resCost = r.resourceCost ?? 0;
    const revenue = (t.sellablePrice ?? t.depotPrice) * yieldN;
    const turnsCost = r.turnsCost ?? 0;
    const skillSlugs = distilled ? [...(r.skills ?? []), BREWING_DISTILLING_SLUG] : r.skills ?? [];
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
    // The sell tax comes off the gross of the sale, a press's whole output sold as one stack; a ceiling row is
    // sold to players and pays none.
    const saleTax = ceiling ? 0 : tax(revenue);
    const netOf = (rvPrice) => per(rvPrice) - saleTax;
    let perTurnSell = null;
    let perTurnBuy = null;
    let perTurnMid = null;
    let rawTurnSell = null;
    let rawTurnBuy = null;
    if (turnsCost > 0) {
      rawTurnSell = per(rv.sell) / totalMoves;
      rawTurnBuy = per(rv.buy) / totalMoves;
      perTurnSell = netOf(rv.sell) / totalMoves;
      perTurnBuy = netOf(rv.buy) / totalMoves;
      perTurnMid = netOf(rv.mid) / totalMoves;
    } else if (r.perTurn != null) {
      rawTurnSell = per(rv.sell) * r.perTurn;
      rawTurnBuy = per(rv.buy) * r.perTurn;
      perTurnSell = netOf(rv.sell) * r.perTurn;
      perTurnBuy = netOf(rv.buy) * r.perTurn;
      perTurnMid = netOf(rv.mid) * r.perTurn;
      flags.push(`free action, capped at ${r.perTurn}/turn`);
      flags.push("past the ration the game lets it spill into the Move (craftBudget.js), so this figure is a floor");
    } else {
      flags.push("free action, uncapped");
    }
    push({
      id: `craft:${t.slug}${distilled ? ":distilled" : ""}`,
      name: `${t.name}${distilled ? " (Distilling)" : ""}`,
      slug: t.slug,
      distilled,
      ceiling,
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
      // At the run's sell tax; the raw figures are before it.
      netPerTurnSell: perTurnSell,
      netPerTurnBuy: perTurnBuy,
      // ⬢ bought from a Prospector at the midpoint instead of imported.
      netPerTurnMid: perTurnMid,
      rawPerTurnSell: rawTurnSell,
      rawPerTurnBuy: rawTurnBuy,
      sellTax: saleTax,
      perAction: netOf(resourceValue === "sell" ? rv.sell : rv.buy),
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
  // Built here so the wage list, the planner and the ladders can all see it; the top wage rung and the Move value
  // it does not need yet are filled in below.
  const trinkets = buildTrinkets({ get, list, rv, rvMined, producerDrops, profitTiers: [], moveValue: null, tax });

  // --- Trinkets: a whole Move, 4 ⬢, up to two stones and a d6 (TRINKETS.md) ------------------------
  // Priced at the run's sell tax like every craft. Own stones are not here: they come out of a Mine press and
  // are folded into the mining rows and the planner, since a stone is an ore's worth of a press.
  {
    const smithingPts = skillChain("smithing").points;
    const skilledPts = skillChain("smithing-skilled").points;
    const holders = [
      { id: "apprentice", skill: "smithing", points: smithingPts, label: "Smithing", best: trinkets.shelfLoop.bestApprenticeWithStones },
      { id: "skilled", skill: "smithing-skilled", points: skilledPts, label: "Smithing II", best: trinkets.shelfLoop.bestSkilledWithStones },
    ];
    for (const h of holders) {
      for (const kind of ["none", "shelf"]) {
        const set = kind === "shelf" ? h.best : { stones: [], inlay: 0, stoneCost: 0 };
        if (!set) continue;
        const net = trinkets.expectedProfit(h.id, set.inlay, set.stoneCost, true);
        const raw = trinkets.expectedProfit(h.id, set.inlay, set.stoneCost, false);
        push({
          id: `trinket:${kind}:${h.id}`,
          name: kind === "shelf" ? `Forge a Trinket — ${set.stones.join(" + ")} off the shelf` : "Forge a Trinket — no stones",
          slug: `trinket-${kind}-${h.id}`,
          kind: "craft",
          family: "smithing",
          craftFamily: "smithing",
          skill: h.skill,
          skillPoints: h.points,
          moves: 1,
          totalMoves: 1,
          revenue: null,
          inputs: trinkets.dieCost + set.stoneCost,
          inputsBuy: trinkets.dieCost + set.stoneCost,
          resourceCost: trinkets.gate.resources,
          duty: 1,
          netPerTurnSell: net,
          netPerTurnBuy: net,
          rawPerTurnBuy: raw,
          rawPerTurnSell: raw,
          sellTax: raw - net,
          perAction: net,
          easy: kind === "none",
          workshop: true,
          copy: false,
          madeAtHome: [],
          parPayable: false,
          netPerTurnObols: null,
          oreNeeds: [],
          trinket: true,
          needsText: kind === "shelf" ? `${set.stones.join(" + ")} (a Merchant's licence)` : "nothing",
          flags: ["a d6 sets the tier; expected over the tiers the die can give", ...(kind === "shelf" ? ["stones bought at the shelf"] : [])],
        });
      }
    }
  }

  const lootEv = (zoneKey, skilled) => ({ ev: evOf(producerDrops.prospecting[zoneKey][skilled ? "skilled" : "plain"]) });

  // The gate is a held Pickaxe; Prospecting multiplies both the ⬢ (x1.7) and the loot column
  // (docs/systemdocs/MINING.md §1). The pickaxe's own +1 counts, on the reading that anybody who
  // holds one wears it. `mining.computeRate` is the game's own arithmetic, rounding and all.
  const pickaxe = get("pickaxe");
  const pickBonus = pickaxe?.miningBonus?.amount ?? 0;
  params.pickaxe = { price: pickaxe?.depotPrice ?? null, points: pickaxe?.pointCost ?? 0, bonus: pickBonus };
  params.skillPoints = { soilery: get("soilery")?.pointCost ?? 0, prospecting: get("prospecting")?.pointCost ?? 0, fertilizer: get("fertilizer")?.pointCost ?? 0 };
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
        zone: s.zone,
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
        // The drops are sold at the counter and pay the sell tax; ⬢ only pay it when they are sold back too.
        sellTax: tax(loot.ev),
        perAction: resources * rvMined + loot.ev - (minedValue === "sell" ? tax(resources * rv.sell + loot.ev) : tax(loot.ev)),
        baseNetPerTurn: resources * rvMined * mineDuty,
        rawPerTurn: (resources * rvMined + loot.ev) * mineDuty,
        rawPerTurnBuy: (resources * rv.buy + loot.ev) * mineDuty,
        netPerTurn: (resources * rvMined + loot.ev - (minedValue === "sell" ? tax(resources * rv.sell + loot.ev) : tax(loot.ev))) * mineDuty,
        netPerTurnSell: (resources * rv.sell + loot.ev - tax(resources * rv.sell + loot.ev)) * mineDuty,
        netPerTurnMid: (resources * rv.mid + loot.ev - tax(loot.ev)) * mineDuty,
        netPerTurnBuy: (resources * rv.buy + loot.ev - tax(loot.ev)) * mineDuty,
        flags,
      });
    }
  }

  // --- farming -------------------------------------------------------------
  // One button, one crop: Soilery plants FARM_PLANTS crops and reaps Foodstuffs (db/lib/soilery.js).
  // No seed bag (nothing is spent to sow), no field pool or yield falloff, and nothing else to grow —
  // tobacco, the seed-bag/sowing-licence chain and the field-productivity model are all gone with the
  // rework. A farm row is built plain and fertilized, so the report can show both without doubling the code.
  const soileryTag = get("soilery");
  const fertTag = get("fertilizer");
  const foodstuffsTag = get(FOODSTUFFS_SLUG);
  const farmRows = [];
  const farmRow = (fertilized) => {
    const harvest = fertilized ? params.harvestPerFarmFert : params.harvestPerFarm;
    const flags = [`fatigue: one farm every ${farmCycle} turns (a Farm action grants Exhausted outright)`];
    const basis = food.basisOf(foodstuffsTag);
    if (basis === "food") flags.push("Foodstuffs do not sell: valued as food, at the Ration Box's rate for hunger and mood");
    else if (basis === "buy") flags.push(`Foodstuffs do not sell: valued at the Depot's ${foodstuffsTag.depotPrice} ¢ shelf price`);
    if (fertilized) flags.push(`Fertilizer: no wither die, a double crop 1 time in ${soilery.BOUNTY_IN}`);
    const inputs = fertilized ? fertTag?.depotPrice ?? 0 : 0;
    const revenue = harvest * food.of(foodstuffsTag);
    farmRows.push({ crop: FOODSTUFFS_SLUG, fertilized, harvest, revenue, seedCost: inputs, hunger: hunger.foodHungerFor(foodstuffsTag), weight: foodstuffsTag.weight ?? 0 });
    push({
      id: fertilized ? "farm:foodstuffs-fert" : `farm:${FOODSTUFFS_SLUG}`,
      name: fertilized ? "Farm — Foodstuffs, with Fertilizer" : `Farm — ${foodstuffsTag.name}`,
      kind: "farm",
      family: "farming",
      skill: "soilery",
      skillPoints: soileryTag.pointCost + (fertilized ? fertTag?.pointCost ?? 0 : 0),
      moves: 1,
      revenue,
      inputs,
      inputsBuy: inputs,
      duty: farmDuty,
      harvest,
      fert: fertilized,
      // Foodstuffs never sell to the counter, so "food" is the only basis this ever takes.
      valueBasis: basis,
      foodValued: basis !== "sell",
      // Foodstuffs eaten raw, a harvest's worth a turn (the by-family food chart plots these). Foodstuffs
      // carries its own mealMood for raw eating, not the generic raw-ingredient penalty (db/lib/hunger.js).
      hungerPerTurn: harvest * hunger.foodHungerFor(foodstuffsTag) * farmDuty,
      moodPerTurn: harvest * (foodstuffsTag.mealMood ?? 0) * farmDuty,
      // Nothing here ever meets the counter: food is eaten, not sold.
      sellTax: 0,
      rawPerTurn: (revenue - inputs) * farmDuty,
      perAction: revenue - inputs,
      netPerTurnSell: (revenue - inputs) * farmDuty,
      netPerTurnBuy: (revenue - inputs) * farmDuty,
      flags,
    });
  };
  farmRow(false);
  if (fertTag) farmRow(true);

  // --- gathering (MINING.md §3c) -------------------------------------------
  // The Black Hills' press is the Mine button under another name: the same 6–12 × the dials × the
  // place, the same Tired/Exhausted ladder, no pickaxe wanted, and a draw on the gathering table
  // (food, in small stacks) instead of the prospecting one. Every number is read from the game's own
  // tables and the map, so a retuned column or coefficient moves it. The finds go through the same food
  // valuation as the farmer's crops, so the gatherer and the farmer sit on one yardstick.
  for (const zone of GATHERING_ZONE_SLUGS.filter((z) => cavingLoot.GATHERING_WEIGHTS_BY_ZONE[z])) {
    const coeffs = miningLocations.filter((l) => l.zone === zone).map((l) => l.coeff).sort((x, y) => x - y);
    if (!coeffs.length) continue;
    const coeff = coeffs[Math.floor(coeffs.length / 2)];
    const zoneName = zone === "hills" ? "Black Hills" : zone[0].toUpperCase() + zone.slice(1);
    const range = mining.computeRate(productionCoefficient, coeff, false);
    const resources = (range.min + range.max) / 2;
    const weights = cavingLoot.GATHERING_WEIGHTS_BY_ZONE[zone];
    let findsValue = 0;
    let findsSold = 0; // the part of the finds the counter buys, which is what pays the sell tax
    let findsHunger = 0;
    for (const [tier, w] of Object.entries(weights)) {
      const entries = cavingLoot.GATHERING_TABLE[tier] ?? [];
      for (const e of entries) {
        const slug = typeof e === "string" ? e : e.slug;
        const qty = typeof e === "string" ? 1 : e.quantity ?? 1;
        findsValue += (w / entries.length) * qty * food.of(get(slug));
        if (food.basisOf(get(slug)) === "sell") findsSold += (w / entries.length) * qty * food.of(get(slug));
        findsHunger += (w / entries.length) * qty * hunger.foodHungerFor(get(slug));
      }
    }
    push({
      id: `gather:${zoneName}`,
      name: `Gather — ${zoneName}, no tool`,
      kind: "gather",
      family: "mining",
      zone,
      skill: "—",
      skillPoints: 0,
      moves: 1,
      revenue: null,
      inputs: 0,
      inputsBuy: 0,
      duty: mineDuty,
      resourcesPerPress: resources,
      lootEv: findsValue,
      dropsPerAction: findsValue,
      findsHunger,
      findsSold,
      coefficient: coeff,
      sellTax: tax(findsSold),
      perAction: resources * rvMined + findsValue - (minedValue === "sell" ? tax(resources * rv.sell + findsSold) : tax(findsSold)),
      baseNetPerTurn: resources * rvMined * mineDuty,
      rawPerTurn: (resources * rvMined + findsValue) * mineDuty,
      netPerTurn: (resources * rvMined + findsValue - (minedValue === "sell" ? tax(resources * rv.sell + findsSold) : tax(findsSold))) * mineDuty,
      netPerTurnSell: (resources * rv.sell + findsValue - tax(resources * rv.sell + findsSold)) * mineDuty,
      netPerTurnMid: (resources * rv.mid + findsValue - tax(findsSold)) * mineDuty,
      netPerTurnBuy: (resources * rv.buy + findsValue - tax(findsSold)) * mineDuty,
      flags: [
        "no tool needed",
        `coefficient ${coeff}, the median of the zone's ${coeffs.length} places (${coeffs[0]}–${coeffs[coeffs.length - 1]})`,
        "a worn pickaxe's +1 ⬢ and Prospecting's ×1.7 on the ⬢ not counted",
        "finds valued as the farmer's crops are: at a market price where they have one, else at the Ration Box's rate for hunger and mood",
        "payout lands at the press",
        "Lifeweb failure not modelled",
      ],
    });
  }

  // --- the Factory ---------------------------------------------------------
  const squeeze = get(refinery.REFINERY_OUTPUT_SLUG);
  const cubeValue = squeeze.sellablePrice ?? 0;
  const shift = refinery.REFINERY_YIELD * cubeValue;
  // A Factory worker and a farmer climb the same ladder, so what they earn is compared a turn to a turn.
  const factoryPerTurn = shift * refineDuty;
  // The cubes are sold at the counter, so a shift pays the sell tax on its gross.
  const shiftNet = shift - tax(shift);
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
  params.refinerySeats = refinery.REFINERY_MAX_WORKERS;
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
    sellTax: tax(shift),
    rawPerTurn: shift * refineDuty,
    perAction: shiftNet,
    netPerTurnSell: shiftNet * refineDuty,
    netPerTurnBuy: shiftNet * refineDuty,
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
    sellTax: tax(shift),
    rawPerTurn: soloRate,
    perAction: shiftNet,
    netPerTurnSell: shiftNet * Math.min(refineDuty, bare.godflesh),
    netPerTurnBuy: shiftNet * Math.min(refineDuty, bare.godflesh),
    flags: [
      `the cut costs no Move (misc.js extractGodfleshRequestImpl)`,
      `${(bare.injuryChance * 100).toFixed(0)}% a cut goes wrong; bare hands`,
      `only ${refinery.REFINERY_MAX_WORKERS} people may refine in a turn`,
      `carry cap not modelled`,
    ],
  });

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
    ["needs a body", `Human Flesh feeds (${hunger.foodHungerFor(get("human-flesh"))} hunger) but cannot be sold`, "does not free the soul"],
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

  const byId = (id) => activities.find((a) => a.id === id);

  // --- the cooks --------------------------------------------------
  // How many farmers feed the town, cooked, is cooking.js's own figure now: hunger a turn eaten against
  // the cooked hunger a Farm action brings in, with no field pool or refill to it any more.
  // A dish fetches only a coin or so at the counter, so a cook is paid in food: what the same hunger and mood would cost from a
  // Ration Box, less the ingredients, both through the one food valuation.
  const cooking = buildCooking({
    get,
    list,
    params,
    sources,
    foodFloor,
    food,
    players,
  });

  // The dishes as activities, priced the one way cooking.js prices them: what the same hunger and
  // mood would cost from a Ration Box, less the ingredients at what they sell for (or feed for,
  // where they do not sell). The craft loop above skips dishes, so this is the only valuation of a
  // dish on any tab.
  for (const d of cooking.dishes) {
    const r = get(d.slug)?.requirement ?? {};
    let points = 0;
    for (const sk of r.skills ?? []) points = Math.max(points, skillChain(sk).points);
    const perTurn = d.marginPerMove ?? (d.margin != null && d.moves > 0 ? d.margin / d.moves : null);
    // cooking.js works per dish; a press of the recipe makes `yield` of them, so the per-action figures scale up.
    const y = d.yield;
    push({
      id: `craft:${d.slug}`,
      name: d.name,
      slug: d.slug,
      kind: "craft",
      family: "cooking",
      skill: d.skill || "—",
      skillPoints: points,
      moves: r.turnsCost ?? 0,
      totalMoves: d.moves * y,
      revenue: d.value * y,
      inputs: d.cost * y,
      inputsBuy: d.cost * y,
      resourceCost: 0,
      resourcesPerTurn: 0,
      duty: 1,
      netPerTurnSell: perTurn,
      netPerTurnBuy: perTurn,
      netPerTurnMid: perTurn,
      rawPerTurnSell: perTurn,
      rawPerTurnBuy: perTurn,
      sellTax: 0,
      perAction: d.margin == null ? null : d.margin * y,
      // Valued as food, not coin (a ceiling at Ration Box parity), and what a full turn of it feeds.
      foodValued: true,
      hungerPerTurn: d.moves > 0 ? d.hunger / d.moves : null,
      moodPerTurn: d.moves > 0 ? d.mood / d.moves : null,
      easy: recBySlug.get(d.slug)?.easy ?? false,
      workshop: false,
      copy: false,
      madeAtHome: [],
      craftFamily: "cooking",
      parPayable: false,
      netPerTurnObols: null,
      oreNeeds: [],
      flags: [
        `valued as food: ${d.hunger} hunger and ${d.mood} mood at the Ration Box's rate, since the counter pays only ${d.sell ?? 0} ¢ for it`,
        ...(d.unreachable.length ? [`no known source for ${d.unreachable.join(", ")}`] : []),
      ],
    });
  }

  // --- wages: the benchmarks the price ladder is measured against ----------

  // The easy-craft baselines. A crafter BUYS ⬢ at the Depot (${rv.buy} ¢), so
  // these are ranked with ⬢ at the buy price. "Easy" means every input is on
  // the general shelf, farmed, or extremely common (sources.js), and the recipe
  // can be worked without an ore supply of a dozen Prospectors behind it.
  // A dish's worth is Ration Box parity with no cap on demand, a ceiling rather than a wage, so it does not
  // compete for a Move here; the cooks have their own shortlist below.
  // A ceiling-priced drink (sold to players, not the counter) is not a baseline anybody can bank on.
  const crafts = activities.filter((a) => a.kind === "craft" && a.family !== "cooking" && !a.copy && !a.ceiling && a.netPerTurnBuy != null && a.totalMoves > 0);
  const oreLimited = (a) => (a.oreNeeds ?? []).some((o) => o.prospectors > 2);
  // "Easy" is judged from a standing start, so a recipe no ordinary player is shown does not count: a secret
  // one (the product is off the main catalogue) or one hidden until a gated ingredient is held. The full table and
  // the Secret recipes tab still carry them; they just cannot be a baseline.
  const shown = (a) => !recBySlug.get(a.slug)?.secretRecipe && !recBySlug.get(a.slug)?.hiddenUntilHeld;
  const easyCrafts = crafts.filter((a) => a.easy && shown(a));
  const shortlist = (pred) => easyCrafts.filter(pred).sort((x, y) => y.netPerTurnBuy - x.netPerTurnBuy || x.skillPoints - y.skillPoints);
  const isCrafting = (a) => a.skill.split(", ").includes("crafting");
  const smithFam = (a) => a.family === "smithing" || isCrafting(a);
  const shortlists = {
    smithing: shortlist((a) => a.family === "smithing" && !isCrafting(a)),
    crafting: shortlist(isCrafting),
    brewing: shortlist((a) => a.family === "brewing"),
    noWorkshop: shortlist((a) => smithFam(a) && !a.workshop),
    // The cooks' shortlist is cooking.js's dishes, ranked by what a person-turn of food costs in ingredients.
    cooking: cooking.dishes
      .filter((d) => recBySlug.get(d.slug)?.easy)
      .map((d) => {
        const personTurns = d.hunger / params.hungerDecay;
        return {
          slug: d.slug,
          name: d.name,
          skill: d.skill,
          skillPoints: byId(`craft:${d.slug}`)?.skillPoints ?? 0,
          moves: d.moves,
          hunger: d.hunger,
          mood: d.mood,
          ingredients: d.inputs,
          costPerDish: d.cost,
          costPerPersonTurn: personTurns > 0 ? d.cost / personTurns : null,
          dishesPerMove: d.moves > 0 ? 1 / d.moves : null,
          personTurnsPerMove: d.moves > 0 ? personTurns / d.moves : null,
          easy: true,
        };
      })
      .sort((x, y) => (x.costPerPersonTurn ?? 1e9) - (y.costPerPersonTurn ?? 1e9) || y.mood - x.mood),
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
    // The same recipe with its ⬢ bought from a Prospector at the midpoint rather than imported.
    valueMid: b.act.netPerTurnMid ?? null,
    skillPoints: b.act.skillPoints,
  }));
  const cheapestMeal = shortlists.cooking.find((c) => c.costPerPersonTurn != null);
  const wages = [
    { key: "Miner, pickaxe only (Caves)", value: byId("mine:Caves:unskilled")?.netPerTurn },
    { key: "Prospector (Caves)", value: byId("mine:Caves:skilled")?.netPerTurn },
    { key: "Gatherer (Black Hills, no tool)", value: byId("gather:Black Hills")?.netPerTurn },
    ...baselines.map((b) => ({ key: b.key, value: b.value, valueMid: b.valueMid, baseline: true })),
    // The drinks Distilling doubles, plain and distilled, at the Black Market's shelf price: ceilings, since
    // they sell to players and never to the counter, drawn apart from the wages and kept off the price ladder.
    ...activities
      .filter((a) => a.kind === "craft" && a.ceiling)
      .sort((x, y) => Number(x.distilled) - Number(y.distilled) || x.name.localeCompare(y.name))
      .map((a) => ({
        key: `${a.distilled ? "Distilling brewer" : "Brewer"}: ${a.name.replace(/ \(Distilling\)$/, "")}, sold to players at the shelf price`,
        value: a.netPerTurnBuy,
        ceiling: true,
      })),
    { key: "Farmer, food (valued at the Ration Box)", value: byId(`farm:${STAPLE}`)?.netPerTurn },
    { key: "Farmer, food + Fertilizer (valued at the Ration Box)", value: byId("farm:foodstuffs-fert")?.netPerTurn },
    { key: "Smith forging Trinkets (Smithing II, shelf stones)", value: byId("trinket:shelf:skilled")?.netPerTurn },
    {
      key: "Miner-smith forging own stones (Caves, pick only)",
      value: (byId("mine:Caves:unskilled")?.netPerTurn ?? 0) + (trinkets.prospector["caves:plain"]?.apprentice?.net ?? 0) * mineDuty,
    },
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
    trinkets,
  });

  // --- pricing-rule consistency ----------------------------------------------
  // The three wares DEPOT.md §3 gives a wage floor instead of the 60% sell-back: each is craftable, so its
  // sellablePrice is what a maker earns under §4, not what a reseller gets back. Still checked for arbitrage.
  const WAGE_FLOOR = new Set(["trapping-gear", "gladiator-helmet", "workshop-equipment"]);
  const priceRule = list
    .filter((t) => t.depotPrice != null && t.sellablePrice != null && t.slug !== "resources")
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      buy: t.depotPrice,
      sell: t.sellablePrice,
      ratio: t.sellablePrice / t.depotPrice,
      expected: Math.max(1, Math.round(t.depotPrice * SELL_BACK_SHARE)),
      craftable: !!t.craftable,
      wageFloor: WAGE_FLOOR.has(t.slug),
    }))
    .map((r) => ({ ...r, off: r.sell - r.expected, arbitrage: r.sell >= r.buy }));

  // Supply against demand: how many farmers does a town need? The plain (unfertilized) harvest only —
  // Fertilizer's own gain is the investments tab's row, not a second crop to list here.
  const demandPerTurn = players * params.hungerDecay;
  const foodSupply = farmRows.filter((f) => !f.fertilized).map((f) => {
    const hungerPerFarmTurn = f.harvest * f.hunger * farmDuty;
    return {
      crop: f.crop,
      name: get(f.crop)?.name ?? f.crop,
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
  // Cooking is left out: no dish takes ⬢.
  const resourceBalance = [...new Set(activities.filter((a) => a.kind === "craft" && a.family !== "cooking").map((a) => a.family))]
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

  // --- transport: what is hard to carry (transport.js) -----------------------------
  let travel = null;
  const transport = buildTransport({ get, list, params, combos, activities, resourceBalance, producerDrops, schemaDefault });
  {
    const sq = transport.squeezeFlow;
    for (const a of activities.filter((x) => x.kind === "refine")) {
      a.flags.push(`carry: ${round1(sq.lbs)} lb a shift against a ${transport.base} lb cap (${round1(sq.cratedLbs ?? sq.lbs)} crated): see Transport`);
    }
    // The selling trip, charged to every loadout at the game's free travel and again with an equipped fresh
    // arelitz's rides (db/lib/mounts.js: each ride covers one crossing, town or far), whatever --free-moves set the
    // main planner to.
    const freeBase = schemaDefault("freeZoneMovesPerTurn");
    const mountBonus = mounts.fastTravelBonus(new Set(["arelitz"]));
    const plannerAt = (free, rides = 0) => (free === combos.free && rides === (combos.rides ?? 0) ? combos : buildCombos({ activities, fatigue, bySlug, params, gameTurns, free, rides, seats: refinery.REFINERY_MAX_WORKERS, trinkets }));
    const atBase = plannerAt(freeBase);
    const atMount = plannerAt(freeBase, mountBonus);
    travel = {
      base: buildTravel({ combos: atBase, params, transport, free: freeBase }),
      mount: buildTravel({ combos: atMount, params, transport, free: freeBase }),
      mountBonus,
      mountName: get("arelitz")?.name ?? "arelitz",
    };
    const bare = transport.carryLimited.find((r) => r.key === "bare");
    if (bare && bare.perTurn > 0) wages.push({ key: "Factory solo, carry-limited (bare, uncrated)", value: bare.perTurn });
  }

  // --- the price ladder ------------------------------------------------------
  const priceLadder = list
    .filter((t) => t.depotPrice != null && t.slug !== "resources")
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      price: t.depotPrice,
      sellBack: t.sellablePrice ?? null,
      manifest: t.manifest ?? "merchant",
      turns: Object.fromEntries(wages.filter((w) => !w.ceiling).map((w) => [w.key, t.depotPrice / w.value])),
    }))
    .sort((a, b) => a.price - b.price);


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

  const cookingRecipeCount = list.filter(
    (t) => t.craftable && t.requirement?.skills?.some((sk) => /^cooking/.test(sk)),
  ).length;

  // --- what the docs say, against what this says --------------------------------
  const moveValueUsed = moveValue ?? activities.find((a) => a.id === "mine:Caves:unskilled")?.netPerTurn ?? 5;
  // A point of mood is worth moodWeight points of hunger at the Ration Box's ¢ a point: the price of every mood hit.
  params.moodIntensity = schemaDefault("moodIntensity");
  params.moodPointPrice = food.perPoint * moodWeight;
  const caving = buildCaving({ get, list, rv, rvMined, sources, moveValue: moveValueUsed, activities, gameTurns, sellBackShare: SELL_BACK_SHARE, moodIntensity: params.moodIntensity, moodPointPrice: params.moodPointPrice });
  // What the counter's wage table pays a maker per Move, by the cumulative skill points the recipe is gated
  // behind, with every ⬢ bought at the Depot's import price (DEPOT.md §4). Prices are set from this table:
  // sell = inputs at the Depot's price + import price × ⬢ + round(rate × turns^1.3). Read here as the
  // intent the catalog is checked against, so a new recipe priced off the old ⬢-at-1 arithmetic shows up.
  const IMPORT_PRICE = rv.buy;
  const PROFIT_RATE_BY_POINTS = { 0: 2, 2: 2, 5: 4, 10: 8, 15: 12, 19: 15 };
  const rateAt = (pts) => PROFIT_RATE_BY_POINTS[Object.keys(PROFIT_RATE_BY_POINTS).map(Number).filter((k) => k <= pts).sort((a, b) => b - a)[0]];
  // Depot shelf prices and previous sell prices are left alone, so a recipe is fitted to its price by moving its
  // ⬢ cost instead. Two cannot be fitted that way: the Pickaxe (a quarter-Move craft moves in steps of 4 ¢ a
  // turn) and the Autoinjector (its inputs cost more than its shelf price).
  // The Badge and the Mulligan Potion (a 2 ¢ price, a 17 ¢ shelf), the Trench Knife and the Knuckle Duster (a
  // 6 ¢ and a 3 ¢ shelf) have no whole-⬢ recipe that lands on their rung either; the two weapons take 1 ⬢ of scrap.
  const HELD_BACK = new Set(["pickaxe", "autoinjector", "badge", "mulligan-potion", "trench-knife", "knuckle-duster"]);
  // Bars are the one input-worked recipe priced by scarcity rather than by the formula: the ore cannot be
  // bought, so the ore is the bottleneck and the bar's price is free to be large next to it (Bascinet, 2026-09-20).
  const BARS = new Set(["iron", "copper", "nickel"]);
  const tierFamilies = ["smithing", "crafting", "brewing"];
  const hasItemInput = (a) => (get(a.slug)?.requirement?.items ?? []).length > 0;
  const inScope = (a) => a.kind === "craft" && a.revenue > 0 && tierFamilies.includes(a.craftFamily ?? a.family);
  const profitRows = activities
    .filter((a) => inScope(a) && !hasItemInput(a) && a.netPerTurnBuy != null && !HELD_BACK.has(a.slug) && !a.distilled && !a.ceiling)
    .map((a) => ({ slug: a.slug, name: a.name, family: a.craftFamily ?? a.family, points: a.skillPoints, rate: rateAt(a.skillPoints), got: a.rawPerTurnBuy, net: a.netPerTurnBuy, moves: a.totalMoves }));
  // Distilling is not a rung of DEPOT.md §4's wage table (the drinks it doubles work an input, and one of them
  // never reaches the counter), so its rows sit beside the tiers rather than inside the claim. Each drink is shown
  // against its undistilled twin, per Move, ⬢ at the Depot's price.
  const distilling = activities
    .filter((a) => a.distilled)
    .map((a) => {
      const plain = activities.find((x) => x.id === a.id.replace(/:distilled$/, ""));
      return {
        slug: a.slug,
        name: plain?.name ?? a.name,
        points: a.skillPoints,
        extraPoints: get(BREWING_DISTILLING_SLUG)?.pointCost ?? 0,
        moves: a.totalMoves,
        ceiling: a.ceiling,
        plainRaw: plain?.rawPerTurnBuy ?? null,
        plainNet: plain?.netPerTurnBuy ?? null,
        raw: a.rawPerTurnBuy,
        net: a.netPerTurnBuy,
        gain: plain ? a.netPerTurnBuy - plain.netPerTurnBuy : null,
      };
    })
    .sort((x, y) => (y.gain ?? 0) - (x.gain ?? 0));
  // Prices and ⬢ are whole numbers, so a craft's profit moves in whole ¢: allow 2 ¢ a Move, half the rate, or a
  // craft and a half of slack (a wide 6 ¢ a Move on a quarter-Move piece), whichever is widest.
  const offRate = profitRows.filter((r) => Math.abs(r.got - r.rate) > Math.max(2, 0.5 * r.rate, 1.5 / r.moves));
  for (const r of profitRows) r.onRung = !offRate.includes(r);
  const profitTiers = [...new Set(profitRows.map((r) => r.points))].sort((a, b) => a - b).map((pts) => {
    const rows = profitRows.filter((r) => r.points === pts);
    const got = rows.map((r) => r.got);
    const net = rows.map((r) => r.net);
    return {
      points: pts,
      rate: rateAt(pts),
      n: rows.length,
      min: Math.min(...got),
      max: Math.max(...got),
      median: median(got),
      // At the run's sell tax.
      netMin: Math.min(...net),
      netMax: Math.max(...net),
      netMedian: median(net),
      families: [...new Set(rows.map((r) => r.family))],
    };
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
  for (const r of workedRows) r.onFormula = !offWorked.includes(r);
  trinkets.shelfLoop.topWage = profitTiers.length ? Math.max(...profitTiers.map((t) => t.rate)) : 0;

  trinkets.moveValue = moveValueUsed;
  const lucky = buildLucky({ get, rv, params, caving, trinkets, moveValue: moveValueUsed, gameTurns });
  // What the sell tax does to each business the wage table lists (sellTax.js).
  const sellTaxModel = buildSellTax({ activities, baselines, profitRows, trinkets, params, rv });
  const tiersRise = profitTiers.every((t, i) => i === 0 || t.median >= profitTiers[i - 1].median);
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
      claim: "Every Depot-sold smithing, crafting and brewing recipe that works no input earns its skill tier's profit per Move (2 / 4 / 8 / 12 / 15 at 2 / 5 / 10 / 15 / 19 points, before any sell tax) with ⬢ bought at the Depot",
      docValue: `${profitRows.length} recipes on the table`,
      model: offRate.length ? `${offRate.length} off it: ${offRate.slice(0, 5).map((r) => `${r.name} ${round1(r.got)} against ${r.rate}`).join(", ")}${offRate.length > 5 ? ", …" : ""}` : `${profitRows.length} on it`,
      ok: offRate.length === 0,
      note: "Slack is 2 ¢ a Move, half the rate, or a craft and a half of profit, whichever is widest. The Pickaxe, the Autoinjector, the Badge, the Mulligan Potion, the Trench Knife and the Knuckle Duster are held back: a shelf price or a 2 ¢ sell price leaves no whole-⬢ recipe that lands on the rung.",
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
      model: round1(byId("mine:Caves:skilled")?.rawPerTurnBuy),
      ok: Math.abs(byId("mine:Caves:skilled").rawPerTurnBuy - 21) < 1,
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
      doc: "db/lib/hunger.js",
      claim: "Foodstuffs never sell to the counter: farming is for eating, not cash",
      docValue: "not sold",
      model: foodstuffsTag.sellablePrice != null ? `${foodstuffsTag.sellablePrice} ¢` : "not sold at all",
      ok: foodstuffsTag.sellablePrice == null,
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
      claim: "A cube weighs 17 lb",
      docValue: 17,
      model: squeeze.weight,
      ok: squeeze.weight === 17,
    },
    {
      doc: "db/lib/hunger.js",
      claim: "Hunger decays 17 a day (24 with Big Appetite), Hungry starts at 66 and Starving at 33",
      docValue: "17 / 24 a day, Hungry 66, Starving 33",
      model: `${hunger.HUNGER_DECAY_PER_DAY} / ${hunger.HUNGER_DECAY_PER_DAY_FAST} a day, Hungry ${hunger.HUNGRY_THRESHOLD}, Starving ${hunger.STARVING_THRESHOLD}`,
      ok: hunger.HUNGER_DECAY_PER_DAY === 17 && hunger.HUNGER_DECAY_PER_DAY_FAST === 24 && hunger.HUNGRY_THRESHOLD === 66 && hunger.STARVING_THRESHOLD === 33,
      note: `This run turns that into ${params.hungerDecay} a turn at ${params.turnsPerDay >= 1 ? `${params.turnsPerDay} turns a day (perTurnDecay, rounded up)` : `${turnLengthHours} hours a turn (perTurnDecay, truncated)`}; --turn-hours and --turns-per-day try others.`,
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
      note: "Silver's shelf price went from 14 to 19 on 2026-09-20; its inlay is 18, one under the shelf, as the rule says.",
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
      claim: "The depot cap stops a stone being bought, forged and sold at a profit forever. Read here as: forging shelf stones pays no more a Move than the wage table's top rung, Lucky or not (the report's reading; the doc names no figure)",
      docValue: `${trinkets.shelfLoop.topWage} ¢ a Move`,
      model: (() => {
        const L = trinkets.shelfLoop;
        return `${round1(L.bestApprentice?.apprenticeRaw)} ¢ for a Smithing smith, ${round1(L.bestSkilled?.skilledRaw)} ¢ for Smithing II (${(L.bestSkilled?.stones ?? []).join(" + ")}); with Lucky ${round1(L.bestApprenticeLucky?.["apprentice-luckyRaw"])} and ${round1(L.bestSkilledLucky?.["skilled-luckyRaw"])}; before tax`;
      })(),
      ok: [
        trinkets.shelfLoop.bestApprentice?.apprenticeRaw,
        trinkets.shelfLoop.bestSkilled?.skilledRaw,
        trinkets.shelfLoop.bestApprenticeLucky?.["apprentice-luckyRaw"],
        trinkets.shelfLoop.bestSkilledLucky?.["skilled-luckyRaw"],
      ].every((v) => (v ?? 0) <= trinkets.shelfLoop.topWage),
      note: "The doc's cap stops one stone converting into a dearer Trinket, but a Trinket also adds its own tier price, and a multiplier above 1, so a round trip through the counter pays whatever the cap says. Lucky keeps the better of two dice, which lifts the average multiplier further, and it is one tag anybody may hold.",
    },
    {
      doc: "tags.yaml, Lucky",
      claim: "Lucky's description names no die the game has retired (it used to promise \"the laboring die\")",
      docValue: "no retired die named",
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
      note: "An unlimited coin loop if it ever fails. Iron's shelf price dropped to 3 for a few hours on 2026-09-20 and this is what caught it.",
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
      model: (() => {
        const rows = priceRule.filter((r) => !r.wageFloor);
        const off = rows.filter((r) => Math.abs(r.off) > 1);
        return off.length ? `${rows.length - off.length} of ${rows.length} within ±1 ¢; off: ${off.map((r) => `${r.slug} ${r.buy}→${r.sell} (rule says ${r.expected})`).join(", ")}` : `${rows.length} of ${rows.length} within ±1 ¢`;
      })(),
      ok: priceRule.every((r) => r.wageFloor || Math.abs(r.off) <= 1),
      note: "The three wage-floor wares §3 names are left out. Anything else off the rule is a sell-back that did not follow a shelf-price change; see the pricing table.",
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
      model: round1(mineDuty * 100) / 100,
      ok: Math.abs(mineDuty - 0.5) < 0.01,
    },
    {
      doc: "db/lib/soilery.js, db/lib/fatigue.js#grantExhaustedOutright",
      claim: "A farmer works one turn in three: a Farm action grants Exhausted outright (no Tired rung first), and Exhausted and Tired both refuse the next one",
      docValue: "1 in 3",
      model: `1 in ${round1(1 / farmDuty)}`,
      ok: Math.abs(farmDuty - 1 / 3) < 0.01,
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
      claim: "Unarmoured, the turret's flat dodge is 10%, it wounds 3.6/9/16.2%, and leaves 19.8% dying and 41.4% dead",
      docValue: "10/3.6/9/16.2/19.8/41.4 %",
      model: ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"]
        .map((k) => Math.round(turretTable(null)[k] * 1000) / 10)
        .join("/") + " %",
      ok: ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"].every(
        (k, i) => Math.abs(turretTable(null)[k] - [0.1, 0.036, 0.09, 0.162, 0.198, 0.414][i]) < 0.005,
      ),
      note: "The doc's table is DEFAULT_TURRET_TABLE verbatim, and its kit rows were computed from the same odds bend (ARMOR_GAIN 0.25). Both go stale together if depotTurret.js moves.",
    },
    {
      doc: "db/lib/hunger.js, docs/tags.yaml",
      claim: "Cooking is three meal-class templates now, not a list of named recipes",
      docValue: "3 templates: basic-meal, skilled-meal, lavish-meal",
      model: `${cookingRecipeCount} craftable cooking recipe${cookingRecipeCount === 1 ? "" : "s"}: ${list.filter((t) => t.craftable && t.requirement?.skills?.some((sk) => /^cooking/.test(sk))).map((t) => t.slug).join(", ")}`,
      ok: cookingRecipeCount === 3 && ["basic-meal", "skilled-meal", "lavish-meal"].every((s) => get(s)?.craftable),
    },
    {
      doc: "DEPOT.md §0d",
      claim: "Sealed shipping is 15 named wares",
      docValue: 15,
      model: list.filter((t) => t.sealedShipping).length,
      ok: list.filter((t) => t.sealedShipping).length === 15,
    },
  ];

  // Mining: pay, risk and the walk (miningRisk.js). The mood of being underground also rides on each mine row's flags.
  const miningRisk = buildMiningRisk({ activities, caving, combos, params });
  for (const r of miningRisk.rows) {
    const a = byId(r.id);
    if (a) a.flags.push(`mood ¢ a turn ${r.placeClass === "CAVE" ? "underground" : "in the wild"}: ${round1(r.moodTurn)} (${round1(r.moodTurnImmune)} with ${get(r.immuneTag)?.name ?? r.immuneTag})`);
  }
  // Combat: every fighting tag's band word, and what a band step is worth to a caver under the assumed mix.
  const starting = buildStarting({ list, get, foods, params, foodFloor, sources, players, cooking });
  const combat = buildCombat({ list, get, caving, params, starting, sources });
  const investments = buildInvestments({
    miningRisk,
    combat,
    caving,
    trinkets,
    cooking,
    distilling,
    lucky,
    get,
    list,
    rv,
    rvMined,
    params,
    activities,
    producerDrops,
    profitTiers,
    distilling,
    pointsOf: (slug) => skillChain(slug).points,
    moveValue: moveValueUsed,
    gameTurns,
    food,
    unitValue: (slug) => unitValue(slug, []) ?? 0,
    tax,
  });
  // Every Item and Asset a player can pick at creation, against what it costs or earns in play.
  const equipment = buildEquipment({
    list,
    get,
    sources,
    investments,
    rv,
    moveValue: moveValueUsed,
    gameTurns,
    pointsOf: (slug) => skillChain(slug).points,
    params,
    pointValue,
  });
  // Every wearable piece of armour against the others in its slot: what it stops, for what it costs.
  const armor = buildArmor({ list, get, sources, pointsOf: (slug) => skillChain(slug).points });
  // The armour kits priced in ¢ off the equipment tab's REPLACE lens, both with and without the dominant piece.
  for (const A of [combat.armourKits, combat.armourKitsWithout].filter(Boolean)) priceKits(A, equipment.replaceOf, (slug) => investments.rows.find((r) => r.id === slug)?.gain ?? null);
  // The recipes an ordinary player is never shown, and what each is worth, read off the tabs above.
  const secrets = buildSecrets({ list, get, sources, combat, activities, profitRows, profitTiers, workedRows, shortlists, starting, cooking, params, pointsOf: (slug) => skillChain(slug).points });
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
    foodFloor,
    inputCost: (slug) => unitValue(slug, []) ?? 0,
  });
  const power = buildPower({ starting, rv });
  // Medicine: the ladder, a medic's day, where, what to leave alone, triage and the town's capacity (medical.js).
  const medical = buildMedical({ list, get, params, rv, combos, caving, starting, activities, players, moveValue: moveValueUsed });
  {
    const tagsDoc = fs.readFileSync(path.join(REPO, "docs/systemdocs/TAGS.md"), "utf8");
    const docPool = Number((tagsDoc.match(/MEDICAL_SIMPLE_PER_TURN = (\d+)/) ?? [])[1]);
    const healSrc = fs.readFileSync(path.join(REPO, "web/lib/healRequests.js"), "utf8");
    const siteRule = /function needsSurgicalSite[\s\S]*?skill\.slug === "medical-expert"/.test(healSrc);
    // TAGS.md names its exceptions to "pick a rung" in its own section; those are allowed off the block.
    const named = new Set([...((tagsDoc.match(/### Named exceptions([\s\S]*?)\n### /) ?? [])[1] ?? "").matchAll(/`([a-z-]+)`/g)].map((m) => get(m[1])?.name).filter(Boolean));
    const offBlock = medical.rungs.flatMap((r) => r.offBlock.filter((n) => !named.has(n)).map((n) => `${n} (rung ${r.rung})`));
    const d = medical.dying;
    const docDying = /Dying is off the ladder[\s\S]{0,200}?(\d+) ⬢, no turns, Medical \(Basic\), and an\s+unconditional Gambit/.exec(tagsDoc);
    claims.push(
      { doc: "TAGS.md §5c", claim: "A medic's free pool of 0-turn cures a turn (MEDICAL_SIMPLE_PER_TURN)", docValue: Number.isFinite(docPool) ? docPool : "not stated", model: `${medical.freePool} (web/lib/requests.js)`, ok: docPool === medical.freePool },
      { doc: "TAGS.md §5c", claim: "Every health tag on a rung carries that rung's block", docValue: "0 off the block", model: offBlock.length ? `${offBlock.length} off it: ${offBlock.slice(0, 6).join(", ")}${offBlock.length > 6 ? ", …" : ""}` : "0 off the block", ok: offBlock.length === 0, note: "TAGS.md's named exceptions are allowed off their rung's block and are not counted." },
      { doc: "TAGS.md §5c", claim: "Dying is off the ladder: its rescue is a few ⬢, no turns, Medical I, always a Gambit", docValue: docDying ? `${docDying[1]} ⬢, no turns, Medical I, Gambit` : "not stated", model: d ? `${d.resources} ⬢, ${d.turns} turns, ${d.skill}, ${d.gambit ? "Gambit" : "no Gambit"}` : "no Dying tag", ok: Boolean(d && docDying && d.resources === Number(docDying[1]) && d.turns === 0 && d.gambit) },
      { doc: "TAGS.md §5c", claim: "A cure that needs Medical III needs a surgical site, Dying excepted (healRequests.js#needsSurgicalSite)", docValue: "Medical III needs a site", model: siteRule ? "Medical III needs a site" : "needsSurgicalSite has changed shape; read it", ok: siteRule },
    );
  }
  const auditSrc = fs.readFileSync(path.join(REPO, "db/scripts/ops/audit-vault-backing.js"), "utf8");
  const reserveFloor = Number((/const RESERVE_FLOOR = ([0-9.]+);/.exec(auditSrc) ?? [])[1]);
  if (!Number.isFinite(reserveFloor)) throw new Error("economy model: could not read RESERVE_FLOOR out of db/scripts/ops/audit-vault-backing.js; the file has changed shape.");
  // Field productivity (the pool/refill/yield-falloff model) is gone with the rework: a Farm action's
  // yield no longer depends on how recently the place was worked, so there is nothing left here to check.
  claims.push(
    {
      doc: "roles.yaml, starting_tags",
      claim: "Every starting tag names a tag in the catalog",
      docValue: "0 unresolved",
      model: starting.unresolved.length ? starting.unresolved.join("; ") : "0 unresolved",
      ok: starting.unresolved.length === 0,
    },
    {
      doc: "roles.yaml, starting_account",
      claim: `The Vault holds at least ${Math.round(reserveFloor * 100)}% of what the treasury accounts claim at the start (the audit's floor)`,
      docValue: `${Math.round(reserveFloor * 100)}% or more`,
      model: starting.vault ? `${starting.vault.coin} ¢ against ${starting.treasuryClaims} ¢ of claims at ${players} players, ${Math.round((starting.vault.coin / starting.treasuryClaims) * 100)}%` : "no Vault room",
      ok: Boolean(starting.vault) && starting.vault.coin / starting.treasuryClaims >= reserveFloor,
      note: "Treasury seats are counted at their cap for this many players, and only the named seats. It is a fractional reserve on purpose, so short of parity is normal.",
    },
  );
  // Carrying, read from the rules the transport tab uses.
  {
    const carryDoc = fs.readFileSync(path.join(REPO, "docs/systemdocs/CARRY.md"), "utf8");
    const docCap = Number((carryDoc.match(/The base cap is (\d+) lb/) ?? [])[1]);
    const crateSrc = fs.readFileSync(path.join(REPO, "db/lib/depotCrates.js"), "utf8");
    const halves = /Math\.max\(1, Math\.ceil\(inner \/ 2\)\)/.test(crateSrc);
    // The doc's crop weight, written either as a number of pounds or as a fraction of one.
    const FRACTIONS = { half: 1 / 2, third: 1 / 3, quarter: 1 / 4, fifth: 1 / 5, sixth: 1 / 6 };
    const lbMatch =
      carryDoc.match(/Foodstuff is ([\d.]+) lb/) ?? carryDoc.match(/crop is ([\d.]+) lb/) ?? carryDoc.match(/([\d.]+) lb a crop/);
    const fracMatch = carryDoc.match(/crops at a (half|third|quarter|fifth|sixth) of a\s+pound/);
    const docCrop = lbMatch ? Number(lbMatch[1]) : fracMatch ? FRACTIONS[fracMatch[1]] : null;
    const cropLbs = get(STAPLE)?.weight ?? null;
    claims.push(
      {
        doc: "CARRY.md",
        claim: "The base carry cap is the schema's carryWeightLbs, and nothing can be picked up past HARD_CAP_RATIO times it",
        docValue: Number.isFinite(docCap) ? `${docCap} lb` : "not stated",
        model: `${params.carryWeightLbs} lb, hard cap ×${transport.hardRatio} (db/lib/carry.js)`,
        ok: docCap === params.carryWeightLbs,
      },
      {
        doc: "FACTORY.md §5",
        claim: "A crate weighs half of what went in, rounded up, never under 1 lb (depotCrates.js#crateWeight)",
        docValue: "half, rounded up, floor 1",
        model: halves ? "half, rounded up, floor 1" : "crateWeight has changed shape; read it",
        ok: halves,
      },
      {
        doc: "CARRY.md §1a",
        claim: "A Foodstuff's weight is what the catalog says",
        docValue: docCrop != null ? `${Math.round(docCrop * 100) / 100} lb` : "not stated",
        model: `${cropLbs} lb (docs/tags.yaml, ${get(STAPLE)?.name ?? STAPLE})`,
        ok: docCrop != null && cropLbs != null && Math.abs(docCrop - cropLbs) < 0.01,
      },
    );
  }

  // Three statements in the docs, each read beside the code or data it describes.
  {
    const depotDoc = fs.readFileSync(path.join(REPO, "docs/systemdocs/DEPOT.md"), "utf8");
    const charsDoc = fs.readFileSync(path.join(REPO, "docs/systemdocs/CHARACTERS.md"), "utf8");
    const createSrc = fs.readFileSync(path.join(REPO, "web/app/(app)/character/createActions.js"), "utf8");
    const saysEmpty = /An account opens EMPTY/.test(depotDoc) || /account itself opens EMPTY/.test(charsDoc);
    const seeds = /startingAccountObols/.test(createSrc) && /bumpBankAccount\([^)]*startingAccountObols/.test(createSrc);
    const seededRoles = starting.roles.filter((r) => r.bank > 0);
    // CHARACTERS.md §3 lists who sets extra_starting_points in a parenthetical after the budget line:
    // "(Baron, Heir and Hand +5, Courtier +7, Migrant +3, the Bastard +2, Bum −3; docs/roles.yaml is the
    // list)". Read every "names +N" pair out of it and compare the set with roles.yaml's, so the doc can
    // neither name a role that no longer sets it nor miss one that does.
    const extraParen = (charsDoc.match(/role\.extra_starting_points\s*\(([\s\S]*?)\)/) ?? [])[1] ?? "";
    const docExtra = new Map();
    // "Baron, Heir and Hand +5" is three names sharing one figure: names accumulate until a figure closes them.
    let pending = [];
    for (const seg of extraParen.replace(/\s+/g, " ").split(/[;,]/)) {
      const m = seg.trim().match(/^(.*?)\s*(?:([+−-])\s*(\d+))?$/);
      const names = (m?.[1] ?? "").split(/ and /).map((x) => x.replace(/^the /i, "").trim().toLowerCase()).filter((x) => /^[a-z][a-z' ]*$/.test(x));
      pending.push(...names);
      if (m?.[3]) {
        const pts = (m[2] === "+" ? 1 : -1) * Number(m[3]);
        for (const name of pending) docExtra.set(name, pts);
        pending = [];
      }
    }
    const extraRoles = starting.roles.filter((r) => r.extraPoints);
    const extraOk =
      extraRoles.length === docExtra.size &&
      extraRoles.every((r) => docExtra.get(r.name.replace(/^the /i, "").toLowerCase()) === r.extraPoints);
    const vaultDoc = Number((depotDoc.match(/carrying \*\*(\d+) obols\*\*/) ?? [])[1]);
    claims.push(
      {
        doc: "DEPOT.md, CHARACTERS.md",
        claim: "A bank account opens empty; a starting purse is physical obols",
        docValue: saysEmpty ? "opens empty" : "not stated",
        model: seeds ? `createActions.js credits role.startingAccountObols on creation (${seededRoles.length} roles start with a balance)` : "nothing seeds an account",
        ok: !(saysEmpty && seeds),
        note: "A doc bug: the docs predate the seeding in createActions.js.",
      },
      {
        doc: "CHARACTERS.md",
        claim: "The roles CHARACTERS.md §3 names as setting extra_starting_points are exactly the ones docs/roles.yaml sets, at the same figures",
        docValue: docExtra.size ? [...docExtra].map(([n, p]) => `${n} ${p > 0 ? "+" : ""}${p}`).join(", ") : "none named",
        model: extraRoles.map((r) => `${r.name} ${r.extraPoints > 0 ? "+" : ""}${r.extraPoints}`).join(", ") || "none",
        ok: extraOk,
        note: "The doc's list is read from the parenthetical after the budget line, so a role added to roles.yaml without a doc edit fails here.",
      },
      {
        doc: "DEPOT.md §0g",
        claim: "The Vault carries the obols its doc names",
        docValue: Number.isFinite(vaultDoc) ? `${vaultDoc} obols` : "not stated",
        model: starting.vault ? `${starting.vault.coin} obols in docs/zones.yaml` : "no Vault room",
        ok: Boolean(starting.vault) && starting.vault.coin === vaultDoc,
        note: "If this differs, the Vault stash in zones.yaml has moved since the doc was written.",
      },
    );
  }

  // The sell tax, read from the code that sets and takes it, and the one doc that describes a tax the code lacks.
  {
    // The /treasury action hands the rate to the shared verb, which is where the check lives now.
    const treasurySrc = fs.readFileSync(path.join(REPO, "db/lib/verbs/place.js"), "utf8");
    const wholeZeroToHundred = /Number\.isInteger\(rate\)/.test(treasurySrc) && /rate < 0 \|\| rate > 100/.test(treasurySrc);
    const passSrc = fs.readFileSync(path.join(REPO, "db/lib/trainDeparturePass.js"), "utf8");
    const taxFn = (passSrc.match(/function taxOn[\s\S]*?\n}\n/) ?? [""])[0];
    const offGross = /Math\.min\(gross,\s*Math\.round\(\(gross \* pct\) \/ 100\)\)/.test(taxFn) && /taxOn\(gross,/.test(passSrc);
    const libDir = path.join(REPO, "db/lib");
    const taxCallers = fs.readdirSync(libDir).filter((f) => f.endsWith(".js") && /\btaxOn\(/.test(fs.readFileSync(path.join(libDir, f), "utf8")));
    const handbookLine = (fs.readFileSync(path.join(REPO, "docs/handbook.md"), "utf8").match(/[^.\n]*[Ff]arming[^.\n]*tax[^.\n]*\./) ?? [null])[0];
    claims.push(
      {
        doc: "DEPOT.md §0f",
        claim: "The sell tax rate is a whole percent from 0 to 100 (db/lib/verbs/place.js, behind /treasury)",
        docValue: "whole, 0–100",
        model: wholeZeroToHundred ? "whole, 0–100" : "the treasury action no longer checks a whole 0–100",
        ok: wholeZeroToHundred,
      },
      {
        doc: "DEPOT.md §0f",
        claim: "The tax comes off the gross of a settled sale, rounded, never more than the sale (trainDeparturePass.js#taxOn)",
        docValue: "min(gross, round(gross × rate))",
        model: offGross ? "min(gross, round(gross × rate)), on each sale's gross" : "taxOn has changed shape; read it",
        ok: offGross,
      },
      {
        doc: "docs/handbook.md",
        claim: handbookLine ? `"${handbookLine.trim()}"` : "The handbook says farming is taxed",
        docValue: handbookLine ? "farming is taxed" : "no such line",
        model: `the only tax in the code is the sell tax, taken in ${taxCallers.join(", ") || "nothing"} on a drop-box sale; food crops are eaten, not sold, so nothing taxes farming`,
        ok: !handbookLine,
        note: "A doc bug: the handbook describes a farming tax the game does not have. Nothing farmed is sold at the counter any more (Foodstuffs is the one crop, and it never sells), so nothing about farming pays the sell tax.",
      },
    );
  }

  // desires.yaml's cooldown policy: a Desire that costs nothing per attempt waits 5 / 4 / 3 turns at tiers 1 / 2 / 3.
  const DESIRE_LADDER = { 1: 5, 2: 4, 3: 3 };
  const offLadder = desires.satisfiers.filter((r) => r.open && !r.once && !r.consumable && !r.variance && r.netCoin <= 0 && DESIRE_LADDER[r.tier] != null && r.cooldown < DESIRE_LADDER[r.tier]);
  claims.push(
    {
      doc: "desires.yaml, cooldown policy",
      claim: "A Desire that costs nothing per attempt is on the inverted ladder (5 / 4 / 3 turns at tiers 1 / 2 / 3), except consumables",
      docValue: "0 off the ladder",
      model: offLadder.length ? offLadder.map((r) => `${r.name}: tier ${r.tier}, cooldown ${r.cooldown} against ${DESIRE_LADDER[r.tier]}`).join("; ") : "0 off the ladder",
      ok: offLadder.length === 0,
      note: "Holding 100 ¢ is the case: the coin is only tied up, never spent, so the wording of the policy (a goal that costs nothing but cooperation takes the ladder) says it belongs there.",
    }
  );

  return {
    params,
    assumptions: assumptionsFor({ rv, rvMined, minedValue, resourceValue, sellTaxRate, turnLengthHours, turnsPerDay: params.turnsPerDay, hungerDecay: params.hungerDecay }),
    activities,
    wages,
    priceLadder,
    priceRule,
    resourceBalance,
    foodFloor,
    foodTiers,
    profitTiers,
    distilling,
    profitRows,
    workedRows,
    investments,
    equipment,
    armor,
    caving,
    trinkets,
    cooking,
    lucky,
    desires,
    starting,
    power,
    prospectorValue,
    combos,
    shortlists,
    baselines,
    cheapestMeal,
    fatigue,
    sources,
    producerDrops,
    foods,
    foodSupply,
    claims,
    heldBack: [...HELD_BACK].map((slug) => get(slug)?.name ?? slug),
    sellTax: sellTaxModel,
    miningRisk,
    combat,
    transport,
    travel,
    medical,
    secrets,
    desireLadder: DESIRE_LADDER,
    counts: { tags: list.length, craftable: list.filter((t) => t.craftable).length, carryTags: list.filter((t) => t.carryBonus != null).length },
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = { buildModel, assumptionsFor };
