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
const { cutOn } = require("./cut");

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

function buildInvestments({ caving, trinkets, lucky: luckyUses, cooking: cookAnalysis, get, list, rv, rvMined, params, activities, producerDrops, profitTiers, pointsOf, moveValue, gameTurns, cavingArrivalsPerTurn = 1 }) {
  const rows = [];
  const byId = (id) => activities.find((a) => a.id === id);
  const shelfPrice = (t) => t?.depotPrice ?? null;
  const craftCoin = (t) => {
    const r = t?.requirement;
    if (!r) return null;
    let items = 0;
    for (const raw of r.items ?? []) {
      const slug = typeof raw === "string" ? raw : raw.tag ?? raw.anyOf?.[0];
      items += (typeof raw === "object" && raw.count ? raw.count : 1) * (get(slug)?.depotPrice ?? get(slug)?.sellablePrice ?? 0);
    }
    return { coin: (r.resourceCost ?? 0) * rv.buy + items, moves: r.turnsCost ?? 0, resources: r.resourceCost ?? 0 };
  };
  const add = (r) => {
    const moves = r.moves ?? 0;
    const allIn = (r.coin ?? 0) + moves * moveValue;
    const gain = r.gain ?? null;
    rows.push({
      coin: 0,
      points: 0,
      moves: 0,
      ...r,
      allIn,
      gain,
      paybackTurns: gain != null && gain > 0 && allIn > 0 ? allIn / gain : gain != null && gain > 0 ? 0 : null,
      netOverGame: gain != null ? gain * gameTurns - allIn : null,
      perPoint: gain != null && r.points > 0 ? gain / r.points : null,
    });
  };

  // ---- mining --------------------------------------------------------------------------------------
  const caves = byId("mine:Caves:unskilled");
  const cavesSkilled = byId("mine:Caves:skilled");
  const depths = byId("mine:Depths:unskilled");
  const depthsSkilled = byId("mine:Depths:skilled");
  const duty = caves?.duty ?? 0.5;

  const pick = get("pickaxe");
  if (pick && caves) {
    const c = craftCoin(pick);
    add({
      id: "pickaxe",
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
      const value = Math.max(target?.sellablePrice ?? 0, cir * rvMined);
      if (!(value > d.unit)) continue;
      extra += d.p * (value - d.unit);
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
  const farm = byId("farm:potato");
  if (soil && farm) {
    add({
      id: "soilery",
      group: "Farming",
      name: soil.name,
      kind: "skill",
      does: `Lets you plant up to ${params.farmMaxCrops} plants on a field, one Farm action every ${params.farmCycle} turns.`,
      coin: 0,
      coinHow: "no coin; seed bags are 4 ¢ an action and are in the gain",
      points: soil.pointCost ?? 0,
      gain: farm.netPerTurn,
      gainHow: `${round1(farm.perAction)} ¢ a Farm action (${params.cropsSell ? "crops at the counter's price" : "crops valued as food, at the Ration Box's price per hunger"}, less seed), a third of the turns`,
      note: "Farming is for eating, not selling, so at the counter it is worth far less than the same crops are to a hungry buyer.",
    });
    const fert = get("fertilizer");
    if (fert) {
      const per = params.farmMaxCrops * (params.cropsPerPlant ?? 1);
      const plain = (soilery.WITHER_IN - 1) / soilery.WITHER_IN;
      const fed = 1 + 1 / soilery.BOUNTY_IN;
      const cropValue = params.cropValue ?? get("potato")?.sellablePrice ?? 1;
      const extraCrops = per * (fed - plain);
      const perAction = extraCrops * cropValue - (shelfPrice(fert) ?? 0);
      add({
        id: "fertilizer",
        group: "Farming",
        name: fert.name,
        kind: "consumable",
        does: `No wither roll, and a 1-in-${soilery.BOUNTY_IN} chance of a double harvest per plant, for one Farm action.`,
        coin: shelfPrice(fert),
        coinHow: `${shelfPrice(fert)} ¢ a sack at the Depot, used up each time`,
        points: fert.pointCost ?? 0,
        gain: perAction * farm.duty,
        gainHow: `+${round1(extraCrops)} crops a Farm action (${round1(plain * 100)}% → ${round1(fed * 100)}% of a full harvest), less the sack`,
        note: "A running cost, so it is measured per Farm action: it repays itself the first time.",
        oneOff: true,
      });
    }
  }

  // Fertilizer on the one crop that pays cash.
  if (cookAnalysis?.tobacco && get("fertilizer")) {
    const tb = cookAnalysis.tobacco;
    const fert = get("fertilizer");
    add({
      id: "fertilizer-tobacco",
      group: "Farming",
      name: "Fertilizer, on tobacco",
      kind: "consumable",
      does: `Stops the wither die (1 plant in ${tb.witherIn} fails) and doubles a plant 1 time in ${soilery.BOUNTY_IN}, for one Farm action of tobacco.`,
      coin: shelfPrice(fert),
      coinHow: `${shelfPrice(fert)} ¢ a sack, used up each time`,
      points: fert.pointCost ?? 0,
      gain: tb.fertGainPerAction / (params.farmCycle ?? 3),
      gainHow: `+${round1(tb.leavesFert - tb.leaves)} leaves at ${tb.price} ¢, less the sack: +${round1(tb.fertGainPerAction)} ¢ a Farm action, on top of ${round1(tb.perTurn)} ¢ a turn without it`,
      note: "Measured per turn across the 3-turn lockout. It repays itself many times over the first time.",
      oneOff: true,
    });
  }

  // ---- loot rolls ----------------------------------------------------------------------------------
  const lucky = get("lucky");
  if (lucky && caving) {
    // The headline is a Depths caver making four arrivals a turn, the one use whose gain is money and whose
    // frequency a player controls. The full ranking is in the Lucky section of the report.
    const dive = luckyUses?.uses.find((u) => u.id === "caving-depths-4");
    const forge = luckyUses?.uses.find((u) => u.id === "trinket-skilled-25");
    const gain = dive?.gain ?? caving.perZone.caves.luckyGain * cavingArrivalsPerTurn;
    add({
      id: "lucky",
      group: "Loot rolls",
      name: lucky.name,
      kind: "perk",
      does: "Rolls twice and keeps the better on twelve dice: the Caving Die (a find 1 in 6 → 11 in 36, trouble 1 in 6 → 1 in 36), every Gambit, forging a Trinket, pushing on, lessons, Search, Steal and more.",
      coin: 0,
      coinHow: "no coin",
      points: lucky.pointCost ?? 0,
      gain,
      gainHow: `${round1(gain)} ¢ a turn for a Depths caver at four arrivals a turn (${round1(luckyUses?.uses.find((u) => u.id === "caving-caves-4")?.gain)} at the Caves). Forging pays ${round1(forge?.gain)}–${round1(luckyUses?.uses.find((u) => u.id === "trinket-apprentice-25")?.gain)} ¢ a Trinket with shelf stones. The one-arrival figure this table used before was ${round1(luckyUses?.uses.find((u) => u.id === "caving-caves-1")?.gain)} ¢`,
      note: "Most of it is avoiding a 1, so it depends on what a GM makes of trouble. The largest thing Lucky does is add about +1 to every Gambit, which has no ¢.",
    });
  }

  // ---- livestock ----------------------------------------------------------------------------------
  const arelitz = get("arelitz");
  const egg = get("arelitz-egg");
  if (arelitz && egg) {
    const feedUnits = 2;
    const cheapestFood = Math.min(...["potato", "wheat", "carrot"].map((s) => get(s)?.sellablePrice ?? 1));
    const eggValue = Math.max(egg.sellablePrice ?? 0, (egg.consumesIntoResources ?? 0) * rvMined);
    add({
      id: "arelitz",
      group: "Livestock",
      name: arelitz.name,
      kind: "animal",
      does: `Each adult in a Stable that gets ${feedUnits} food a turn lays an egg (sells for ${egg.sellablePrice} ¢, or cracks into ${egg.consumesIntoResources} ⬢).`,
      coin: shelfPrice(arelitz),
      coinHow: `${shelfPrice(arelitz)} ¢ each`,
      points: 0,
      gain: eggValue - feedUnits * cheapestFood,
      gainHow: `${eggValue} ¢ an egg less ${feedUnits} × ${cheapestFood} ¢ of feed, with no Move spent`,
      note: `A Stable holds ${params.stableCapacity ?? 10} in all, adults and young, so one Stable is worth about ${round1((eggValue - feedUnits * cheapestFood) * (params.stableCapacity ?? 10))} ¢ a turn at most, and it is shared. 1 egg in 30 hatches each turn it sits on the floor, and someone has to walk the eggs to the Depot.`,
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
      note: `Only at the Old Cock Inn, and it needs a brewer on hand. The cask is worth about ${round1(value - (get("wheat")?.sellablePrice ?? 1) * 2)} ¢ over the two crops it would cost to brew it yourself.`,
    });
  }
  const forge = get("forge");
  if (forge && wsTag) {
    const c = buildCost(forge);
    const wsCoin = shelfPrice(wsTag) ?? craftCoin(wsTag).coin;
    add({
      id: "forge",
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
    const floor = profitTiers.find((t) => t.points === 5);
    const skilled = profitTiers.find((t) => t.points === 10);
    const wsCoin = shelfPrice(wsTag) ?? craftCoin(wsTag).coin;
    add({
      id: "workshop-equipment",
      group: "Buildings",
      name: `${wsTag.name} (your own)`,
      kind: "tool",
      does: "The forge every smithing recipe needs within reach, carried.",
      coin: wsCoin,
      coinHow: `${wsCoin} ¢ at the Depot, or ${wsTag.requirement?.resourceCost} ⬢ and ${wsTag.requirement?.turnsCost} Moves to smith`,
      points: smithing?.pointCost ?? 0,
      gain: skilled ? skilled.rate - cutOn(skilled.rate) : null,
      gainHow: `the Merchant's floor for a 10-point smith after his cut, ${round1(skilled ? skilled.rate - cutOn(skilled.rate) : null)} ¢ a Move (${round1(floor ? floor.rate - cutOn(floor.rate) : null)} at 5 points); the real money is above the floor`,
      note: "At the floor this is a slow payback. It is the price of being able to smith at all.",
    });
  }

  // ---- skill rungs ----------------------------------------------------------------------------------
  const tiers = profitTiers.filter((t) => t.rate != null);
  // A rung's rate is what a one-Move craft clears before the Merchant's cut; this is what is left of it.
  const real = (r) => r - cutOn(r);
  let prev = null;
  for (const t of tiers) {
    const label = { 2: "Crafting", 5: "Smithing / basic brewing", 10: "Skilled smithing / brewing", 15: "Expert brewing", 19: "Gunpowder" }[t.points] ?? `${t.points}-point rung`;
    add({
      id: `rung-${t.points}`,
      group: "Skill rungs",
      name: label,
      kind: "skill",
      does: `Unlocks recipes that clear ${t.rate} ¢ a Move before the Merchant's cut and ${round1(real(t.rate))} after it.`,
      coin: 0,
      coinHow: "no coin",
      points: t.points - (prev?.points ?? 0),
      gain: real(t.rate) - (prev ? real(prev.rate) : 0),
      gainHow: prev ? `+${round1(real(t.rate) - real(prev.rate))} ¢ a Move over the ${prev.points}-point rung after the cut, for the ${t.points - prev.points} extra points` : `${round1(real(t.rate))} ¢ a Move after the cut`,
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
      group: "Trade-offs",
      name: lazy.name,
      kind: "perk",
      does: "Cuts the ⬢ that land by a quarter, rounded down.",
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
