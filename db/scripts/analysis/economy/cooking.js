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

// `food` is the model's one food valuation (foodValue.js); `tobacco` is the cash crop as the model's farm rows
// worked it out; `townFarmers` is the field's farmers-to-feed-the-town. None of them is worked out again here.
function buildCooking({ get, list, params, sources, foodFloor, food, tobacco = null, townFarmers, players, refs = {} }) {
  // The food crops: the model's one list of what Soilery sows that can be eaten.
  const CROPS = new Set(params.edibleCrops);
  const srcItem = new Map(sources.items.map((i) => [i.slug, i]));
  const rankOf = (slug) => (CROPS.has(slug) ? 2 : srcItem.get(slug)?.rank ?? 5);
  const sourceOf = (slug) => (CROPS.has(slug) ? "Farm (Soilery)" : srcItem.get(slug)?.best ?? "no route found");
  const rawHunger = (slug) => hungerLib.foodHungerFor(get(slug));
  const rawMoodPerBite = (slug) => hungerLib.RAW_FOOD_MOOD + (get(slug)?.cooked?.mood ?? 0);
  // The box's ¢ a point of hunger alone, and of hunger and mood together, both from foodValue.js.
  const boxPerHunger = food.perHunger;
  const boxPerPoint = food.perPoint;
  const moodWeight = food.moodWeight;

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
      // Every input goes through the one food valuation: its market price, else its hunger and mood at the
      // Ration Box's rate.
      const unitCost = (slug) => food.of(get(slug));
      const cost = [...per].reduce((s, [slug, c]) => s + c * unitCost(slug), 0);
      const movesPer = moves / y;
      // A dish's own worth to a buyer with coin: what the same hunger AND mood would cost from a
      // Ration Box. This used to price hunger alone, so a mood-heavy Skilled dish (the whole point of
      // which is the mood, per the report's own text) always looked like a loss no matter how cheap its
      // ingredients were — Northern Delight's 50 mood was worth nothing here even though buying that
      // much mood any other way costs real ¢.
      const value = boxPerPoint == null ? null : food.asFood(t.mealHunger, t.mealMood ?? 0);
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
  const harvest = params.harvestPerFarm;
  const fertHarvest = params.harvestPerFarmFert;
  const duty = params.farmDuty;
  const cropDish = dishes.filter((d) => d.farmOnly && d.tier === "Basic").sort((a, b) => b.hungerPerUnit - a.hungerPerUnit)[0];
  const staple = get(params.stapleCrop);
  const wheat = get("wheat");
  const fertPrice = get("fertilizer")?.depotPrice ?? null;
  const harmful = (t) => JSON.stringify(t?.consumesInto ?? []).match(/nauseous|vomiting|poisoned/);
  const strategy = (id, label, hungerPerCrop, bites, moodPerBite, opts = {}) => {
    // The cooked diet is the field's own count (the crops a turn its farmers bring in), so this table and the
    // field tab cannot disagree on how many farmers feed the town. A raw diet is worked out from its hunger.
    const crops = opts.cooked ? townFarmers * duty * harvest : need / hungerPerCrop;
    const h = opts.fertilized ? fertHarvest : harvest;
    const actions = crops / h;
    const farmers = actions / duty;
    const cookMoves = opts.cookMovesPerCrop ? crops * opts.cookMovesPerCrop : 0;
    return {
      id,
      label,
      hungerPerCrop,
      cropsPerTurn: crops,
      farmActionsPerTurn: actions,
      farmers,
      cookMoves,
      // A farmer's Farm action takes the Move on the turns the ladder allows; the others are free for a cook's work.
      freeFarmerMoves: farmers * (1 - duty),
      // A cook works one Move a turn and crafting never tires anyone, so a Move a turn is a cook.
      cooks: cookMoves,
      // What the farmers' own spare Moves cannot cover.
      extraCooks: Math.max(0, cookMoves - farmers * (1 - duty)),
      moodPerPersonTurn: (need / players / hungerPerCrop) * (bites ?? 1) * moodPerBite,
      bitesPerPersonTurn: (params.hungerDecay / hungerPerCrop) * (bites ?? 1),
      note: opts.note ?? "",
    };
  };
  const per = params.hungerDecay;
  const dishUnits = cropDish?.units ?? 1;
  const cookMovesPerCrop = (cropDish?.moves ?? 0) / dishUnits;
  const fertNote = fertPrice == null ? "" : `Fertilizer is ${fertPrice} ¢ a Farm action.`;
  const strategies = [
    strategy("raw-wheat", "Everyone eats raw wheat", wheat.cooked.hunger, 1, rawMoodPerBite("wheat"), { note: `Raw wheat is ${wheat.cooked.hunger} hunger a crop and ${rawMoodPerBite("wheat")} mood a bite${harmful(wheat) ? ", and it makes you sick" : ""}.` }),
    strategy("raw-staple", `Everyone eats raw ${staple.name}`, staple.cooked.hunger, 1, rawMoodPerBite(params.stapleCrop), { note: `${staple.cooked.hunger} hunger a crop, and ${rawMoodPerBite(params.stapleCrop)} mood a bite.` }),
    strategy("cooked", `Farmers cook ${cropDish?.name ?? "a crop dish"} (${fmtN(dishUnits)} crops a dish)`, cropDish?.hungerPerUnit ?? 0, 1 / dishUnits, (cropDish?.mood ?? 0), { cooked: true, cookMovesPerCrop, note: cropDish ? `${fmtN(dishUnits)} crops make a ${cropDish.hunger}-hunger dish for ${round1(cropDish.moves * 100) / 100} of a Move.` : "" }),
    strategy("cooked-fert", "The same, with Fertilizer on every field", cropDish?.hungerPerUnit ?? 0, 1 / dishUnits, (cropDish?.mood ?? 0), { cooked: true, fertilized: true, cookMovesPerCrop, note: fertNote }),
  ];
  const boxStrategy = foodFloor.anyone
    ? {
        id: "box",
        label: "Everyone buys Ration Boxes",
        hungerPerCrop: null,
        farmers: 0,
        cost: foodFloor.anyone.costPerPersonTurn,
        note: `${foodFloor.anyone.hunger} hunger a box on average, ${foodFloor.anyone.buy} ¢, and no farmer at all, but ${round1(foodFloor.anyone.costPerPersonTurn)} ¢ a person-turn.`,
      }
    : null;

  // ---- tobacco, the cash crop, beside growing food ------------------------------------------------------------
  // A farmer's turn, by what they grow. Food is worth what the one food valuation says (the most a buyer with coin
  // would pay, off the Ration Box); tobacco is cash from the Depot. People fed is a steady state.
  const foodRow = (id, label, cropsPerAction, hungerPerCrop, worthPerCrop, cookMovesPerCropHere, note) => {
    const hungerPerTurn = cropsPerAction * hungerPerCrop * duty;
    return {
      id,
      label,
      peopleFed: hungerPerTurn / params.hungerDecay,
      worth: worthPerCrop == null ? null : cropsPerAction * worthPerCrop * duty,
      cash: 0,
      cookMoves: cropsPerAction * cookMovesPerCropHere * duty,
      note,
    };
  };
  const cookedWorthPerCrop = cropDish?.value == null ? null : cropDish.value / dishUnits;
  const farmOptions = [
    foodRow("food-raw", `Grow food, eat it raw (${staple.name})`, harvest, staple.cooked.hunger, food.of(staple), 0, "The mood cost of raw eating is not counted."),
    foodRow("food-cooked", `Grow food, cook it (${cropDish?.name ?? "a crop dish"})`, harvest, cropDish?.hungerPerUnit ?? 0, cookedWorthPerCrop, cookMovesPerCrop, null),
    foodRow("food-cooked-fert", "The same with Fertilizer", fertHarvest, cropDish?.hungerPerUnit ?? 0, cookedWorthPerCrop, cookMovesPerCrop, fertNote),
  ];
  // The cooking a farmer's own harvest needs, read off the row rather than typed.
  for (const r of farmOptions.filter((x) => x.note == null)) r.note = `Needs the cooking, about ${Math.round(r.cookMoves * 100) / 100} of a Move a turn a farmer.`;
  if (tobacco) {
    farmOptions.push({ id: "tobacco", label: "Grow tobacco", peopleFed: 0, worth: null, cash: tobacco.perTurn, cookMoves: 0, note: `${fmtN(tobacco.leaves)} leaves at ${tobacco.price} ¢ an action, after a ${tobacco.seed} ¢ seed bag.` });
    farmOptions.push({ id: "tobacco-fert", label: "Grow tobacco with Fertilizer", peopleFed: 0, worth: null, cash: tobacco.perTurnFert, cookMoves: 0, note: `Fertilizer stops the wither die (1 plant in ${tobacco.witherIn} fails) and doubles a plant one time in ${soilery.BOUNTY_IN}: ${fmtN(tobacco.leavesFert)} leaves.` });
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
  const rawHungerPerAction = cropsPerAction * staple.cooked.hunger;
  const cookedHungerPerAction = cropsPerAction * (cropDish?.hungerPerUnit ?? 0);
  const cookMovesPerAction = cropsPerAction * cookMovesPerCrop;
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
    .map((t) => {
      const hunger = hungerLib.foodHungerFor(t);
      const mood = t.cooked.mood ?? 0;
      const estimated = food.basisOf(t) === "food";
      return {
        slug: t.slug,
        name: t.name,
        hunger,
        mood,
        // No market price of its own (a farmed crop, most often): priced as food, off the Ration Box, the
        // way the dishes above price their inputs.
        cost: estimated ? round1(food.of(t)) : food.of(t),
        costEstimated: estimated,
        source: sourceOf(t.slug),
        rank: rankOf(t.slug),
      };
    })
    .filter((a) => a.mood > 0 || a.hunger > 0)
    .sort((a, b) => b.mood - a.mood || b.hunger - a.hunger);

  // The most one slot can add, over everything with a cooked block (the table above leaves some out on taste).
  const richestSlot = list
    .filter((t) => t.cooked && t.group !== "items-drink")
    .map((t) => ({ name: t.name, hunger: hungerLib.foodHungerFor(t) }))
    .sort((a, b) => b.hunger - a.hunger)[0] ?? null;

  const unreachableDishes = dishes.filter((d) => d.unreachable.length);
  const cropOnly = dishes.filter((d) => d.farmOnly);

  // ---- sanity check: a dish that loses far more than a bad wage ---------------------------------------
  // Every wage this report finds elsewhere sits between about 1 and 27 ¢ a turn (a Crafter's Longbow to a
  // Ration-Box-valued farmer). A dish whose margin per Move is a large negative multiple of that — spending
  // a Move on nothing but it would leave you deep in the red against the worst legitimate wage in the game
  // — is either a genuinely overpriced recipe (rare, pricey ingredients bought for little hunger or mood)
  // or a sign the pricing above missed something. Either way it is worth a GM's eye, not silence.
  const LARGE_LOSS_PER_MOVE = -50;
  const flagged = dishes
    .filter((d) => d.marginPerMove != null && d.marginPerMove < LARGE_LOSS_PER_MOVE)
    .sort((a, b) => a.marginPerMove - b.marginPerMove)
    .map((d) => ({ name: d.name, inputs: d.inputs, hunger: d.hunger, mood: d.mood, cost: d.cost, value: d.value, margin: d.margin, marginPerMove: d.marginPerMove }));

  return {
    dishes,
    strategies,
    flagged,
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
    cropDish: cropDish ? { name: cropDish.name, hunger: cropDish.hunger, hungerPerUnit: cropDish.hungerPerUnit, units: cropDish.units, moves: cropDish.moves, value: cropDish.value } : null,
    need,
    harvest,
    fertHarvest,
    boxPerHunger,
    boxPerPoint,
    moodWeight,
    rawFoodMood: hungerLib.RAW_FOOD_MOOD,
    // What a bite of the staple costs in mood eaten raw: the flat raw penalty plus the crop's own taste.
    rawMoodStaple: rawMoodPerBite(params.stapleCrop),
    richestSlot,
    cookingPoints: { basic: get("cooking-basic")?.pointCost ?? 0, skilled: get("cooking-skilled")?.pointCost ?? 0 },
  };
}

module.exports = { buildCooking };
