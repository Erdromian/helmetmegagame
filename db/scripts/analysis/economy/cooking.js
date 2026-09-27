// Cooking against farming: is a cook worth more than a farmer eating raw, and what can a cook do
// with an ingredient nobody would eat plain?
//
// The Soilery Rework (db/lib/soilery.js, db/lib/hunger.js) replaced the 36 named recipes with three
// meal-class templates — basic-meal, skilled-meal, lavish-meal (docs/tags.yaml) — each `mealClass`-
// tagged and each costing a fixed count of Foodstuffs (2, 2, 3), lavish also wanting at least one
// extra ingredient. A dish restores its own `mealHunger` plus each slotted ingredient's hunger
// (web/app/(app)/character/actions/misc.js), and its mood is `mealMood` plus the positive slot
// moods, less the negative ones (db/lib/mood.js#dishMoodTerms). Eating a raw INGREDIENT (a `cooked:`
// block, not a meal) costs a flat -10 mood a bite on top of whatever the food's own mood is
// (db/lib/hunger.js#rawFoodMoodTerms) — but Foodstuffs is not on that path: it carries its own flat
// -5 as `mealMood`, since it is itself meal-shaped (`mealHunger` set), not a raw ingredient.

const hungerLib = require("../../../lib/hunger");
const soilery = require("../../../lib/soilery");

const fmtN = (n) => `${Math.round(n)}`;
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// `food` is the model's one food valuation (foodValue.js). Nothing else is worked out again here.
function buildCooking({ get, list, params, sources, foodFloor, food, players }) {
  // The one food crop now: Foodstuffs, params.stapleCrop (model.js sets it to FOODSTUFFS_SLUG).
  const CROPS = new Set([params.stapleCrop]);
  const srcItem = new Map(sources.items.map((i) => [i.slug, i]));
  // A slot-in ingredient is no recipe's input since the meal classes replaced the named recipes, so it
  // is not in sources.items; ask sources for its routes directly (the same ranking, any slug).
  const bestRoute = (slug) => srcItem.get(slug) ?? (() => {
    const r = sources.routesFor(slug)[0];
    return r ? { rank: r.rank, best: r.label } : null;
  })();
  const rankOf = (slug) => (CROPS.has(slug) ? 2 : bestRoute(slug)?.rank ?? 5);
  const sourceOf = (slug) => (CROPS.has(slug) ? "Farm (Soilery)" : bestRoute(slug)?.best ?? "no route found");
  const rawHunger = (slug) => hungerLib.foodHungerFor(get(slug));
  // What eating a thing RAW costs in mood. A meal-shaped tag (mealHunger set — Foodstuffs is the one
  // example) already carries its own eaten-raw figure as mealMood, with no separate raw-ingredient
  // penalty on top (db/lib/hunger.js's header comment says so in as many words). Anything else is a
  // true raw ingredient and takes the flat RAW_FOOD_MOOD plus its own cooked.mood.
  const rawMoodPerBite = (slug) => {
    const t = get(slug);
    if (!t) return 0;
    if (Number.isInteger(t.mealHunger)) return t.mealMood ?? 0;
    return hungerLib.RAW_FOOD_MOOD + (t.cooked?.mood ?? 0);
  };
  // The box's ¢ a point of hunger alone, and of hunger and mood together, both from foodValue.js.
  const boxPerHunger = food.perHunger;
  const boxPerPoint = food.perPoint;
  const moodWeight = food.moodWeight;

  // A recipe's base inputs, expanded down to things that are not themselves dishes. The meal templates
  // never nest (their one fixed input is Foodstuffs), but this stays generic rather than assuming that.
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

  // ---- what a cook can slot in ------------------------------------------------------------------------
  // Up to four extra ingredients ride on top of any dish — generic now, not per-recipe: any tag with a
  // `cooked:` block can be slotted into any meal class (COOKING.md, the Soilery Rework). Each adds its own
  // hunger and, if positive, its mood; a negative mood is disgust that no dish base can cancel.
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
        // No market price of its own (Foodstuffs, most often): priced as food, off the Ration Box, the
        // way the dishes above price their inputs.
        cost: estimated ? round1(food.of(t)) : food.of(t),
        costEstimated: estimated,
        source: sourceOf(t.slug),
        rank: rankOf(t.slug),
      };
    })
    .filter((a) => a.mood > 0 || a.hunger > 0)
    .sort((a, b) => b.mood - a.mood || b.hunger - a.hunger);

  // A class that insists on extra ingredients (Lavish: `ingredientSlots.min`) cannot be cooked without
  // them, so its cost, hunger and mood carry the cheapest slot-in anybody can actually get: a real
  // route, lowest price first, then the most mood for it.
  const cheapestFill = addIns.filter((a) => a.rank < 5).sort((a, b) => a.cost - b.cost || b.mood - a.mood || b.hunger - a.hunger)[0] ?? null;

  // ---- every dish (the three meal classes) -----------------------------------------------------------
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
      const minSlots = r.ingredientSlots?.min ?? 0;
      const fill = minSlots > 0 && cheapestFill ? { ...cheapestFill, count: minSlots } : null;
      const cost = [...per].reduce((s, [slug, c]) => s + c * unitCost(slug), 0) + (fill ? fill.count * fill.cost : 0);
      const movesPer = moves / y;
      // The meal's own figures, plus what its required extra ingredients add (their hunger, and their mood if positive).
      const mealHunger = t.mealHunger + (fill ? fill.count * fill.hunger : 0);
      const mealMood = (t.mealMood ?? 0) + (fill ? fill.count * Math.max(0, fill.mood) : 0);
      // A dish's own worth to a buyer with coin: what the same hunger AND mood would cost from a
      // Ration Box. This used to price hunger alone, so a mood-heavy Skilled dish (the whole point of
      // which is the mood, per the report's own text) always looked like a loss no matter how cheap its
      // ingredients were — Northern Delight's 50 mood was worth nothing here even though buying that
      // much mood any other way costs real ¢.
      const value = boxPerPoint == null ? null : food.asFood(mealHunger, mealMood);
      const hardest = Math.max(...[...per.keys()].map(rankOf), fill ? fill.rank : 0);
      const unreachable = [...per.keys()].filter((s) => rankOf(s) >= 5);
      return {
        slug: t.slug,
        name: t.name,
        mealClass: t.mealClass ?? null,
        skill: (r.skills ?? []).join(", "),
        tier: (r.skills ?? []).some((s) => /skilled/.test(s)) ? "Skilled" : "Basic",
        hunger: mealHunger,
        sell: t.sellablePrice ?? null,
        mood: mealMood,
        yield: y,
        inputs: [
          ...[...per].map(([s, c]) => `${round1(c) === 1 ? "" : `${round1(c)}× `}${get(s)?.name ?? s}`),
          ...(fill ? [`${fill.count === 1 ? "" : `${fill.count}× `}${fill.name} (the extra it must have)`] : []),
        ],
        requiredFill: fill ? { name: fill.name, count: fill.count, hunger: fill.hunger, mood: fill.mood, cost: fill.cost } : null,
        primitives: [...per.keys()],
        units,
        rawHunger: raw,
        rawMood,
        rawBites: units,
        multiplier: raw > 0 ? mealHunger / raw : null,
        hungerPerUnit: units > 0 ? mealHunger / units : null,
        moves: movesPer,
        cost,
        value,
        margin: value == null ? null : value - cost,
        marginPerMove: value != null && movesPer > 0 ? (value - cost) / movesPer : null,
        // Cooks working a full turn (one Move) every turn, to feed the whole town on this dish alone.
        cooksToFeedTown: mealHunger > 0 ? ((players * params.hungerDecay) / mealHunger) * movesPer : null,
        dishesToFeedTown: mealHunger > 0 ? (players * params.hungerDecay) / mealHunger : null,
        farmOnly: !fill && [...per.keys()].every((s) => CROPS.has(s)),
        hardestRank: hardest,
        hardest: [...per.keys()].sort((a, b) => rankOf(b) - rankOf(a))[0],
        unreachable: unreachable.map((s) => get(s)?.name ?? s),
        mealSlots: r.ingredientSlots?.max ?? 0,
        minSlots,
      };
    })
    .sort((a, b) => (b.hungerPerUnit ?? 0) - (a.hungerPerUnit ?? 0));

  // ---- feeding a town -----------------------------------------------------------------------------------
  const need = players * params.hungerDecay;
  const harvest = params.harvestPerFarm;
  const fertHarvest = params.harvestPerFarmFert;
  const duty = params.farmDuty;
  // The one Basic, crop-only dish: basic-meal, unless the catalog has moved it off Basic or off Foodstuffs.
  const cropDish = dishes.filter((d) => d.farmOnly && d.tier === "Basic").sort((a, b) => b.hungerPerUnit - a.hungerPerUnit)[0];
  const staple = get(params.stapleCrop);
  const stapleHunger = rawHunger(params.stapleCrop);
  const fertPrice = get("fertilizer")?.depotPrice ?? null;
  // A strategy is how the town eats: crops a turn needed for that hunger figure, the Farm actions and
  // farmers that takes, and the cooking on top where the food is cooked rather than eaten raw. Every
  // strategy uses the SAME `need / hungerPerCrop` rule — cooked and raw alike — so "farmers needed" is
  // never circular: it falls straight out of demand and the harvest, with no field pool behind it.
  const strategy = (id, label, hungerPerCrop, bites, moodPerBite, opts = {}) => {
    const crops = need / hungerPerCrop;
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
  const dishUnits = cropDish?.units ?? 1;
  const cookMovesPerCrop = (cropDish?.moves ?? 0) / dishUnits;
  const fertNote = fertPrice == null ? "" : `Fertilizer is ${fertPrice} ¢ a Farm action.`;
  const strategies = [
    strategy("raw-foodstuffs", "Everyone eats raw Foodstuffs", stapleHunger, 1, rawMoodPerBite(params.stapleCrop), { note: `Raw Foodstuffs are ${stapleHunger} hunger and ${rawMoodPerBite(params.stapleCrop)} mood a bite.` }),
    strategy("cooked", `Farmers cook ${cropDish?.name ?? "a meal"} (${fmtN(dishUnits)} Foodstuffs a dish)`, cropDish?.hungerPerUnit ?? 0, 1 / dishUnits, cropDish?.mood ?? 0, { cookMovesPerCrop, note: cropDish ? `${fmtN(dishUnits)} Foodstuffs make a ${cropDish.hunger}-hunger meal for ${round1(cropDish.moves * 100) / 100} of a Move.` : "" }),
    strategy("cooked-fert", "The same, with Fertilizer on every field", cropDish?.hungerPerUnit ?? 0, 1 / dishUnits, cropDish?.mood ?? 0, { fertilized: true, cookMovesPerCrop, note: fertNote }),
  ];
  // How many farmers, cooking their own Foodstuffs, feed the whole town — read off the "cooked" row above
  // rather than worked out twice. There is no field pool behind this any more: it is demand over supply.
  const farmersToEatTown = strategies.find((s) => s.id === "cooked")?.farmers ?? null;
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

  // ---- what a cook adds to a farm action's harvest -------------------------------------------------------------
  const cropsPerAction = harvest;
  const rawHungerPerAction = cropsPerAction * stapleHunger;
  const cookedHungerPerAction = cropsPerAction * (cropDish?.hungerPerUnit ?? 0);
  const cookMovesPerAction = cropsPerAction * cookMovesPerCrop;
  const per = params.hungerDecay;
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
    addIns,
    farmersToEatTown,
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
    // What a bite of Foodstuffs costs in mood eaten raw: its own flat mealMood, not the generic raw penalty.
    rawMoodStaple: rawMoodPerBite(params.stapleCrop),
    richestSlot,
    cookingPoints: { basic: get("cooking-basic")?.pointCost ?? 0, skilled: get("cooking-skilled")?.pointCost ?? 0 },
  };
}

module.exports = { buildCooking };
