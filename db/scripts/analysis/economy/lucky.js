// Lucky, use by use. It rolls twice and keeps the better on twelve dice, so what it is worth depends
// entirely on WHICH dice a person actually rolls and how often. This prices each one that has a money
// outcome and says plainly which ones it cannot price.
//
// Keeping the better of two d6: the chance of a face k is (2k - 1) / 36, so a 6 goes from 1 in 6 to 11 in 36,
// and a 1 from 1 in 6 to 1 in 36. Most of the value is the 1 that never happens, not the 6 that does.

const constants = require("../../../lib/constants");

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const plain = [1, 2, 3, 4, 5, 6].map(() => 1 / 6);
const lucky = [1, 2, 3, 4, 5, 6].map((k) => (2 * k - 1) / 36);
// P(the die lands in [lo, hi]).
const within = (p, lo, hi) => p.slice(lo - 1, hi).reduce((a, b) => a + b, 0);
const atLeast = (p, n) => within(p, n, 6);
const mean = (p) => p.reduce((s, x, i) => s + x * (i + 1), 0);

function buildLucky({ get, rv, caving, trinkets, moveValue, gameTurns }) {
  const uses = [];
  const add = (u) => uses.push({ quantified: true, perTurnNote: "", ...u });

  // ---- the Caving Die ------------------------------------------------------------------------------
  for (const [zone, label] of [["caves", "Caves"], ["depths", "Depths"]]) {
    const z = caving.perZone[zone];
    for (const n of [1, 4, 10]) {
      add({
        id: `caving-${zone}-${n}`,
        die: "Caving Die",
        who: `A caver at the ${label}, ${n} arrival${n > 1 ? "s" : ""} a turn`,
        gain: z.luckyGain * n,
        basis: `${round1((z.lucky.loot - z.base.loot) * n)} ¢ more loot and ${round1((z.base.danger - z.lucky.danger) * n)} ¢ less wound cost`,
        note: n === 1 ? "The figure the investment table used." : "Arrivals are only rationed by the 3-second walk cooldown, so this scales straight up.",
        scales: true,
        kind: "risk",
      });
    }
  }

  // ---- Trinket forging -------------------------------------------------------------------------------
  const H = Object.fromEntries(trinkets.holders.map((h) => [h.id, h]));
  const stoneSets = [
    { label: "no stones", inlay: 0 },
    { label: "two 10-inlay stones (Citrine, Onyx…)", inlay: 20 },
    { label: "Iron and Jewelry off the shelf", inlay: 25 },
    { label: "Platinum and Black Diamond", inlay: 98 },
  ];
  for (const [smith, plainId, luckyId] of [["Smithing", "apprentice", "apprentice-lucky"], ["Smithing II", "skilled", "skilled-lucky"]]) {
    for (const set of stoneSets) {
      const d = H[luckyId].eBase - H[plainId].eBase + (H[luckyId].eMult - H[plainId].eMult) * set.inlay;
      add({
        id: `trinket-${plainId}-${set.inlay}`,
        die: "Forging a Trinket",
        who: `${smith}, forging with ${set.label}`,
        gain: d,
        basis: `+${round1(H[luckyId].eBase - H[plainId].eBase)} ¢ on the bare price, +${round1(H[luckyId].eMult - H[plainId].eMult)} on the multiplier`,
        note: "Per Trinket, and a Trinket is a whole Move, so this is a Move's worth of gain. Stones are the limit, not the die.",
        scales: false,
        kind: "forge",
        perTrinket: true,
      });
    }
  }
  // A prospector who forges what they dig up (the case the investment table prices).
  const pp = (col, id) => trinkets.prospector[`caves:${col}`][id];
  const proGain = pp("plain", "apprentice-lucky").net - pp("plain", "apprentice").net;
  add({
    id: "trinket-prospector",
    die: "Forging a Trinket",
    who: "A Caves miner forging their own stones, Smithing",
    gain: proGain * 0.5,
    basis: `${round1(proGain)} ¢ more a press, a press every other turn`,
    note: "Limited by how many stones drop, about one a press.",
    scales: false,
    kind: "forge",
  });

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
    note: "A saving on the price of an extra crossing, so it only counts on a turn that would push on.",
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
    { die: "Every Gambit", what: `The average die goes from ${mean(plain).toFixed(2)} to ${mean(lucky).toFixed(2)}, about a +1 on every Gambit, and a 1 in 36 chance of a 1. A GM decides what a Gambit is worth, so this has no ¢. It is the same size as the +1 an Arkenstone Trinket gives while held.`, note: "The biggest thing Lucky does, and none of it is money." },
    { die: "Search", what: `Reveals floor(die ÷ 6 × the hidden pile): the average share found goes from ${((mean(plain) / 6) * 100).toFixed(0)}% to ${((mean(lucky) / 6) * 100).toFixed(0)}%.`, note: "Nobody sees the die." },
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
    ranked,
    best,
    unpriced,
    lessons,
    cavingBest: cavers.sort((a, b) => b.gain - a.gain)[0],
    gameTurns,
  };
}

module.exports = { buildLucky };
