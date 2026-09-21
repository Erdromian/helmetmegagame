// Cooking against farming: is a cook worth more than another farmer, and what can a cook make of the
// things nobody wants to eat raw?
//
// Everything is read from the catalog and the game's own rules. A dish restores its own `mealHunger`
// plus each slotted ingredient's hunger (web/app/(app)/character/actions/misc.js), and its mood is
// `mealMood` plus the positive slot moods, less the negative ones (db/lib/mood.js#dishMoodTerms). Eating a
// thing raw restores its own hunger and costs a flat -10 mood a bite on top of whatever the food's own
// mood is (db/lib/hunger.js#rawFoodMoodTerms). A recipe's fixed base ingredients are spent when it is made
// and count as the recipe's inputs; the four optional slots are counted separately.

const hungerLib = require("../../../lib/hunger");
const soilery = require("../../../lib/soilery");

const fmtN = (n) => `${Math.round(n)}`;
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const CROPS = new Set(["wheat", "potato", "tomato", "carrot", "onion", "plump-helmet"]);

function buildCooking({ get, list, rv, params, sources, foodFloor, players, refs = {} }) {
  const srcItem = new Map(sources.items.map((i) => [i.slug, i]));
  const rankOf = (slug) => (CROPS.has(slug) ? 2 : srcItem.get(slug)?.rank ?? 5);
  const sourceOf = (slug) => (CROPS.has(slug) ? "Farm (Soilery)" : srcItem.get(slug)?.best ?? "no route found");
  const rawHunger = (slug) => hungerLib.foodHungerFor(get(slug));
  const rawMoodPerBite = (slug) => hungerLib.RAW_FOOD_MOOD + (get(slug)?.cooked?.mood ?? 0);
  const boxPerHunger = foodFloor.anyone ? foodFloor.anyone.buy / foodFloor.anyone.hunger : null;

  // A recipe's base inputs, expanded down to things that are not themselves dishes.
  const expand = (slug, seen = []) => {
    const t = get(slug);
    const r = t?.requirement ?? {};
    const prims = new Map();
    let moves = r.turnsCost ?? 0;
    const add = (s, n) => prims.set(s, (prims.get(s) ?? 0) + n);
    for (const raw of r.items ?? []) {
      if (typeof raw === "string") add(raw, 1);
      else if (raw.anyOf) {
        // The cheapest way in: the option that costs least, then the one that feeds most.
        const pick = [...raw.anyOf]
          .map((o) => (typeof o === "string" ? o : o.tag))
          .sort((a, b) => (get(a)?.sellablePrice ?? 0) - (get(b)?.sellablePrice ?? 0) || rawHunger(b) - rawHunger(a))[0];
        add(pick, 1);
      } else if (raw.customOf && !seen.includes(raw.customOf)) {
        const sub = expand(raw.customOf, [...seen, slug]);
        const n = raw.count ?? 1;
        const y = get(raw.customOf)?.requirement?.yield ?? 1;
        for (const [s, c] of sub.prims) add(s, (c * n) / y);
        moves += (sub.moves * n) / y;
      } else if (raw.tag) add(raw.tag, raw.count ?? 1);
    }
    return { prims, moves };
  };

  // ---- every dish ------------------------------------------------------------------------------------
  const dishes = list
    .filter((t) => t.craftable && t.mealHunger != null && (t.requirement?.skills ?? []).some((s) => /^cooking/.test(s)))
    .map((t) => {
      const r = t.requirement;
      const y = r.yield ?? 1;
      const { prims, moves } = expand(t.slug);
      const per = new Map([...prims].map(([s, c]) => [s, c / y]));
      const units = [...per.values()].reduce((a, b) => a + b, 0);
      const raw = [...per].reduce((s, [slug, c]) => s + c * rawHunger(slug), 0);
      const rawMood = [...per].reduce((s, [slug, c]) => s + c * rawMoodPerBite(slug), 0);
      // A crop that does not sell is priced as food, at the Ration Box's price per hunger.
      const unitCost = (slug) => get(slug)?.sellablePrice ?? get(slug)?.depotPrice ?? (CROPS.has(slug) && boxPerHunger ? rawHunger(slug) * boxPerHunger : 0);
      const cost = [...per].reduce((s, [slug, c]) => s + c * unitCost(slug), 0);
      const movesPer = moves / y;
      const value = boxPerHunger == null ? null : t.mealHunger * boxPerHunger;
      const hardest = Math.max(...[...per.keys()].map(rankOf));
      const unreachable = [...per.keys()].filter((s) => rankOf(s) >= 5);
      return {
        slug: t.slug,
        name: t.name,
        skill: (r.skills ?? []).join(", "),
        tier: (r.skills ?? []).some((s) => /skilled/.test(s)) ? "Skilled" : "Basic",
        hunger: t.mealHunger,
        sell: t.sellablePrice ?? null,
        mood: t.mealMood ?? 0,
        yield: y,
        inputs: [...per].map(([s, c]) => `${round1(c) === 1 ? "" : `${round1(c)}× `}${get(s)?.name ?? s}`),
        primitives: [...per.keys()],
        units,
        rawHunger: raw,
        rawMood,
        rawBites: units,
        multiplier: raw > 0 ? t.mealHunger / raw : null,
        hungerPerUnit: units > 0 ? t.mealHunger / units : null,
        moves: movesPer,
        cost,
        value,
        margin: value == null ? null : value - cost,
        marginPerMove: value != null && movesPer > 0 ? (value - cost) / movesPer : null,
        // Cooks working a full turn (one Move) every turn, to feed the whole town on this dish alone.
        cooksToFeedTown: t.mealHunger > 0 ? ((players * params.hungerDecay) / t.mealHunger) * movesPer : null,
        dishesToFeedTown: t.mealHunger > 0 ? (players * params.hungerDecay) / t.mealHunger : null,
        farmOnly: [...per.keys()].every((s) => CROPS.has(s)),
        hardestRank: hardest,
        hardest: [...per.keys()].sort((a, b) => rankOf(b) - rankOf(a))[0],
        unreachable: unreachable.map((s) => get(s)?.name ?? s),
        mealSlots: r.ingredientSlots?.max ?? 0,
      };
    })
    .sort((a, b) => (b.hungerPerUnit ?? 0) - (a.hungerPerUnit ?? 0));

  // ---- feeding a town -----------------------------------------------------------------------------------
  const need = players * params.hungerDecay;
  const cpp = params.cropsPerPlant ?? 1;
  const harvest = params.farmMaxCrops * ((soilery.WITHER_IN - 1) / soilery.WITHER_IN) * cpp;
  const fertHarvest = params.farmMaxCrops * (1 + 1 / soilery.BOUNTY_IN) * cpp;
  const cycle = params.farmCycle;
  const cropDish = dishes.filter((d) => d.farmOnly && d.tier === "Basic").sort((a, b) => b.hungerPerUnit - a.hungerPerUnit)[0];
  const potato = get("potato");
  const wheat = get("wheat");
  const strategy = (id, label, hungerPerCrop, bites, moodPerBite, opts = {}) => {
    const crops = need / hungerPerCrop;
    const h = opts.fertilized ? fertHarvest : harvest;
    const actions = crops / h;
    const farmers = actions * cycle;
    const cookMoves = opts.cookMovesPerCrop ? crops * opts.cookMovesPerCrop : 0;
    return {
      id,
      label,
      hungerPerCrop,
      cropsPerTurn: crops,
      farmActionsPerTurn: actions,
      farmers,
      cookMoves,
      // A farmer's Farm action takes the Move on one turn in `cycle`; the others are free for a cook's work.
      freeFarmerMoves: farmers * ((cycle - 1) / cycle),
      // A cook works one Move a turn and crafting never tires anyone, so a Move a turn is a cook.
      cooks: cookMoves,
      // What the farmers' own spare Moves cannot cover.
      extraCooks: Math.max(0, cookMoves - farmers * ((cycle - 1) / cycle)),
      moodPerPersonTurn: (need / players / hungerPerCrop) * (bites ?? 1) * moodPerBite,
      bitesPerPersonTurn: (params.hungerDecay / hungerPerCrop) * (bites ?? 1),
      note: opts.note ?? "",
    };
  };
  const per = params.hungerDecay;
  const strategies = [
    strategy("raw-wheat", "Everyone eats raw wheat", wheat.cooked.hunger, 1, rawMoodPerBite("wheat"), { note: `Raw wheat is ${wheat.cooked.hunger} hunger a crop, costs 5 mood a bite on top of the 10 and makes you nauseous.` }),
    strategy("raw-potato", "Everyone eats raw potatoes", potato.cooked.hunger, 1, rawMoodPerBite("potato"), { note: `The best raw crop: ${potato.cooked.hunger} hunger, and a flat −10 mood a bite.` }),
    strategy("cooked", `Farmers cook ${cropDish?.name ?? "a crop dish"} (two crops a dish)`, cropDish?.hungerPerUnit ?? 0, 1 / (cropDish?.units ?? 1), (cropDish?.mood ?? 0), { cookMovesPerCrop: (cropDish?.moves ?? 0) / (cropDish?.units ?? 1), note: "Two crops make a 35-hunger dish for 0.05 of a Move." }),
    strategy("cooked-fert", "The same, with Fertilizer on every field", cropDish?.hungerPerUnit ?? 0, 1 / (cropDish?.units ?? 1), (cropDish?.mood ?? 0), { fertilized: true, cookMovesPerCrop: (cropDish?.moves ?? 0) / (cropDish?.units ?? 1), note: "Fertilizer is 4 ¢ a Farm action." }),
  ];
  const boxStrategy = foodFloor.anyone
    ? {
        id: "box",
        label: "Everyone buys Ration Boxes",
        hungerPerCrop: null,
        farmers: 0,
        cost: (per / foodFloor.anyone.hunger) * foodFloor.anyone.buy,
        note: `${foodFloor.anyone.hunger} hunger a box on average, ${foodFloor.anyone.buy} ¢, and no farmer at all, but ${round1((per / foodFloor.anyone.hunger) * foodFloor.anyone.buy)} ¢ a person-turn.`,
      }
    : null;

  // ---- tobacco, the cash crop ----------------------------------------------------------------------------
  // A crop with its own numbers (db/lib/soilery.js): fewer leaves a plant, a steeper wither die, and it sells.
  // Set beside growing food and cooking it, per farmer per turn (one Farm action every `cycle` turns).
  const tobEntry = soilery.CROPS.find((c) => c.crop === "tobacco");
  const tobTag = get("tobacco");
  let tobacco = null;
  if (tobEntry && tobTag) {
    const seedBag = get("tobacco-seed-bag");
    const fert = get("fertilizer");
    const plants = params.farmMaxCrops;
    const cpp = tobEntry.cropsPerPlant ?? soilery.CROPS_PER_PLANT ?? 1;
    const wither = tobEntry.witherIn ?? soilery.WITHER_IN;
    const price = tobTag.sellablePrice ?? 0;
    const seed = seedBag?.depotPrice ?? 0;
    const fertCost = fert?.depotPrice ?? 0;
    const leaves = plants * (1 - 1 / wither) * cpp;
    const leavesFert = plants * (1 + 1 / soilery.BOUNTY_IN) * cpp;
    const netAction = leaves * price - seed;
    const netActionFert = leavesFert * price - seed - fertCost;
    tobacco = {
      plants,
      leavesPerPlant: cpp,
      witherIn: wither,
      price,
      seed,
      fertCost,
      leaves,
      leavesFert,
      revenue: leaves * price,
      netAction,
      netActionFert,
      perTurn: netAction / cycle,
      perTurnFert: netActionFert / cycle,
      fertGainPerAction: netActionFert - netAction,
      seedResale: seedBag?.sellablePrice ?? null,
    };
  }
  // A farmer's turn, by what they grow. "Worth" for food is the Ration Box's price per hunger, the most a buyer
  // with coin would pay; tobacco is cash from the Depot. People fed is a steady state (a Farm action every `cycle` turns).
  const potatoTag = get("potato");
  const foodRow = (id, label, cropsPerAction, hungerPerCrop, cookMovesPerCrop, note) => {
    const hungerPerTurn = (cropsPerAction * hungerPerCrop) / cycle;
    return {
      id,
      label,
      peopleFed: hungerPerTurn / params.hungerDecay,
      worth: boxPerHunger == null ? null : hungerPerTurn * boxPerHunger,
      cash: 0,
      cookMoves: (cropsPerAction * cookMovesPerCrop) / cycle,
      note,
    };
  };
  const cookPerCrop = (cropDish?.moves ?? 0) / (cropDish?.units || 1);
  const farmOptions = [
    foodRow("food-raw", "Grow food, eat it raw", harvest, potatoTag.cooked.hunger, 0, "The mood cost of raw eating is not counted."),
    foodRow("food-cooked", `Grow food, cook it (${cropDish?.name ?? "a crop dish"})`, harvest, cropDish?.hungerPerUnit ?? 0, cookPerCrop, "Needs the cooking, about one Move a turn a farmer."),
    foodRow("food-cooked-fert", "The same with Fertilizer", fertHarvest, cropDish?.hungerPerUnit ?? 0, cookPerCrop, "Fertilizer is 4 ¢ a Farm action."),
  ];
  if (tobacco) {
    farmOptions.push({ id: "tobacco", label: "Grow tobacco", peopleFed: 0, worth: null, cash: tobacco.perTurn, cookMoves: 0, note: `${fmtN(tobacco.leaves)} leaves at ${tobacco.price} ¢ an action, after a ${tobacco.seed} ¢ seed bag.` });
    farmOptions.push({ id: "tobacco-fert", label: "Grow tobacco with Fertilizer", peopleFed: 0, worth: null, cash: tobacco.perTurnFert, cookMoves: 0, note: `Fertilizer stops the wither die (1 plant in ${tobacco.witherIn} fails) and doubles a plant one time in ${soilery.BOUNTY_IN}: ${fmtN(tobacco.leavesFert)} leaves.` });
  }
  const townFarmers = cooked_farmers_placeholder();
  function cooked_farmers_placeholder() {
    return need / (((cropDish?.hungerPerUnit ?? 1) * harvest) / cycle);
  }
  // What one farmer switching from food to tobacco does to a town that has just enough farmers.
  const cookedRow = farmOptions.find((r) => r.id === "food-cooked");
  const switchTable = [];
  if (tobacco && cookedRow) {
    const F = Math.ceil(townFarmers);
    for (let k = 0; k <= Math.min(F, 4); k++) {
      const fed = Math.min(players, (F - k) * cookedRow.peopleFed);
      switchTable.push({ farmers: F, tobacco: k, fed, hungry: players - fed, coin: k * tobacco.perTurn, coinFert: k * tobacco.perTurnFert });
    }
  }
  const refsOut = { factoryShift: refs.factoryShift ?? null, factoryPerTurn: refs.factoryPerTurn ?? null, prospector: refs.prospector ?? null, miner: refs.miner ?? null };

  // ---- what a cook adds to a farm action's harvest -------------------------------------------------------------
  const cropsPerAction = harvest;
  const rawHungerPerAction = cropsPerAction * potato.cooked.hunger;
  const cookedHungerPerAction = cropsPerAction * (cropDish?.hungerPerUnit ?? 0);
  const cookMovesPerAction = cropsPerAction * ((cropDish?.moves ?? 0) / (cropDish?.units ?? 1));
  const cookAdds = {
    cropsPerAction,
    rawHungerPerAction,
    cookedHungerPerAction,
    gain: cookedHungerPerAction - rawHungerPerAction,
    gainPersonTurns: (cookedHungerPerAction - rawHungerPerAction) / per,
    movesPerAction: cookMovesPerAction,
    farmPersonTurnsPerMove: rawHungerPerAction / per,
    cookPersonTurnsPerMove: cookMovesPerAction > 0 ? (cookedHungerPerAction - rawHungerPerAction) / per / cookMovesPerAction : null,
  };

  // ---- the ingredients nobody eats raw -----------------------------------------------------------------------
  // A primitive is "bad raw" if eating it raw grants nothing or grants something harmful, or its own taste
  // is negative. For each, the best dish that takes it in as a base input.
  const harmful = (t) => JSON.stringify(t?.consumesInto ?? []).match(/nauseous|vomiting|poisoned/);
  const primSet = new Set(dishes.flatMap((d) => d.primitives));
  // Also things that become a dish input by being crafted first (a maggot into milk).
  const viaCraft = new Map();
  for (const t of list) {
    if (!t.craftable) continue;
    for (const raw of t.requirement?.items ?? []) {
      const s = typeof raw === "string" ? raw : raw.tag;
      if (s && primSet.has(t.slug) && !viaCraft.has(s)) viaCraft.set(s, t);
    }
  }
  const candidates = new Set([...primSet, ...viaCraft.keys(), "cave-fungus", "purring-maggot", "rock", "saltpeter", "skinned-cave-rat", "rock-salt"]);
  const inedible = [...candidates]
    .map((slug) => {
      const t = get(slug);
      if (!t) return null;
      const rawH = rawHunger(slug);
      const isDrink = t.group === "items-drink" || JSON.stringify(t.consumesInto ?? []).includes("tipsy");
      if (isDrink) return null;
      const bad = rawH === 0 || !!harmful(t) || (t.cooked?.mood ?? 0) < 0;
      if (!bad) return null;
      const target = viaCraft.get(slug);
      const useSlug = target ? target.slug : slug;
      const users = dishes.filter((d) => d.primitives.includes(useSlug));
      const best = [...users].sort((a, b) => b.hunger + b.mood - (a.hunger + a.mood))[0];
      return {
        slug,
        name: t.name,
        rawHunger: rawH,
        rawMood: rawH > 0 ? rawMoodPerBite(slug) : null,
        rawEffect: harmful(t)
          ? /poisoned/.test(JSON.stringify(t.consumesInto)) ? "poisons you" : "makes you sick"
          : rawH === 0
            ? (t.consumesInto ?? []).length ? "no food in it (a status only)" : "cannot be eaten"
            : "unpleasant",
        via: target ? `${target.name} (a ${(target.requirement?.skills ?? [])[0] ?? "craft"})` : null,
        source: sourceOf(slug),
        rank: rankOf(slug),
        bestDish: best?.name ?? null,
        dishHunger: best?.hunger ?? null,
        dishMood: best?.mood ?? null,
        dishes: users.map((d) => d.name),
        cookable: users.length > 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.cookable) - Number(a.cookable) || (b.dishMood ?? -99) - (a.dishMood ?? -99));

  // The rat the caves drop and the rat the recipes take are one tag now (it used to be two).
  const caveRat = get("skinned-cave-rat");
  const ratUsers = dishes.filter((d) => d.primitives.includes("skinned-cave-rat"));
  const ratGap = {
    caveRatSlug: caveRat?.slug,
    // A recipe's rat is a rat nothing produces if the tag it names is not the one in the loot table.
    recipeRatSlug: get("dead-rat") ? "dead-rat" : caveRat?.slug,
    recipeRatSource: sourceOf(get("dead-rat") ? "dead-rat" : "skinned-cave-rat"),
    dishes: (get("dead-rat") ? dishes.filter((d) => d.primitives.includes("dead-rat")) : ratUsers).map((d) => d.name),
    fixed: !get("dead-rat") && ratUsers.length > 0,
  };

  // ---- what a cook can slot in ------------------------------------------------------------------------
  // Up to four extra ingredients ride on top of any dish. Each adds its own hunger and, if positive, its
  // mood to the dish's; a negative mood is disgust that no dish base can cancel.
  const addIns = list
    .filter((t) => t.cooked && !(t.group === "items-drink") && t.slug !== "human-flesh" && t.slug !== "flesh-of-tzchernobog")
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      hunger: hungerLib.foodHungerFor(t),
      mood: t.cooked.mood ?? 0,
      cost: t.sellablePrice ?? t.depotPrice ?? null,
      source: sourceOf(t.slug),
      rank: rankOf(t.slug),
    }))
    .filter((a) => a.mood > 0 || a.hunger > 0)
    .sort((a, b) => b.mood - a.mood || b.hunger - a.hunger);

  const unreachableDishes = dishes.filter((d) => d.unreachable.length);
  const cropOnly = dishes.filter((d) => d.farmOnly);

  return {
    dishes,
    strategies,
    boxStrategy,
    cookAdds,
    inedible,
    addIns,
    tobacco,
    farmOptions,
    switchTable,
    refs: refsOut,
    townFarmers,
    ratGap,
    unreachableDishes,
    cropOnly,
    cropDish: cropDish ? { name: cropDish.name, hungerPerUnit: cropDish.hungerPerUnit } : null,
    need,
    harvest,
    fertHarvest,
    boxPerHunger,
    cookingPoints: { basic: get("cooking-basic")?.pointCost ?? 0, skilled: get("cooking-skilled")?.pointCost ?? 0 },
  };
}

module.exports = { buildCooking };
