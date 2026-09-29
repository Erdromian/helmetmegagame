// Lucky, use by use. It rolls twice and keeps the better on twelve dice, so what it is worth depends
// entirely on WHICH dice a person actually rolls and how often. This prices each one that has a money
// outcome and says plainly which ones it cannot price.
//
// Keeping the better of two d6: the chance of a face k is (2k - 1) / 36, so a 6 goes from 1 in 6 to 11 in 36,
// and a 1 from 1 in 6 to 1 in 36. Most of the value is the 1 that never happens, not the 6 that does.

const fs = require("fs");
const path = require("path");
const constants = require("../../../lib/constants");

const REPO = path.resolve(__dirname, "../../../..");
// The traits that make a die keep the WORSE of two, which cancels Lucky's better-of-two on that die (a tie rolls
// once). They live as unexported sets in the game's code, so they are read out of the source; a changed shape
// fails loudly rather than printing a stale list.
function worseSlugs(rel, pattern) {
  const src = fs.readFileSync(path.join(REPO, rel), "utf8");
  const m = src.match(pattern);
  if (!m) throw new Error(`lucky.js: could not read the worse-die set out of ${rel}; the file has changed shape.`);
  return m[1]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^["']/.test(x) ? x.replace(/["']/g, "") : constants[x] ?? x));
}

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const plain = [1, 2, 3, 4, 5, 6].map(() => 1 / 6);
const lucky = [1, 2, 3, 4, 5, 6].map((k) => (2 * k - 1) / 36);
// P(the die lands in [lo, hi]).
const within = (p, lo, hi) => p.slice(lo - 1, hi).reduce((a, b) => a + b, 0);
const atLeast = (p, n) => within(p, n, 6);
const mean = (p) => p.reduce((s, x, i) => s + x * (i + 1), 0);

function buildLucky({ get, rv, params, caving, trinkets, producerDrops, moveValue, gameTurns }) {
  const nameOf = (slug) => get(slug)?.name ?? slug;
  const cancels = {
    gambit: worseSlugs("db/lib/gambitDie.js", /GAMBIT_WORSE = Object\.freeze\(new Set\(\[([^\]]*)\]\)\)/).map(nameOf),
    pushOn: worseSlugs("db/lib/locationTravel.js", /EXERT_WORSE_SLUGS = new Set\(\[([^\]]*)\]\)/).map(nameOf),
  };
  const uses = [];
  const add = (u) => uses.push({ quantified: true, perTurnNote: "", ...u });

  // ---- the Caving Die ------------------------------------------------------------------------------
  // A caver walks until they have eaten a set number of troubles (the trouble budget), so Lucky's worth is per
  // expedition: more arrivals before the same number of 1s, and more finds among them.
  for (const [zone, label] of [["caves", "Caves"], ["depths", "Depths"]]) {
    for (const T of caving.BUDGETS) {
      const plainX = caving.expedition(zone, T, "base");
      const luckyX = caving.expedition(zone, T, "lucky");
      add({
        id: `caving-${zone}-${T}`,
        die: "Caving Die",
        who: `A caver at the ${label}, stopping at ${T} trouble${T === 1 ? "" : "s"}`,
        gain: luckyX.net - plainX.net,
        basis: `${round1(luckyX.arrivals)} arrivals against ${round1(plainX.arrivals)} for the same ${T} trouble${T === 1 ? "" : "s"}, ${round1(luckyX.loot - plainX.loot)} ¢ more loot`,
        note: "Per expedition, not per turn: the budget, not the clock, ends it.",
        scales: false,
        perExpedition: true,
        kind: "risk",
      });
    }
  }

  // ---- Trinket forging -------------------------------------------------------------------------------
  const H = Object.fromEntries(trinkets.holders.map((h) => [h.id, h]));
  // The shelf pair is read off the shelf loop rather than named here, so a reprice that changes which pair is best
  // moves this row with it. Its id says "shelf", not the inlay, for the same reason.
  const shelfPair = trinkets.shelfLoop.bestSkilledLucky;
  const stoneSets = [
    { label: "no stones", inlay: 0 },
    { label: "two 10-inlay stones (Citrine, Onyx…)", inlay: 20 },
    ...(shelfPair ? [{ key: "shelf", label: `${shelfPair.stones.join(" and ")} off the shelf (the shelf loop)`, inlay: shelfPair.inlay }] : []),
    { label: "Platinum and Black Diamond", inlay: 98 },
  ];
  for (const [smith, plainId, luckyId] of [["Smithing", "apprentice", "apprentice-lucky"], ["Smithing II", "skilled", "skilled-lucky"]]) {
    for (const set of stoneSets) {
      // At the run's sell tax, which takes its share of the dearer Trinket Lucky makes.
      const d = trinkets.expectedProfit(luckyId, set.inlay) - trinkets.expectedProfit(plainId, set.inlay);
      add({
        id: `trinket-${plainId}-${set.key ?? set.inlay}`,
        die: "Forging a Trinket",
        who: `${smith}, forging with ${set.label}`,
        gain: d,
        basis: `+${round1(H[luckyId].eBase - H[plainId].eBase)} ¢ on the bare price and +${round1(H[luckyId].eMult - H[plainId].eMult)} on the multiplier, before tax`,
        note: "Per Trinket, and a Trinket is a whole Move, so this is a Move's worth of gain. Stones are the limit, not the die.",
        scales: false,
        kind: "forge",
        perTrinket: true,
      });
    }
  }
  // A prospector who forges what they dig up (the case the investment table prices). Lucky reaches both halves:
  // the stones come off its second draw, and the Trinket off its second die.
  const pp = (key, id) => trinkets.prospector[key][id];
  for (const { id, who, plain, lucky } of [
    { id: "trinket-prospector", who: "A Caves miner forging their own stones, Smithing", plain: ["caves:plain", "apprentice"], lucky: ["caves:plainLucky", "apprentice-lucky"] },
    { id: "trinket-prospector-depths", who: "A Depths prospector forging their own stones, Smithing II", plain: ["depths:skilled", "skilled"], lucky: ["depths:skilledLucky", "skilled-lucky"] },
  ]) {
    const proGain = pp(...lucky).net - pp(...plain).net;
    add({
      id,
      die: "Forging a Trinket",
      who,
      gain: proGain * params.mineDuty,
      basis: `${round1(proGain)} ¢ more a press, a press one turn in ${round1(1 / params.mineDuty)}, rarer stones and better Trinkets both`,
      note: "Limited by how many stones drop, about one a press.",
      scales: false,
      kind: "forge",
    });
  }

  // ---- the Mine press's loot draw ---------------------------------------------------------------------------
  // No die: Lucky draws twice and keeps the rarer find (MINING.md §3b). Priced at what the station pays for the
  // find, the same floor the drops page uses, so a stone a smith would forge is worth more than this says.
  const evOf = (rows) => rows.reduce((sum, r) => sum + r.ev, 0);
  for (const [zone, label] of [["caves", "Caves"], ["depths", "Depths"]]) {
    for (const [col, skill] of [["plain", "a pickaxe"], ["skilled", "Prospecting"]]) {
      const plainEv = evOf(producerDrops.prospecting[zone][col]);
      const luckyEv = evOf(producerDrops.prospecting[zone][`${col}Lucky`]);
      add({
        id: `mining-${zone}-${col}`,
        die: "The Mine press's loot draw",
        who: `A miner at the ${label} with ${skill}`,
        gain: (luckyEv - plainEv) * params.mineDuty,
        basis: `${round1(luckyEv)} ¢ of finds a press against ${round1(plainEv)}, a press one turn in ${round1(1 / params.mineDuty)}`,
        note: "Valued at the station's price; forging the stones is the Trinket row's.",
        scales: false,
        kind: "mine",
      });
    }
  }

  // ---- pushing on ----------------------------------------------------------------------------------------
  const ankle = get("sprained-ankle");
  const ankleCost = (ankle?.requirement?.resourceCost ?? 2) * rv.buy + (ankle?.requirement?.turnsCost ?? 0.25) * moveValue;
  const outcomes = (p) => ({ injury: within(p, 1, 1), exhausted: within(p, 2, 3), tired: within(p, 4, 5) });
  const cost = (o) => o.injury * ankleCost + o.exhausted * moveValue + o.tired * 0.5 * moveValue;
  const pushBase = cost(outcomes(plain));
  const pushLucky = cost(outcomes(lucky));
  add({
    id: "push-on",
    die: "Pushing on",
    who: "A walker who pushes on once a turn",
    gain: pushBase - pushLucky,
    basis: `a sprained ankle 1 in 6 → 1 in 36; Exhausted 2 in 6 → 8 in 36, priced at ${round1(ankleCost)} ¢, ${round1(moveValue)} ¢ and half of that for Tired`,
    note: `A saving on the price of an extra crossing, so it only counts on a turn that would push on. ${cancels.pushOn.join(" or ")} keeps the worse die here and cancels it (locationTravel.js).`,
    scales: false,
    kind: "risk",
  });

  // ---- lessons --------------------------------------------------------------------------------------------
  // A learner needs die + modifiers >= a threshold; a failed lesson costs the attempt and the Moves. Lucky
  // does not change whether a skill is learnt, only how many tries it takes.
  const lessonRows = [
    { label: "a Teacher (Teaching)", t: constants.LESSON_THRESHOLD },
    { label: "an untaught teacher", t: constants.UNTAUGHT_LESSON_THRESHOLD },
    { label: "a Drill Instructor, fighting skills", t: constants.DRILL_THRESHOLD },
  ];
  const lessons = lessonRows.map(({ label, t }) => {
    const p0 = atLeast(plain, t);
    const p1 = atLeast(lucky, t);
    return { label, threshold: t, plain: p0, lucky: p1, triesPlain: 1 / p0, triesLucky: 1 / p1, movesSaved: 1 / p0 - 1 / p1 };
  });
  for (const l of lessons) {
    add({
      id: `lesson-${l.threshold}`,
      die: "A lesson",
      who: `Learning a skill from ${l.label} (needs a ${l.threshold})`,
      gain: l.movesSaved * moveValue,
      basis: `${(l.plain * 100).toFixed(0)}% → ${(l.lucky * 100).toFixed(0)}% a try, ${round1(l.triesPlain)} tries → ${round1(l.triesLucky)}`,
      note: "One off, per skill learnt, and priced at the learner's spare Moves only. The skill itself is worth its points.",
      scales: false,
      kind: "one-off",
      oneOff: true,
    });
  }

  // ---- what it cannot price --------------------------------------------------------------------------------------
  const unpriced = [
    { die: "Every Gambit", what: `${cancels.gambit.join(" or ")} keeps the worse of two on a Gambit and cancels Lucky there (gambitDie.js). The average die goes from ${mean(plain).toFixed(2)} to ${mean(lucky).toFixed(2)}, about a +1 on every Gambit, and a 1 in 36 chance of a 1. A GM decides what a Gambit is worth, so this has no ¢. It is the same size as the +1 an Arkenstone Trinket gives while held.`, note: "The biggest thing Lucky does, and none of it is money." },
    { die: "Search", what: `Reveals floor(die ÷ 6 × the hidden pile): the average share found goes from ${((mean(plain) / 6) * 100).toFixed(0)}% to ${((mean(lucky) / 6) * 100).toFixed(0)}%.`, note: "Nobody sees the die." },
    { die: "Searching a room", what: `The same reveal rule on what lies under a room's floor (roomSearch.js), a stack coming up whole: the average share of the stacks found goes from ${((mean(plain) / 6) * 100).toFixed(0)}% to ${((mean(lucky) / 6) * 100).toFixed(0)}%, and a room with one hidden thing gives it up only on a 6 (before the room's own modifiers), ${Math.round(plain[5] * 36)} in 36 to ${Math.round(lucky[5] * 36)} in 36.`, note: "Nobody sees the die. Worth whatever the room hides." },
    { die: "Steal and Pickpocket", what: `The failed band is a 1: it goes from ${((1 / 6) * 100).toFixed(1)}% of attempts to ${((1 / 36) * 100).toFixed(1)}%, and a clean take (4+, before Skilled's +1) from ${(atLeast(plain, 4) * 100).toFixed(0)}% to ${(atLeast(lucky, 4) * 100).toFixed(0)}%. A noticed steal still moves the goods, so what is bought is silence.`, note: "Worth the haul, up to 15 lb a pickpocket." },
    { die: "Heal Gambit, breaking in an arelitz, Torture, Confession, Break Restraints", what: "Each is a Gambit-shaped roll a GM or a table decides.", note: "Not priced." },
  ];

  // ---- the answer -----------------------------------------------------------------------------------------------------
  const ranked = uses.filter((u) => !u.oneOff).sort((a, b) => b.gain - a.gain);
  const best = ranked[0];
  const cavers = uses.filter((u) => u.die === "Caving Die");
  return {
    plain: { mean: mean(plain), find: plain[5], one: plain[0] },
    lucky: { mean: mean(lucky), find: lucky[5], one: lucky[0] },
    uses,
    cancels,
    ranked,
    best,
    unpriced,
    lessons,
    cavingBest: cavers.sort((a, b) => b.gain - a.gain)[0],
    gameTurns,
  };
}

module.exports = { buildLucky };
