// What each thing that raises somebody's output costs, and what it pays back.
//
// "Output" means anything that makes more Resources, more crops, more loot, more of a saleable thing per
// turn: a tool, a skill, a consumable, a building, a beast that lays eggs. Each row is derived from the
// same catalog and rules the rest of the report reads, so a price change or a rule change moves the row.
//
// Money is ¢ throughout. A ⬢ the maker MAKES is valued at rvMined (the midpoint of the Depot's two
// prices); a ⬢ the maker SPENDS is valued at the Depot's import price, which is what buying one costs.
// A Move given up is valued at `moveValue`, by default what an average mining turn pays, since that is
// what a Move would otherwise have made. Skill points are NOT converted to ¢, because they are a
// different budget (character creation and the /store); they are shown beside the payoff and as
// "¢ a turn per point" so the two can be compared without pretending they are the same thing.

const soilery = require("../../../lib/soilery");
const hungerLib = require("../../../lib/hunger");
const { FOODSTUFFS_SLUG } = require("../../../lib/constants");

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// `food` is the model's one food valuation and `unitValue` its ITEM_VALUE rule for a spent ingredient; a crop,
// a feed or a recipe input is priced through them and nowhere else.
function buildInvestments({ caving, trinkets, lucky: luckyUses, cooking: cookAnalysis, get, list, rv, rvMined, params, activities, producerDrops, profitTiers, pointsOf, moveValue, gameTurns, food, unitValue, tax = () => 0, miningRisk = null, combat = null, distilling = [], cavingArrivalsPerTurn = 1 }) {
  const rows = [];
  const byId = (id) => activities.find((a) => a.id === id);
  const shelfPrice = (t) => t?.depotPrice ?? null;
  const craftCoin = (t) => {
    const r = t?.requirement;
    if (!r) return null;
    let items = 0;
    for (const raw of r.items ?? []) {
      const slug = typeof raw === "string" ? raw : raw.tag ?? raw.anyOf?.[0];
      items += (typeof raw === "object" && raw.count ? raw.count : 1) * unitValue(slug);
    }
    return { coin: (r.resourceCost ?? 0) * rv.buy + items, moves: r.turnsCost ?? 0, resources: r.resourceCost ?? 0 };
  };
  // How long the thing lasts, read off the catalog: CONSUMED if the tag is `consumable` or opens into something
  // (`consumesInto`), so it is bought again for every use; DURABLE otherwise (equipment, a tool, a building, a skill,
  // an animal, a trait). A row with no tag behind it (a skill rung, a method) is durable.
  const lastsOf = (t) => {
    if (!t) return { kind: "durable", text: "durable" };
    const into = (t.consumesInto ?? []).length;
    return t.consumable || into ? { kind: "consumed", text: "one use" } : { kind: "durable", text: "durable" };
  };
  // What a row's gain rests on. Caving: the gain is a caver's ¢ an expedition under the trouble budget and the typed
  // band → mix table (combat.js, caving.js), or mood saved where the Caving Die rolls, and it carries that die's
  // risk. Production: mining, farming, refining, crafting, the Factory, a building, livestock — no risk beyond
  // fatigue. Trade: the gain is points or a shelf opened, not output. Mixed: more than one.
  // The table cell is the one word; what each word means is said once, above the table (report.js).
  const PAYS = { production: "production", caving: "caving", trade: "trade", mixed: "mixed" };
  const add = (r) => {
    const moves = r.moves ?? 0;
    const allIn = (r.coin ?? 0) + moves * moveValue;
    const gain = r.gain ?? null;
    const lasts = lastsOf(r.slug ? get(r.slug) : null);
    const pays = r.paysThrough ?? (r.valuedBy === "expedition" ? "caving" : "production");
    const consumed = lasts.kind === "consumed";
    // A consumed thing is bought every time it is used, so there is no one purchase to pay back and no "over the
    // game" total that subtracts one price: its gain a turn is already net of every use's price, and its return is
    // shown per use, ¢ back for each ¢ spent.
    const perUse = consumed && r.perUse ? { ...r.perUse, net: r.perUse.gross - r.perUse.price, backPerCoin: r.perUse.price > 0 ? r.perUse.gross / r.perUse.price : null } : null;
    rows.push({
      coin: 0,
      points: 0,
      moves: 0,
      ...r,
      allIn,
      gain,
      lasts: lasts.kind,
      lastsText: lasts.text,
      paysThrough: pays,
      paysText: r.paysText ?? PAYS[pays],
      perUse,
      paybackTurns: consumed ? null : gain != null && gain > 0 && allIn > 0 ? allIn / gain : gain != null && gain > 0 ? 0 : null,
      netOverGame: consumed ? null : gain != null ? gain * gameTurns - allIn : null,
      perPoint: consumed ? null : gain != null && r.points > 0 ? gain / r.points : null,
    });
  };

  // ---- mining --------------------------------------------------------------------------------------
  const caves = byId("mine:Caves:unskilled");
  const cavesSkilled = byId("mine:Caves:skilled");
  const depths = byId("mine:Depths:unskilled");
  const depthsSkilled = byId("mine:Depths:skilled");
  const duty = params.mineDuty;

  const pick = get("pickaxe");
  if (pick && caves) {
    const c = craftCoin(pick);
    add({
      id: "pickaxe",
      slug: "pickaxe",
      group: "Mining",
      name: pick.name,
      kind: "tool",
      does: `The gate on the Mine button, and +${pick.miningBonus?.amount ?? 1} ⬢ a press while worn.`,
      coin: shelfPrice(pick) ?? c.coin,
      coinHow: `${shelfPrice(pick)} ¢ at the Depot, or ${c.resources} ⬢ and ${c.moves} Move to smith`,
      points: pick.pointCost ?? 0,
      gain: caves.netPerTurn,
      gainHow: `a Caves miner's whole day, ${round1(caves.netPerTurn)} ¢ a turn; the worn +1 ⬢ is ${round1((pick.miningBonus?.amount ?? 1) * rvMined * duty)} of it`,
      note: "Without one you cannot mine at all, so this is the cheapest way into the most reliable income in the game.",
    });
  }
  const helmet = get("mining-helmet");
  if (helmet) {
    const bonus = helmet.miningBonus?.amount ?? 1;
    add({
      id: "mining-helmet",
      slug: "mining-helmet",
      group: "Mining",
      name: helmet.name,
      kind: "tool",
      does: `+${bonus} ⬢ a press while worn (head slot).`,
      coin: shelfPrice(helmet),
      coinHow: `${shelfPrice(helmet)} ¢ at the Depot`,
      points: helmet.pointCost ?? 0,
      gain: bonus * rvMined * duty,
      gainHow: `${bonus} ⬢ × ${round1(rvMined)} ¢ × a press every ${round1(1 / duty)} turns`,
      note: "Stacks with the pickaxe. The description says Prospecting, but the tag has no requirement, so anybody mining gets it.",
    });
  }
  const prospecting = get("prospecting");
  if (prospecting && caves && cavesSkilled) {
    add({
      id: "prospecting",
      slug: "prospecting",
      group: "Mining",
      name: prospecting.name,
      kind: "skill",
      does: `×${params.prospectingMultiplier} on the ⬢ a press, and a richer column on the loot table.`,
      coin: 0,
      coinHow: "no coin",
      points: prospecting.pointCost ?? 0,
      gain: cavesSkilled.netPerTurn - caves.netPerTurn,
      gainHow: `Caves ${round1(cavesSkilled.netPerTurn)} against ${round1(caves.netPerTurn)}; Depths +${round1(depthsSkilled.netPerTurn - depths.netPerTurn)}`,
      note: "The gain is bigger on richer ground, and this figure is the Caves'.",
    });
  }

  // ---- Distilling ------------------------------------------------------------------------------------
  // 3 points on top of Brewing II; doubles the stack of Alcohol and Moonshine from the same mash (the game's
  // DISTILLING_DOUBLES_SLUGS). The gain counted here is at the counter, where only Moonshine sells; Alcohol's
  // is a ceiling at the Black Market's shelf price and goes in the note, not the figure.
  const distillTag = get("brewing-distilling");
  if (distillTag && distilling.length) {
    const counter = distilling.filter((d) => !d.ceiling);
    const ceiling = distilling.filter((d) => d.ceiling);
    const best = counter.sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0];
    add({
      id: "distilling",
      slug: "brewing-distilling",
      group: "Skill rungs",
      name: distillTag.name,
      kind: "skill",
      does: `Twice the stack of ${distilling.map((d) => d.name).join(" and ")} from the same mash, Move and ⬢.`,
      coin: 0,
      coinHow: "no coin",
      points: distillTag.pointCost ?? 0,
      gain: best ? best.gain : 0,
      gainHow: best ? `${best.name}: ${round1(best.net)} ¢ a Move against ${round1(best.plainNet)} without it, at the counter` : "nothing it doubles sells at the counter",
      note: ceiling.length ? `${ceiling.map((d) => `${d.name} never reaches the counter; at the Black Market's shelf price a distilled brewer would clear ${round1(d.net)} ¢ a Move against ${round1(d.plainNet)}`).join("; ")} — a ceiling, since nothing in the game sells a drink for you.` : "",
    });
  }

  // ---- cracking metals for ⬢ -----------------------------------------------------------------------
  // An ingot (or silver, platinum, an arelitz egg) can be consumed for ⬢ instead of sold. A prospector's
  // ore is an ingot away from that, and the smelt costs a quarter Move that fits in the rest turn a miner
  // has anyway. Value = ⬢ landed at the mined rate, less what the same ore would have sold for raw.
  const wsTag = get("workshop-equipment");
  const smithing = get("smithing");
  if (cavesSkilled && wsTag) {
    const table = producerDrops?.prospecting?.caves?.skilled ?? [];
    let extra = 0;
    const lines = [];
    for (const d of table) {
      // The ingot the ore smelts into, or the drop itself if it is already something worth cracking.
      const ingot = list.find((t) => t.craftable && (t.requirement?.items ?? []).some((i) => (typeof i === "string" ? i : i.tag) === d.slug) && (t.consumesIntoResources || t.sellablePrice != null && (t.requirement?.resourceCost ?? 0) === 0));
      const target = ingot ?? get(d.slug);
      const cir = target?.consumesIntoResources ?? 0;
      if (!ingot && !cir) continue;
      // Sold to the counter or cracked for ⬢, whichever is better.
      // A counter sale pays the run's sell tax; cracking for ⬢ is not a sale.
      const value = Math.max((target?.sellablePrice ?? 0) - tax(target?.sellablePrice ?? 0), cir * rvMined);
      const oreNet = d.unit - tax(d.unit); // the raw ore sold instead pays the tax too
      if (!(value > oreNet)) continue;
      extra += d.p * (value - oreNet);
      lines.push(`${d.name} → ${target.name} ${round1(value)} ¢`);
    }
    const c = craftCoin(wsTag);
    add({
      id: "crack-metals",
      group: "Metals",
      name: "Smelt ore into ingots",
      kind: "skill + kit",
      does: `Ore smelts into an ingot, sold to the counter or cracked for ⬢, whichever pays more (${lines.join(", ")}).`,
      coin: shelfPrice(wsTag) ?? c.coin,
      coinHow: `Workshop Equipment, ${shelfPrice(wsTag)} ¢ (or a Forge, if one stands where you are)`,
      points: smithing?.pointCost ?? 0,
      gain: extra * duty,
      gainHow: `${round1(extra)} ¢ a press over selling the ore raw, on a rest turn`,
      note: "A Prospector's ore is 18–21% of presses each, and the ore is the bottleneck, so this is capped by the ground and not by the bar's price. The smelt is a quarter Move on the turn a miner cannot mine.",
    });
  }

  // ---- forging what you dig up into Trinkets --------------------------------------------------------
  if (trinkets && wsTag && cavesSkilled) {
    const plain = trinkets.prospector["caves:plain"].apprentice;
    const skilledRow = trinkets.prospector["caves:skilled"]["skilled"];
    add({
      id: "forge-trinkets",
      group: "Metals",
      name: "Forge your own stones into Trinkets",
      kind: "skill + kit",
      does: `Every two stones a miner digs up become a Trinket for ${trinkets.dieCost} ¢ of ⬢ and a rest-turn Move, and sell for ${trinkets.holders[0].eBase.toFixed(0)}–${trinkets.holders[1].eBase.toFixed(0)} ¢ bare plus about ${trinkets.holders[0].eMult.toFixed(2)}–${trinkets.holders[1].eMult.toFixed(2)} times the stones' inlay.`,
      coin: shelfPrice(wsTag) ?? craftCoin(wsTag).coin,
      coinHow: `Workshop Equipment, ${shelfPrice(wsTag)} ¢ (or a Forge), and ${trinkets.dieCost} ¢ of ⬢ a Trinket`,
      points: smithing?.pointCost ?? 0,
      gain: plain.net * duty,
      gainHow: `${round1(plain.net)} ¢ a press over selling the stones raw, at the Caves with a pick (${round1(skilledRow.net)} ¢ with Prospecting and Smithing II), a press every ${round1(1 / duty)} turns`,
      note: "This uses the same ore as smelting, so it replaces that row rather than adding to it. It needs a Move on the rest turn for every two stones, about a quarter of a Move a turn.",
    });
  }

  // ---- farming ------------------------------------------------------------------------------------
  const soil = get("soilery");
  const farm = byId(`farm:${params.stapleCrop}`);
  if (soil && farm) {
    add({
      id: "soilery",
      slug: "soilery",
      group: "Farming",
      name: soil.name,
      kind: "skill",
      does: `Lets you plant up to ${params.farmMaxCrops} crops, one Farm action every ${params.farmCycle} turns.`,
      coin: 0,
      coinHow: "no coin; nothing is spent to sow",
      points: soil.pointCost ?? 0,
      gain: farm.netPerTurn,
      gainHow: `${round1(farm.perAction)} ¢ a Farm action (${params.cropsSell ? "Foodstuffs at the counter's price" : "Foodstuffs valued as food, at the Ration Box's rate for hunger and mood"}), one turn in ${params.farmCycle}`,
      note: "Farming is for eating, not selling, so at the counter it is worth far less than the same crops are to a hungry buyer.",
    });
    const fert = get("fertilizer");
    if (fert) {
      // The share of a full field that comes in, without and with it.
      const full = params.farmMaxCrops * params.cropsPerPlant;
      const plain = params.harvestPerFarm / full;
      const fed = params.harvestPerFarmFert / full;
      const extraCrops = params.harvestPerFarmFert - params.harvestPerFarm;
      const perAction = extraCrops * params.cropValue - (shelfPrice(fert) ?? 0);
      add({
        id: "fertilizer",
        slug: "fertilizer",
        perUse: { gross: extraCrops * params.cropValue, price: shelfPrice(fert) ?? 0, usesPerTurn: farm.duty, unit: "Farm action" },
        group: "Farming",
        name: fert.name,
        kind: "consumable",
        does: `No wither roll, and a 1-in-${soilery.BOUNTY_IN} chance of a double crop, for one Farm action.`,
        coin: shelfPrice(fert),
        coinHow: `${shelfPrice(fert)} ¢ a sack at the Depot, used up each time`,
        points: fert.pointCost ?? 0,
        gain: perAction * farm.duty,
        gainHow: `+${round1(extraCrops)} crops a Farm action (${round1(plain * 100)}% → ${round1(fed * 100)}% of a full harvest), less the sack`,
        note: "Used up by every Farm action, so a sack is bought each time: the ¢ a turn is already net of every sack, and the return is per use. It used to be paid back against one sack over the game, which counted the sack once too many.",
      });
    }
  }

  // There is no cash crop left to fertilize twice over: Foodstuffs is the only crop, and the "farming"
  // Fertilizer row above already covers it.

  // ---- loot rolls ----------------------------------------------------------------------------------
  const lucky = get("lucky");
  if (lucky && caving) {
    // The headline is a Depths caver making four arrivals a turn, the one use whose gain is money and whose
    // frequency a player controls. The full ranking is in the Lucky section of the report.
    const dive = luckyUses?.uses.find((u) => u.id === "caving-depths-3");
    const forge = luckyUses?.uses.find((u) => u.id === "trinket-skilled-shelf");
    // Per expedition at a 3-trouble budget, and ASSUMED one expedition a turn (arrivals are rationed only by the walk
    // cooldown, and a 1 holds you in the zone but not still).
    const gain = dive?.gain ?? caving.perZone.caves.luckyGain * cavingArrivalsPerTurn;
    add({
      id: "lucky",
      slug: "lucky",
      group: "Loot rolls",
      valuedBy: "expedition",
      name: lucky.name,
      kind: "perk",
      does: "Rolls twice and keeps the better on twelve dice: the Caving Die (fewer 1s and more finds), every Gambit, forging a Trinket, pushing on, lessons, Search, Steal and more.",
      coin: 0,
      coinHow: "no coin",
      points: lucky.pointCost ?? 0,
      gain,
      gainHow: `${round1(gain)} ¢ an expedition for a Depths caver who stops at 3 troubles (${round1(luckyUses?.uses.find((u) => u.id === "caving-caves-3")?.gain)} at the Caves), taken as one expedition a turn. Forging pays ${round1(forge?.gain)}–${round1(luckyUses?.uses.find((u) => u.id === "trinket-apprentice-shelf")?.gain)} ¢ a Trinket with shelf stones`,
      note: "Most of it is avoiding a 1, so it depends on what a GM makes of trouble. The largest thing Lucky does is add about +1 to every Gambit, which has no ¢.",
    });
    // The same tag, for a smith who spends every Move buying stones off the shelf and forging them. It pays through
    // production, not caving: the only die is the forge's, and the skilled floor means it cannot lose.
    const pair = trinkets?.shelfLoop?.bestSkilledLucky;
    if (forge && pair) {
      add({
        id: "lucky-forge",
        slug: "lucky",
        group: "Metals",
        name: `${lucky.name}, for a smith on the shelf loop`,
        kind: "perk",
        does: `Keeps the better of two dice on the forge, so a Smithing II smith buying ${pair.stones.join(" and ")} off the shelf rolls a Masterwork 11 times in 36 instead of 6.`,
        coin: 0,
        coinHow: "no coin; the stones and ⬢ are already paid for by the loop",
        points: lucky.pointCost ?? 0,
        gain: forge.gain,
        gainHow: `${round1(forge.gain)} ¢ a Move over the same smith without Lucky (${round1(pair.skilled)} to ${round1(pair["skilled-lucky"])} ¢), one Trinket a turn`,
        note: "Only worth this to somebody already forging every turn with Smithing II and a way onto the Merchant's shelf. The two Lucky rows are the same tag counted two ways; nobody collects both in one turn.",
      });
    }
  }

  // ---- mood perks for somebody who works underground or in the wild ------------------------------------
  // What each saves a turn in mood, priced at the food valuation's ¢ a point (miningRisk.js, caving.js).
  if (miningRisk) {
    const cave = miningRisk.rows.find((r) => r.id === "mine:Caves:skilled");
    const troublesTurn = cave ? cave.arrivalsRolling * (cave.trouble ?? 0) * miningRisk.tripsPerTurn : 0;
    const perk = (slug, gain, gainHow, note, underground = true) => {
      const t = get(slug);
      if (!t || gain == null) return;
      // Underground, where the Caving Die rolls on arrival, the mood saved is a caving gain; in the wild it is not.
      const pays = underground ? "caving" : "production";
      const paysText = `${pays}, mood`;
      add({ id: slug, slug, group: "Mood", valuedBy: "mood", paysThrough: pays, paysText, name: t.name, kind: "perk", does: t.description ?? "", coin: 0, coinHow: "no coin", points: pointsOf(slug), gain, gainHow, note });
    };
    if (cave) {
      perk("spelunker", cave.moodTurn - cave.moodTurnImmune, `${round1(cave.moodTurn)} ¢ of cave mood a turn for a Prospector at the Caves, sleeping underground, to ${round1(cave.moodTurnImmune)}`, "The points include what it requires. It cancels the ambient cave hit, not the Caving Die's trouble.");
      const troubleSave = troublesTurn * (caving.troubleMood.plain - caving.troubleMood.brave);
      perk("brave", cave.moodTurn - cave.moodTurnBrave + troubleSave, `${round1(cave.moodTurn - cave.moodTurnBrave)} ¢ of cave mood and ${round1(troubleSave)} ¢ of trouble mood a turn for the same Prospector; it halves every other fright too, unpriced here`, "Measured on a miner; anybody who is often frightened gets more.");
    }
    const g = miningRisk.rows.find((r) => r.placeClass === "WILDERNESS");
    if (g) perk("outsider", g.moodTurn - g.moodTurnImmune, `${round1(g.moodTurn)} ¢ of wilderness mood a turn for a gatherer in the ${g.name.replace(/^Gather — /, "").replace(/, no tool$/, "")}, to ${round1(g.moodTurnImmune)}`, "Only the wilderness hit; it does nothing underground.", false);
  }

  // ---- fighting tags and weapons, priced for a caver --------------------------------------------------------
  // Only the ones that move the band on their own; the ¢ is what that step is worth to a Depths caver who stops at
  // the combat tab's trouble budget, under the caving tab's band → trouble mix, which is an ASSUMPTION.
  for (const r of (combat?.tags ?? []).filter((x) => x.steps > 0)) {
    add({
      id: `fight-${r.slug}`,
      slug: r.slug,
      group: "Fighting",
      valuedBy: "expedition",
      name: r.name,
      kind: r.kind,
      // The band words are the sheet's; the method behind the gain is said once above the table (report.js).
      does: `${r.tree[0].toUpperCase()}${r.tree.slice(1)}: ${combat.base[r.tree]} → ${r.alone}`,
      coin: r.coin ?? 0,
      coinHow: r.coin != null ? `${r.coin} ¢ at the ${r.coinHow}` : "no coin",
      // A rung's gain is its own step over the rung below, so it costs its own points.
      points: r.isRung ? r.ownPoints : r.points,
      gain: r.caverGain,
      gainHow: r.isRung
        ? `${round1(r.caverGain)} ¢ an expedition, over the rung below`
        : `${round1(r.caverGain)} ¢ an expedition: ${[r.gainFromUntrained, r.gainFromI, r.gainFromII].map((g) => (g == null ? "—" : round1(g))).join(" / ")} from untrained / I / II`,
      note: "The mix that turns a band into fewer bad wounds is an assumption pending a real mechanic (caving.js MIX_BY_BAND).",
    });
  }

  // ---- livestock ----------------------------------------------------------------------------------
  const arelitz = get("arelitz");
  const egg = get("arelitz-egg");
  if (arelitz && egg) {
    const feedUnits = 2;
    // The stable eats whatever food is on the floor (db/lib/stablePass.js); Foodstuffs is the one crop now.
    const cheapestFood = food.of(get(FOODSTUFFS_SLUG));
    const eggValue = Math.max((egg.sellablePrice ?? 0) - tax(egg.sellablePrice ?? 0), (egg.consumesIntoResources ?? 0) * rvMined);
    add({
      id: "arelitz",
      slug: "arelitz",
      group: "Livestock",
      name: arelitz.name,
      kind: "animal",
      does: `Each adult in a Stable that gets ${feedUnits} food a turn lays an egg (sells for ${egg.sellablePrice} ¢, or cracks into ${egg.consumesIntoResources} ⬢).`,
      coin: shelfPrice(arelitz),
      coinHow: `${shelfPrice(arelitz)} ¢ each`,
      points: 0,
      gain: eggValue - feedUnits * cheapestFood,
      gainHow: `${eggValue} ¢ an egg less ${feedUnits} × ${round1(cheapestFood)} ¢ of feed, with no Move spent`,
      note: `A Stable is meant to hold ${params.stableCapacity} in all, adults and young, though the pass only evicts past that when an overflow room is configured (db/lib/stablePass.js), so the cap is soft. At the cap one Stable is worth about ${round1((eggValue - feedUnits * cheapestFood) * params.stableCapacity)} ¢ a turn at most, and it is shared. 1 egg in 30 hatches each turn it sits on the floor, and someone has to walk the eggs to the Depot.`,
    });
  }

  // ---- buildings ----------------------------------------------------------------------------------
  const builderPts = pointsOf("builder-skilled");
  const buildCost = (t) => {
    const c = craftCoin(t);
    return { coin: c.coin, moves: c.moves, resources: c.resources };
  };
  const brewery = get("brewery");
  const alcohol = get("alcohol");
  if (brewery) {
    const c = buildCost(brewery);
    const y = brewery.placement?.yields ?? {};
    const value = shelfPrice(alcohol) ?? 0;
    add({
      id: "brewery",
      slug: "brewery",
      group: "Buildings",
      name: brewery.name,
      kind: "building",
      does: `Pours ${y.quantity ?? 1} ${alcohol?.name ?? "alcohol"} a turn onto the inn cellar floor while somebody with ${y.skill} stands in the Location.`,
      coin: c.coin,
      moves: c.moves,
      coinHow: `${c.resources} ⬢ and ${c.moves} Moves to build (Builder-Skilled, ${builderPts} pt)`,
      points: builderPts,
      gain: value * (y.quantity ?? 1),
      gainHow: `${value} ¢ a turn, what the Depot's Black Market charges for the same drink`,
      note: `Only at the Old Cock Inn, and it needs a brewer on hand. The cask is worth about ${round1(value - (alcohol ? craftCoin(alcohol).coin : 0))} ¢ over the ingredients it would cost to brew it yourself.`,
    });
  }
  const forge = get("forge");
  if (forge && wsTag) {
    const c = buildCost(forge);
    const wsCoin = shelfPrice(wsTag) ?? craftCoin(wsTag).coin;
    add({
      id: "forge",
      slug: "forge",
      group: "Buildings",
      name: forge.name,
      kind: "building",
      does: "Serves as Workshop Equipment to everyone standing in its Location, permanently.",
      coin: c.coin,
      moves: c.moves,
      coinHow: `${c.resources} ⬢ and ${c.moves} Moves to build (Builder-Skilled, ${builderPts} pt)`,
      points: builderPts,
      gain: null,
      gainHow: `${wsCoin} ¢ saved once for every smith it serves who would otherwise buy their own kit`,
      note: `Pays for itself the first time a smith uses it. A Forge saves ${wsCoin} ¢ a head, and it has no upkeep.`,
      oneOff: true,
      breakEvenUsers: Math.max(1, Math.ceil((c.coin + c.moves * moveValue) / wsCoin)),
    });
  }
  if (wsTag) {
    // At the run's sell tax, as the model measured it recipe by recipe (the rung's median).
    const floor = profitTiers.find((t) => t.points === 5);
    const skilled = profitTiers.find((t) => t.points === 10);
    const wsCoin = shelfPrice(wsTag) ?? craftCoin(wsTag).coin;
    add({
      id: "workshop-equipment",
      slug: "workshop-equipment",
      group: "Buildings",
      name: `${wsTag.name} (your own)`,
      kind: "tool",
      does: "The forge every smithing recipe needs within reach, carried.",
      coin: wsCoin,
      coinHow: `${wsCoin} ¢ at the Depot, or ${wsTag.requirement?.resourceCost} ⬢ and ${wsTag.requirement?.turnsCost} Moves to smith`,
      points: smithing?.pointCost ?? 0,
      gain: skilled ? skilled.netMedian : null,
      gainHow: `the median 10-point recipe at a ${params.sellTaxRate}% sell tax, ${round1(skilled?.netMedian)} ¢ a Move (${round1(floor?.netMedian)} at 5 points); the real money is above the floor`,
      note: "At the floor this is a slow payback. It is the price of being able to smith at all.",
    });
  }

  // ---- skill rungs ----------------------------------------------------------------------------------
  const tiers = profitTiers.filter((t) => t.rate != null);
  // What a rung's recipes clear at the run's sell tax, measured recipe by recipe in the model (the median recipe).
  const real = (t) => t.netMedian;
  let prev = null;
  for (const t of tiers) {
    const label = { 2: "Crafting", 5: "Smithing / basic brewing", 10: "Skilled smithing / brewing", 15: "Expert brewing", 19: "Gunpowder" }[t.points] ?? `${t.points}-point rung`;
    add({
      id: `rung-${t.points}`,
      group: "Skill rungs",
      name: label,
      kind: "skill",
      does: `Unlocks recipes priced to clear ${t.rate} ¢ a Move before tax; the median one clears ${round1(real(t))} at a ${params.sellTaxRate}% sell tax.`,
      coin: 0,
      coinHow: "no coin",
      points: t.points - (prev?.points ?? 0),
      gain: real(t) - (prev ? real(prev) : 0),
      gainHow: prev ? `+${round1(real(t) - real(prev))} ¢ a Move over the ${prev.points}-point rung at a ${params.sellTaxRate}% sell tax, for the ${t.points - prev.points} extra points` : `${round1(real(t))} ¢ a Move at a ${params.sellTaxRate}% sell tax`,
      note: "The floor only. Selling above it is where a crafter actually earns.",
    });
    prev = t;
  }

  // ---- perks that pay you back for lower output -------------------------------------------------------
  const lazy = get("lazy");
  const soft = get("soft-hands");
  if (lazy && caves) {
    add({
      id: "lazy",
      slug: "lazy",
      group: "Trade-offs",
      name: lazy.name,
      kind: "perk",
      does: "Takes a quarter off the ⬢ that land, rounded down.",
      coin: 0,
      coinHow: "gives back points",
      points: lazy.pointCost ?? 0,
      gain: -0.25 * caves.resourcesPerPress * rvMined * duty,
      gainHow: `${round1(-0.25 * caves.resourcesPerPress * rvMined * duty)} ¢ a turn of Caves mining`,
      note: "Points taken back buy output elsewhere at the rates above.",
    });
  }
  if (soft && caves) {
    add({
      id: "soft-hands",
      slug: "soft-hands",
      group: "Trade-offs",
      name: soft.name,
      kind: "perk",
      does: "Halves what you make when laboring, after tools.",
      coin: 0,
      coinHow: "gives back points",
      points: soft.pointCost ?? 0,
      gain: -0.5 * caves.resourcesPerPress * rvMined * duty,
      gainHow: `${round1(-0.5 * caves.resourcesPerPress * rvMined * duty)} ¢ a turn of Caves mining`,
      note: "Points taken back buy output elsewhere at the rates above.",
    });
  }

  // ---- butchering -----------------------------------------------------------------------------------
  const butcher = get("butcher");
  const bodies = producerDrops?.butcher ?? [];
  if (butcher && bodies.length) {
    const best = [...bodies].sort((a, b) => b.revenue - a.revenue)[0];
    const worst = [...bodies].sort((a, b) => a.revenue - b.revenue)[0];
    add({
      id: "butcher",
      slug: "butcher",
      group: "Loot rolls",
      name: butcher.name,
      kind: "skill",
      does: "Lets you take a body apart for its parts and hides. A free action, so it costs no Move.",
      coin: 0,
      coinHow: "no coin",
      points: butcher.pointCost ?? 0,
      gain: null,
      gainHow: `${worst.revenue} ¢ a body (${worst.name}) up to ${best.revenue} ¢ (${best.name}), one time per body`,
      note: "Limited by how many bodies there are, not by time, so it has no ¢ a turn. Human bodies are the deaths of players and Mutilate is a coin faucet on purpose priced low (DEPOT.md §4).",
      oneOff: true,
    });
  }

  // ---- scanned, with no output to count -----------------------------------------------------------------
  const counted = new Set(["brewery", "forge"]);
  const scanned = list
    .filter((t) => t.placement && !counted.has(t.slug))
    .map((t) => {
      const c = craftCoin(t);
      const p = t.placement;
      const effect = p.provides ? `provides ${p.provides.join(", ")}` : p.defenseNote ?? (p.birdSendsPerDay ? `${p.birdSendsPerDay} bird sends a day` : p.music ? `music, mood +${p.music.mood}` : p.inscribable ? "an inscribed marker" : "no effect on output");
      return { slug: t.slug, name: t.name, coin: c?.coin ?? 0, moves: c?.moves ?? 0, resources: c?.resources ?? 0, effect };
    });

  rows.sort((a, b) => (a.group === b.group ? 0 : 0));
  return { rows, scanned, moveValue, assumptions: { cavingArrivalsPerTurn, duty } };
}

module.exports = { buildInvestments };
