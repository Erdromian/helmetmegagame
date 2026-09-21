// The Caving Die, worked out: what a find is worth, what a 1 costs, and what Lucky and the other dice
// tags change. Everything is read from the game's own code and catalog (db/lib/cavingLoot.js,
// db/lib/cavingPass.js, db/lib/advantage.js, docs/tags.yaml), so a table change or a price change moves
// the numbers.
//
// THE DIE: a flat d6 on every arrival in a cave zone. 1 is TROUBLE (a GM adjudicates; nothing applies
// by itself), 6 is a FIND (a loot draw), 2-5 is nothing. The loot is in `cavingLoot.js`, drawn by a
// tier column for the zone and then uniformly within the tier.
//
// DANGER is the GM's call, so the wound mix below is an ASSUMPTION written down, not a rule. The
// economic cost of a wound is what it takes to heal it, read off the cure ladder (TAGS.md §5c).

const fs = require("fs");
const path = require("path");
const cavingLoot = require("../../../lib/cavingLoot");

const REPO = path.resolve(__dirname, "../../../..");
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// What happens on a 1, as a share of troubles. The user's brief: at least a minor wound anywhere in the
// caves, and in the depths more likely a major wound, a lost limb or a death. Nothing in code decides
// this; a GM does, per roll, from the `cavingmonsters` document.
const TROUBLE_MIX = {
  caves: { minor: 0.8, major: 0.15, limb: 0.04, death: 0.01 },
  depths: { minor: 0.2, major: 0.4, limb: 0.25, death: 0.15 },
};

// Which catalog tags stand for each kind of hurt. The cost is read off the tags, not typed in.
const WOUND_TAGS = {
  minor: { cures: ["deep-wound", "broken-bone"], label: "Minor wound", what: "a deep wound or a broken bone (cure rung 3)" },
  major: { cures: ["gut-wound", "punctured-lung"], label: "Major wound", what: "a gut wound or a punctured lung (cure rung 6)" },
  limb: { prosthetics: ["wooden-leg", "prosthetic-hand"], label: "Lost limb", what: "a wooden leg or a prosthetic hand off the shelf" },
  death: { label: "Death", what: "no cure; the character is gone" },
};

function buildCaving({ get, list, rv, rvMined, sources, moveValue, activities, gameTurns }) {
  // ---- what a find is worth -------------------------------------------------------------------------
  const obolTag = get("obol");
  const grantValue = (entry) => {
    const slug = typeof entry === "string" ? entry : entry.slug;
    if (!slug) return 0;
    if (slug === "obol") return 1;
    const t = get(slug);
    return t?.sellablePrice ?? 0;
  };
  // What eating or opening it hands over: ⬢ at the mined rate, obols, and anything it turns into that sells.
  const consumeValue = (t) => {
    let v = (t.consumesIntoResources ?? 0) * rvMined;
    for (const e of t.consumesInto ?? []) {
      if (typeof e === "object" && e.oneOf) v += e.oneOf.reduce((s, o) => s + grantValue(o), 0) / e.oneOf.length;
      else v += grantValue(e);
    }
    return v;
  };
  const tierOf = new Map();
  for (const [tier, slugs] of Object.entries(cavingLoot.LOOT_TABLE)) for (const s of slugs) tierOf.set(s, tier);

  const worth = (slug) => {
    const t = get(slug);
    if (!t) return { value: 0, basis: "not in the catalog" };
    const sold = t.sellablePrice ?? 0;
    const cracked = consumeValue(t);
    if (sold > 0 || cracked > 0) {
      return cracked > sold ? { value: cracked, basis: "opened or consumed" } : { value: sold, basis: "sold to the Depot" };
    }
    // Not sold and not consumed for anything priced, but the Depot stocks it: worth about what it would
    // fetch at the 60% sell-back the shelf implies.
    if (t.depotPrice != null) return { value: 0.6 * t.depotPrice, basis: "estimated at 60% of the shelf price" };
    if (t.category === "skills") return { value: 0, basis: `grants a skill (${t.pointCost} pts), unpriced` };
    return { value: 0, basis: "unpriced (a tool, key or curiosity)" };
  };

  const zoneRows = (zone) => {
    const { dist } = sources.drops.caving[zone];
    const find = 1 / 6;
    return [...dist.entries()]
      .map(([slug, p]) => {
        const w = worth(slug);
        // An estimate is shown but kept out of the headline: it is a guess at what an unsellable item
        // would fetch, and one key or gun would otherwise carry a whole table.
        const estimated = /estimated/.test(w.basis);
        const firm = estimated ? 0 : w.value;
        return {
          slug,
          name: get(slug)?.name ?? slug,
          tier: tierOf.get(slug) ?? "?",
          pFind: p,
          pArrival: p * find,
          value: w.value,
          basis: w.basis,
          estimated,
          evFind: p * firm,
          evFindEstimated: estimated ? p * w.value : 0,
          evArrival: p * find * firm,
        };
      })
      .sort((a, b) => b.evFind + b.evFindEstimated - (a.evFind + a.evFindEstimated) || b.pFind - a.pFind);
  };

  const zones = {};
  for (const zone of ["caves", "depths"]) {
    const rows = zoneRows(zone);
    const evFind = rows.reduce((s, r) => s + r.evFind, 0);
    const evFindEstimated = rows.reduce((s, r) => s + r.evFindEstimated, 0);
    const unpricedShare = rows.filter((r) => r.value === 0).reduce((s, r) => s + r.pFind, 0);
    const estimatedShare = rows.filter((r) => /estimated/.test(r.basis)).reduce((s, r) => s + r.pFind, 0);
    const byTier = Object.keys(cavingLoot.LOOT_TABLE).map((tier) => {
      const inTier = rows.filter((r) => r.tier === tier);
      return {
        tier,
        pFind: inTier.reduce((s, r) => s + r.pFind, 0),
        evFind: inTier.reduce((s, r) => s + r.evFind, 0),
        items: inTier.length,
        unpriced: inTier.filter((r) => r.value === 0).length,
        evFindEstimated: inTier.reduce((s, r) => s + r.evFindEstimated, 0),
      };
    });
    zones[zone] = { rows, evFind, evFindEstimated, evArrival: evFind / 6, unpricedShare, estimatedShare, byTier };
  }

  // ---- what a 1 costs ---------------------------------------------------------------------------------
  const cureCost = (slugs) => {
    const costs = slugs.map((s) => {
      const r = get(s)?.requirement ?? {};
      return { materials: (r.resourceCost ?? 0) * rv.buy, moves: r.turnsCost ?? 0 };
    });
    const avg = (k) => costs.reduce((s, c) => s + c[k], 0) / costs.length;
    return { materials: avg("materials"), moves: avg("moves") };
  };
  const wounds = {};
  for (const [kind, def] of Object.entries(WOUND_TAGS)) {
    let materials = 0;
    let moves = 0;
    if (def.cures) ({ materials, moves } = cureCost(def.cures));
    if (def.prosthetics) materials = def.prosthetics.reduce((s, p) => s + (get(p)?.depotPrice ?? 0), 0) / def.prosthetics.length;
    wounds[kind] = {
      kind,
      label: def.label,
      what: def.what,
      materials,
      moves,
      // The medic's Move is priced the way every Move in this report is.
      total: materials + moves * moveValue,
    };
  }
  const troubleCost = (zone) => {
    const mix = TROUBLE_MIX[zone];
    const cost = Object.entries(mix).reduce((s, [k, share]) => s + share * wounds[k].total, 0);
    return { cost, mix };
  };

  // ---- the die, with and without Lucky ------------------------------------------------------------------
  const faces = {
    base: { find: 1 / 6, trouble: 1 / 6 },
    // Roll twice, keep the higher: a 6 needs one of two, a 1 needs both.
    lucky: { find: 1 - (5 / 6) ** 2, trouble: (1 / 6) ** 2 },
  };
  const arrivalsScenarios = [1, 4, 10];
  const perZone = {};
  for (const zone of ["caves", "depths"]) {
    const z = zones[zone];
    const t = troubleCost(zone);
    const build = (label) => {
      const f = faces[label];
      const loot = z.evFind * f.find;
      const danger = f.trouble * t.cost;
      const deaths = f.trouble * t.mix.death;
      return { label, pFind: f.find, pTrouble: f.trouble, loot, danger, net: loot - danger, deathsPerArrival: deaths };
    };
    perZone[zone] = { troubleCost: t.cost, mix: t.mix, base: build("base"), lucky: build("lucky") };
    perZone[zone].luckyGain = perZone[zone].lucky.net - perZone[zone].base.net;
    // The cost of one trouble at which the loot exactly pays for it.
    perZone[zone].breakEvenWound = z.evFind * faces.base.find / faces.base.trouble;
  }

  // ---- every tag that changes a roll ---------------------------------------------------------------------
  const rolls = auditRolls({ get });

  return {
    faces,
    zones,
    wounds,
    perZone,
    arrivalsScenarios,
    rolls,
    moveValue,
    gameTurns,
    assumptions: { TROUBLE_MIX, obolValue: obolTag ? 1 : 1 },
  };
}

// ---- roll audit -------------------------------------------------------------------------------------------
// Which dice a character rolls, which tags bend each, and by how much. The call sites are FOUND in the
// source, and any caller this file has not labelled is reported, so a die somebody adds next month
// shows up here as "unlabelled" instead of going missing.
const DICE = {
  "db/lib/cavingPass.js": { die: "Caving Die", what: "a find on 6, trouble on 1" },
  "db/lib/gambitDie.js": { die: "Every Gambit", what: "the die a Move's Gambit rolls" },
  "db/lib/locationTravel.js": { die: "Pushing on across a zone", what: "the exertion die: 1 hurts, 2-3 tires" },
  "db/lib/search.js": { die: "Search", what: "the reveal die" },
  "db/lib/confession.js": { die: "Confession", what: "the penitent's die" },
  "db/lib/lessons.js": { die: "A lesson", what: "the learner's die" },
  "web/app/(app)/character/trinketActions.js": { die: "Forging a Trinket", what: "the forge's die" },
  "web/app/(app)/character/actions/misc.js": { die: "Break Restraints and Torture", what: "the escape die and the torture die" },
  "web/app/(app)/character/actions/steal.js": { die: "Steal", what: "the steal die" },
  "web/app/(app)/character/actions/pickpocket.js": { die: "Pickpocket", what: "the pickpocket die" },
  "web/app/(app)/character/actions/arelitz.js": { die: "Breaking in an arelitz", what: "the Gambit" },
  "web/app/(app)/character/actions/medical.js": { die: "A Gambit heal", what: "the healer's die" },
};

function auditRolls({ get }) {
  const callers = [];
  const scan = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "test") continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) scan(rel);
      else if (/\.(js|mjs)$/.test(e.name) && rel !== "db/lib/advantage.js") {
        const text = fs.readFileSync(path.join(REPO, rel), "utf8");
        if (/\b(rollWithAdvantage|rollWithEdge)\(/.test(text)) callers.push(rel);
      }
    }
  };
  for (const d of ["db/lib", "web/lib", "web/app", "bot/src"]) scan(d);
  const dice = callers.sort().map((file) => ({ file, ...(DICE[file] ?? { die: "(unlabelled)", what: "a new caller of the advantage helper: read it and label it here" }) }));
  const unlabelled = dice.filter((d) => d.die === "(unlabelled)").map((d) => d.file);

  const tag = (slug) => get(slug);
  const perk = (slug, effect, dice) => {
    const t = tag(slug);
    return t ? { slug, name: t.name, points: t.pointCost ?? 0, purchasable: !!t.purchasable, effect, dice } : null;
  };
  const tags = [
    perk("lucky", "Rolls twice and keeps the higher (a 6 goes from 1 in 6 to 11 in 36; a 1 from 1 in 6 to 1 in 36).", "the Caving Die, every Gambit, Search, Confession, lessons, Trinket forging, Break Restraints, Torture, Steal, Pickpocket, arelitz, Gambit heals, and pushing on"),
    perk("misfortune", "Rolls twice and keeps the lower, but only on the Gambit.", "every Gambit"),
    perk("quick-footed", "Keeps the higher of two when pushing on.", "pushing on across a zone"),
    perk("caffeinated", "Keeps the higher of two when pushing on.", "pushing on across a zone"),
    perk("fat", "Keeps the lower of two when pushing on.", "pushing on across a zone"),
    perk("old", "Keeps the lower of two when pushing on.", "pushing on across a zone"),
    perk("prospecting", "Draws the loot column that carries more ore and gemstones (not an extra roll).", "the prospecting table on a Mine press"),
    perk("flush", "+1 to the Gambit die while held.", "the Gambit"),
    perk("arkenstone", "+1 to the Gambit die once forged into a Trinket.", "the Gambit"),
    perk("excommunicated", "-1 to the Gambit die.", "the Gambit"),
  ].filter(Boolean);
  return { dice, tags, unlabelled };
}

module.exports = { buildCaving, TROUBLE_MIX, WOUND_TAGS };
