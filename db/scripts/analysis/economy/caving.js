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
const mood = require("../../../lib/mood");
const { fightingSkill, BANDS, bandRank } = require("../../../lib/fightingSkill");
const { LUCKY_SLUG } = require("../../../lib/constants");

const REPO = path.resolve(__dirname, "../../../..");
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// What happens on a 1, as a share of troubles. The user's brief: at least a minor wound anywhere in the
// caves, and in the depths more likely a major wound, a lost limb or a death. Nothing in code decides
// this; a GM does, per roll, from the `cavingmonsters` document.
const TROUBLE_MIX = {
  caves: { minor: 0.8, major: 0.15, limb: 0.04, death: 0.01 },
  depths: { minor: 0.2, major: 0.4, limb: 0.25, death: 0.15 },
};

// The same mix, by how good the caver is in a fight: BASCINET'S ASSUMPTION PENDING A REAL MECHANIC. Nothing in the
// code turns a fighting band into a better outcome on a 1; a GM does. The rule: the mix above belongs to the band an
// untrained character stands in (fightingSkill([]) reads it; today Weak), so a baseline character's figures do not
// move, and each band better keeps BAND_STEP of the major, limb and death shares, the rest becoming minor wounds; each
// band worse divides them by it (never past the whole). One typed number, so the table is monotone by construction.
const BAND_STEP = 0.7;
function mixByBand(zoneMix) {
  const base = bandRank(fightingSkill([]).melee.band.key);
  const bad = ["major", "limb", "death"];
  return BANDS.map((b, i) => {
    const f = BAND_STEP ** (i - base);
    const sum = bad.reduce((n, k) => n + zoneMix[k] * f, 0);
    const scale = sum > 1 ? 1 / sum : 1;
    const out = Object.fromEntries(bad.map((k) => [k, zoneMix[k] * f * scale]));
    out.minor = 1 - bad.reduce((n, k) => n + out[k], 0);
    return { key: b.key, label: b.label, rank: i, baseline: i === base, mix: out };
  });
}
const MIX_BY_BAND = { caves: mixByBand(TROUBLE_MIX.caves), depths: mixByBand(TROUBLE_MIX.depths) };

// The Caving Die's two faces that matter, read off the game's own dice rather than restated: the advantage helper
// is loaded with a stand-in die that walks every outcome once, for a plain character and for one holding Lucky.
function dieFaces() {
  const rollPath = require.resolve("../../../lib/rollDie");
  const advPath = require.resolve("../../../lib/advantage");
  const savedRoll = require.cache[rollPath];
  const savedAdv = require.cache[advPath];
  let queue = [];
  require.cache[rollPath] = { id: rollPath, filename: rollPath, loaded: true, exports: { rollDie: () => queue.shift() } };
  delete require.cache[advPath];
  try {
    const adv = require(advPath);
    const tally = (tags, dice) => {
      const out = { find: 0, trouble: 0 };
      const outcomes = dice === 1 ? [1, 2, 3, 4, 5, 6].map((a) => [a]) : [1, 2, 3, 4, 5, 6].flatMap((a) => [1, 2, 3, 4, 5, 6].map((b) => [a, b]));
      for (const seq of outcomes) {
        queue = [...seq];
        const { die } = adv.rollWithAdvantage(tags);
        if (die === 6) out.find += 1 / outcomes.length;
        if (die === 1) out.trouble += 1 / outcomes.length;
      }
      return out;
    };
    return { base: tally([], 1), lucky: tally([{ tag: { slug: LUCKY_SLUG } }], 2) };
  } finally {
    if (savedRoll) require.cache[rollPath] = savedRoll;
    else delete require.cache[rollPath];
    if (savedAdv) require.cache[advPath] = savedAdv;
    else delete require.cache[advPath];
  }
}

// What a mood hit costs, in the report's one currency: the kind's base from db/lib/mood.js, through its own
// resolveDelta (multipliers first, then GameConfig.moodIntensity, as the game applies them), at the ¢ a point of mood
// the food valuation uses.
function moodCostOf({ kind, base, held, intensity, pointPrice }) {
  return -mood.resolveDelta({ kind, base, heldSlugs: new Set(held), intensity }) * pointPrice;
}
// The mood tags that bend the underground hits, read off mood.js's own table.
const moodTagsFor = (kinds) => mood.MULTIPLIER_SLUGS.filter((slug) => kinds.some((k) => mood.resolveDelta({ kind: k, base: -10, heldSlugs: new Set([slug]), intensity: 1 }) !== mood.resolveDelta({ kind: k, base: -10, heldSlugs: new Set(), intensity: 1 })));

// Which catalog tags stand for each kind of hurt. The cost is read off the tags, not typed in.
const WOUND_TAGS = {
  minor: { cures: ["deep-wound", "broken-bone"], label: "Minor wound", what: "a deep wound or a broken bone (cure rung 3)" },
  major: { cures: ["gut-wound", "punctured-lung"], label: "Major wound", what: "a gut wound or a punctured lung (cure rung 6)" },
  limb: { prosthetics: ["wooden-leg", "prosthetic-hand"], label: "Lost limb", what: "a wooden leg or a prosthetic hand off the shelf" },
  death: { label: "Death", what: "no cure; the character is gone" },
};

// `moodIntensity` is GameConfig.moodIntensity's default and `moodPointPrice` the ¢ a point of mood is worth (the food
// valuation's rate), so a trouble's −10 is priced beside its wounds.
function buildCaving({ get, list, rv, rvMined, sources, moveValue, activities, gameTurns, sellBackShare, moodIntensity = 1, moodPointPrice = 0 }) {
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
    if (t.depotPrice != null) return { value: sellBackShare * t.depotPrice, basis: `estimated at ${Math.round(sellBackShare * 100)}% of the shelf price` };
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
  // What a trouble costs in wounds, for the baseline band's mix unless another band is asked for.
  const troubleCost = (zone, bandKey = null) => {
    const mix = bandKey ? MIX_BY_BAND[zone].find((b) => b.key === bandKey).mix : TROUBLE_MIX[zone];
    const cost = Object.entries(mix).reduce((s, [k, share]) => s + share * wounds[k].total, 0);
    return { cost, mix };
  };

  // ---- a trouble's mood hit, and the ambient cost of being underground ----------------------------------------
  const moodCost = (kind, base, held) => moodCostOf({ kind, base, held, intensity: moodIntensity, pointPrice: moodPointPrice });
  const troubleMood = {
    plain: moodCost("CAVE_TROUBLE", mood.EVENTS.CAVE_TROUBLE, []),
    brave: moodCost("CAVE_TROUBLE", mood.EVENTS.CAVE_TROUBLE, ["brave"]),
    teratophobia: moodCost("CAVE_TROUBLE", mood.EVENTS.CAVE_TROUBLE, ["teratophobia"]),
  };
  // A night in a cave or the wilderness (the mood pass's place term) and an arrival there (the arrival term).
  const ambient = {};
  for (const [cls, holders] of [["CAVE", ["spelunker", "rough-camper", "pale", "claustrophobia", "brave"]], ["WILDERNESS", ["outsider", "rough-camper", "agoraphobia", "brave"]]]) {
    const night = mood.placeTermFor(cls);
    const arrivalBase = cls === "CAVE" ? mood.EVENTS.CAVE_MOVE : mood.EVENTS.WILDERNESS_MOVE;
    ambient[cls] = {
      nightBase: night.base,
      arrivalBase,
      night: Object.fromEntries([["plain", []], ...holders.map((h) => [h, [h]])].map(([k, held]) => [k, moodCost(night.kind, night.base, held)])),
      arrival: Object.fromEntries([["plain", []], ...holders.map((h) => [h, [h]])].map(([k, held]) => [k, moodCost(cls, arrivalBase, held)])),
    };
  }
  const moodTags = {
    trouble: moodTagsFor(["CAVE_TROUBLE"]).map((slug) => ({ slug, name: get(slug)?.name ?? slug, factor: mood.resolveDelta({ kind: "CAVE_TROUBLE", base: -10, heldSlugs: new Set([slug]), intensity: 1 }) / -10 })),
    cave: moodTagsFor(["CAVE"]).map((slug) => ({ slug, name: get(slug)?.name ?? slug, factor: mood.resolveDelta({ kind: "CAVE", base: -10, heldSlugs: new Set([slug]), intensity: 1 }) / -10 })),
    wilderness: moodTagsFor(["WILDERNESS"]).map((slug) => ({ slug, name: get(slug)?.name ?? slug, factor: mood.resolveDelta({ kind: "WILDERNESS", base: -10, heldSlugs: new Set([slug]), intensity: 1 }) / -10 })),
  };

  // ---- the die, with and without Lucky ------------------------------------------------------------------
  const faces = dieFaces();
  const perZone = {};
  for (const zone of ["caves", "depths"]) {
    const z = zones[zone];
    const t = troubleCost(zone);
    const build = (label) => {
      const f = faces[label];
      const loot = z.evFind * f.find;
      const dangerWound = f.trouble * t.cost;
      const dangerMood = f.trouble * troubleMood.plain;
      const deaths = f.trouble * t.mix.death;
      return { label, pFind: f.find, pTrouble: f.trouble, loot, dangerWound, dangerMood, danger: dangerWound + dangerMood, net: loot - dangerWound - dangerMood, deathsPerArrival: deaths };
    };
    perZone[zone] = { troubleCost: t.cost, troubleMood: troubleMood.plain, mix: t.mix, base: build("base"), lucky: build("lucky") };
    perZone[zone].luckyGain = perZone[zone].lucky.net - perZone[zone].base.net;
    // The cost of one trouble (wounds and mood) at which the loot exactly pays for it.
    perZone[zone].breakEvenWound = (z.evFind * faces.base.find) / faces.base.trouble;
  }

  // ---- a trouble budget: keep walking until the T-th 1, then stop --------------------------------------------
  // Expected arrivals before the T-th trouble is T ÷ p (the negative binomial's mean). The finds, loot, wounds and
  // mood all follow from that one number.
  const BUDGETS = [1, 2, 3, 5, 10];
  const expedition = (zone, T, who = "base", bandKey = null) => {
    const f = faces[who];
    const arrivals = T / f.trouble;
    const finds = arrivals * f.find;
    const loot = finds * zones[zone].evFind;
    const wound = T * troubleCost(zone, bandKey).cost;
    const moodBy = Object.fromEntries(Object.entries(troubleMood).map(([k, v]) => [k, T * v]));
    return { zone, T, who, arrivals, finds, loot, wound, mood: moodBy, net: loot - wound - moodBy.plain, deaths: T * troubleCost(zone, bandKey).mix.death };
  };
  const budgets = [];
  for (const zone of ["caves", "depths"]) for (const T of BUDGETS) for (const who of ["base", "lucky"]) budgets.push(expedition(zone, T, who));
  const positiveAt = (zone, who) => BUDGETS.find((T) => expedition(zone, T, who).net > 0) ?? null;

  // ---- every tag that changes a roll ---------------------------------------------------------------------
  const rolls = auditRolls({ get });

  return {
    faces,
    zones,
    wounds,
    perZone,
    budgets,
    BUDGETS,
    expedition,
    positiveAt,
    arrivalsPerTrouble: { base: 1 / faces.base.trouble, lucky: 1 / faces.lucky.trouble },
    troubleMood,
    troubleMoodBase: mood.EVENTS.CAVE_TROUBLE,
    ambient,
    moodTags,
    mixByBand: MIX_BY_BAND,
    bandStep: BAND_STEP,
    troubleCost,
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
  "db/lib/roomSearch.js": { die: "Searching a room", what: "the room-search die" },
  "db/lib/verbs/self.js": { die: "Break Restraints", what: "the escape die" },
  "db/lib/verbs/work.js": { die: "Breaking in an arelitz", what: "the Gambit" },
  "web/app/(app)/character/trinketActions.js": { die: "Forging a Trinket", what: "the forge's die" },
  "web/app/(app)/character/actions/misc.js": { die: "Torture", what: "the torture die" },
  "web/app/(app)/character/actions/steal.js": { die: "Steal", what: "the steal die" },
  "web/app/(app)/character/actions/pickpocket.js": { die: "Pickpocket", what: "the pickpocket die" },
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
    perk("lucky", "Rolls twice and keeps the higher (a 6 goes from 1 in 6 to 11 in 36; a 1 from 1 in 6 to 1 in 36).", "the Caving Die, every Gambit, Search, searching a room, Confession, lessons, Trinket forging, Break Restraints, Torture, Steal, Pickpocket, arelitz, Gambit heals, and pushing on"),
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

module.exports = { buildCaving, TROUBLE_MIX, MIX_BY_BAND, WOUND_TAGS };
