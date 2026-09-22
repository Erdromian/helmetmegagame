// The rite catalog: every Thanati rite, the dictionary the Words of the Circle are rolled from, the roll itself, and the matcher that decides
// whether a line of speech chanted one (docs/systemdocs/THANATI.md). Pure and dependency-free — the Grimoire, the chant hook and tests all read it.
// THERE IS NO RITE BUTTON: a rite happens because robed, Inspired cultists said this game's word for it in a room holding the ingredients
// (db/lib/riteChant.js). What each rite DOES is db/lib/riteEffects.js, keyed by `key`, run by the sweep. Names/descriptions/minimums/ingredient
// lines are Bascinet's words, verbatim and unsigned, apart from the {tag:…} links and the ⬢ glyph for quantities (CLAUDE.md).

// Bascinet's dictionary, spelling preserved. Matching is case- and punctuation-insensitive (normalizeChant), so the hyphen in `domus-bhaava` and
// the apostrophe in `exim'ha` are for the reader's eye only. What each word MEANS is the glossed table in docs/systemdocs/THANATI.md — nothing
// reads a gloss, so carrying one here would be a second place to keep in step for no behaviour at all.
// Three entries are two words (`pestis cruento`, `cruento pestis`, `cruento paashaeximus`), which is why the phrase cap below counts WORDS.
const THANATI_DICTIONARY = Object.freeze([
  "rud'minuox", "rudsceleratus", "pestis cruento", "cruo", "crunatus",
  "pretiacruento", "cruentu", "cruensseasrjit", "cruonit", "shaantitus",
  "cruento pestis", "domus", "marana", "bibox", "vorox", "cruento paashaeximus",
  "Shatruex", "infirmux", "crudux", "vigra", "invisux", "invisuu", "maravita",
  "domus-bhaava", "acerbus-shatruex", "pretaanluxis", "odiosux", "odiosuu",
  "cruo-stragaraNa", "prayaNavita", "vilomaxus", "profanx", "profanuxes",
  "exim'ha", "tuulenux", "praaNsilenux", "esco", "bhuuesco", "desco",
  "bhuudesco", "hatanoceo", "gero", "geropayati", "cruonita", "infuscomus",
  "malax", "caecux", "quodpipax", "pallex", "durbentia", "lokemundux",
]);

// The cult's battle cries, reserved for roleplay and never rolled as a Word of the Circle — a phrase a player may shout in character must not
// also be the thing that fires a rite. Matched on the WHOLE phrase and nothing less: the words themselves stay in the dictionary and may be
// rolled freely in any other combination, so `pretiacruento` alone is refused while `pretiacruento marana` is fine.
// Several use word forms the dictionary does not carry (`geroxe`, `durbe`, `maranax`, `malaxos`) and so could never be rolled anyway. They are
// listed in full regardless, so the blocklist stays true to Bascinet's text rather than to whatever the dictionary happens to hold today.
const PROHIBITED_CIRCLE_PHRASES = Object.freeze([
  "\"apigami\"", "bhuudesco invisuu", "bhuuesco marana", "crudux cruo",
  "cruento paashaeximus", "cruento pestis shatruex", "cruo crunatus durbe",
  "cruo lokemundux", "cruo stragarana malaxos", "geroxe cruo",
  "En marana domus nava crunatus", "caecux infirmux", "malax \"say ti\"",
  "maranax pallex", "maranax malax", "maranax infirmux", "pallex \"ti\"",
  "Geroxe bibox malax", "pestis Cruento",
  "pestis cruento vilomaxus pretiacruento", "pretaanluxis cruonit",
  "pretiacruento", "stragarana", "vorox esco marana", "vilomaxus",
  "\"Pro\" stragarana malaxos",
]);

// Bascinet's cap: a Word of the Circle is at most three words. Counted on the phrase AS WRITTEN, not as normalized — `rud'minuox` reads as one
// word to whoever has to say it, even though normalizeChant splits it in two. The cap is about how much there is to chant.
const MAX_PHRASE_WORDS = 3;

// How long the room has to meet a rite's requirements after the first counted chant, and how long it then has to add chanters before it fires.
const WINDOW_MS = 12 * 60 * 60_000;
const GRACE_MS = 2 * 60_000;

// An ingredient is { tag, count } (RoomTag stack), { resources: n } (⬢ on the floor), or { kind } — "bound-person"|"corpse"|"photograph"|"weapon",
// found by db/lib/riteIngredients.js and handed to the effect rather than eaten.
const RITES = [
  {
    key: "initial",
    name: "Initial Rite",
    minChanters: 1,
    ingredients: [],
    ingredientsText: "",
    description: "The most important of all rites. It will reveal to you what Tzchernobog requires of you.",
  },
  {
    key: "conversion",
    name: "Rite of Conversion",
    minChanters: 1,
    ingredients: [{ kind: "convert-candidate" }],
    ingredientsText: "1 person in the same location who is able to act, not {tag:bound} and not already Thanati. They must have room access to wherever you are chanting at",
    description: "Reveal the wicked truth of this reality, so they might join in its destruction! After fulfilling, you will be asked which of them to call. They must be added to whatever room or conversation you chant at. They may refuse your offer, causing no malus to you or themselves.",
  },
  {
    key: "sacrifice",
    name: "Rite of Sacrifice",
    minChanters: 2,
    ingredients: [{ kind: "bound-person" }],
    ingredientsText: "A {tag:bound} person.",
    description: "Deliver unto Tzchernobog what he has demanded of you, and reap your rewards! The sacrificial victim must be bound and added to the room or conversation you're in.",
  },
  {
    key: "scrying",
    name: "Rite of Scrying",
    minChanters: 2,
    ingredients: [{ resources: 15 }],
    ingredientsText: "15 ⬢",
    description: "Creates a Scrying Eye, which allows you to see through walls and hear conversations.",
  },
  {
    key: "possession",
    name: "Rite of Possession",
    minChanters: 2,
    ingredients: [{ kind: "weapon" }, { resources: 15 }],
    ingredientsText: "1 weapon, 15 ⬢",
    description: "Vengeful spirits will inhabit this weapon, helping it find its targets, and crushing them! Make sure there is only one weapon in the room, or it will be selected at random.",
  },
  {
    key: "reanimation",
    name: "Rite of Reanimation",
    minChanters: 4,
    ingredients: [{ kind: "corpse" }, { resources: 5 }, { tag: "heart", count: 1 }],
    ingredientsText: "1 corpse, 5 ⬢, 1 {tag:heart}",
    description: "Rise from your grave! Enlists a corpse to the service of both you, and Tzchernobog!",
  },
  {
    key: "stupidity",
    name: "Rite of Stupidity",
    minChanters: 3,
    ingredients: [{ tag: "squeeze", count: 1 }, { kind: "photograph" }, { resources: 5 }],
    ingredientsText: "1 {tag:squeeze}, 1 photograph of the target, 5 ⬢",
    description: "Destroys the target’s brain.",
  },
  {
    key: "omniscience",
    name: "Rite of Omniscience",
    minChanters: 2,
    ingredients: [{ tag: "skinless-brain", count: 1 }, { kind: "photograph" }],
    ingredientsText: "1 {tag:skinless-brain}, 1 photograph of the target",
    description: "Lets you peek into the mind of another, revealing every secret, even those they themselves are clueless of…",
  },
  {
    key: "summoning",
    name: "Rite of Summoning",
    minChanters: 3,
    ingredients: [{ tag: "saltpeter", count: 1 }, { resources: 15 }],
    ingredientsText: "1 {tag:saltpeter}, 15 ⬢",
    description: "Brings your fellow Thanati to you. Does not work for the dead, or those in hallowed grounds…",
  },
  {
    key: "panic",
    name: "Rite of Panic",
    minChanters: 3,
    ingredients: [{ tag: "heart", count: 1 }, { resources: 20 }],
    ingredientsText: "1 {tag:heart}, 20 ⬢",
    description: "After fulfilling, you will be asked for a location. That place will become haunted, causing all of its denizens to panic and receive -2 to their Gambits.",
  },
  {
    key: "reflection",
    name: "Rite of Reflection",
    minChanters: 2,
    ingredients: [{ tag: "black-robes", count: 1 }, { resources: 15 }],
    ingredientsText: "1 {tag:black-robes}, 15 ⬢",
    description: "Imbues the robes with dark powers, allowing them to deflect significant physical damage and protect the wearer.",
  },
  {
    key: "rage",
    name: "Rite of Rage",
    minChanters: 1,
    ingredients: [{ tag: "ravenheart-red", count: 1 }],
    ingredientsText: "1 {tag:ravenheart-red}",
    description: "All participants become permanently enraged, gaining inhuman strength but losing their humanity.",
  },
  {
    key: "judgement",
    name: "Rite of Judgement",
    minChanters: 4,
    ingredients: [{ tag: "heart", count: 1 }, { tag: "eye", count: 2 }, { kind: "photograph" }, { resources: 40 }],
    ingredientsText: "1 {tag:heart}, 2 {tag:eye}, 1 photograph of the target, 40 ⬢",
    description: "The target suddenly explodes into mist! It does not work on people within hallowed grounds…",
  },
  {
    key: "madness",
    name: "Rite of Madness",
    minChanters: 4,
    ingredients: [{ tag: "mindbreaker-toxin", count: 1 }, { kind: "photograph" }, { resources: 15 }],
    ingredientsText: "1 {tag:mindbreaker-toxin}, 1 photograph of the target, 15 ⬢",
    description: "Overwhelms the mind of the target with thoughts of violence and hatred! They will lash out at anything and everything around them. Does not work on hallowed people or places.",
  },
  {
    key: "fulfillment",
    name: "Rite of Fulfillment",
    minChanters: 4,
    ingredients: [],
    ingredientsText: "",
    description: "Time to break free from this torturous reality, and do so in spectacular fashion! For each of the Dark Lord's objectives completed, you will be granted 100 ⬢. You may only perform this rite once, and your leader must be present!",
  },
  {
    key: "ascension",
    name: "Rite of Ascension",
    // Kept out of the Grimoire until the cult has finished every objective a GM
    // set it (db/lib/ascensionReveal.js, THANATI.md §5a). The flag lives on the
    // catalog rather than in the document builder so there is one list of what
    // a reader may not see yet, and web/lib/grimoire.js reads it.
    revealedByObjectives: true,
    minChanters: 8,
    ingredients: [
      { tag: "barons-scepter", count: 1 },
      { tag: "bishops-mitre", count: 1 },
      { resources: 250 },
    ],
    ingredientsText: "{tag:barons-scepter}, {tag:bishops-mitre}, 250 ⬢",
    description: "You have exceeded even Lord Tzchernobog's wildest expectations. Ravenheart's very existence rests now in the palm of your hand. You know what to do.",
  },
];

const RITES_BY_KEY = new Map(RITES.map((r) => [r.key, r]));

function riteByKey(key) {
  return RITES_BY_KEY.get(key) ?? null;
}

// Lowercase, letters only, one space between words. NFKC first so a full-width or composed character folds to its plain form. Both the rolled
// phrase and the spoken line go through this, so "Crudux, CRUO!" and "crudux cruo" are the same chant, and `exim’ha` matches `exim'ha`.
function normalizeChant(text) {
  return String(text ?? "")
    // Tokens first: an archived line carries mentions as `{char:<cuid>}`, and the letters-only rule below would shatter one into words like "cruo".
    .replace(/\{[^{}]*\}/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Whole-word containment: the phrase's words appear in order, as words, not inside a longer word. "cruo" does not match "cruonit".
function containsPhrase(normalizedText, normalizedPhrase) {
  if (!normalizedPhrase) return false;
  const haystack = ` ${normalizedText} `;
  return haystack.includes(` ${normalizedPhrase} `);
}

// The battle cries, in the form the roll compares against. Built once: the list is frozen and normalizeChant is pure.
const PROHIBITED_NORMALIZED = new Set(PROHIBITED_CIRCLE_PHRASES.map(normalizeChant));

// Every word the dictionary can put into a phrase, normalized. An ENTRY may be two words (`pestis cruento`) or normalize into two
// (`rud'minuox`), so a phrase is checked word by word rather than entry by entry — which is also why this cannot tell a recombination
// ("pestis paashaeximus") from a real roll. Nothing writes GameState.riteWords by hand, so that is a shape only an editor could produce.
const DICTIONARY_WORDS = new Set(THANATI_DICTIONARY.flatMap((entry) => normalizeChant(entry).split(" ")));

// Words in a phrase as a player reads it. A dictionary entry may be two (`pestis cruento`), so picking three entries is not the same as
// picking three words.
function phraseWordCount(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

// One to three WORDS per rite, drawn from distinct dictionary entries and shuffled. Two rules reject a candidate:
//   - NESTING, against the phrases already rolled. Matching is "contains", so a phrase inside another would fire both rites at once.
//   - THE BLOCKLIST, on the whole phrase only — the battle cries above, which players say in character and must not chant by accident.
// `existing` is a TOP-UP: any phrase already rolled is kept as-is, letting a running game gain a new catalog rite.
function rollRiteWords(rng = Math.random, rites = RITES, existing = null) {
  const words = [...THANATI_DICTIONARY];
  const out = {};
  const taken = [];
  for (const rite of rites) {
    const kept = existing?.[rite.key];
    if (typeof kept === "string" && kept.trim()) {
      out[rite.key] = kept;
      taken.push(normalizeChant(kept));
    }
  }
  for (const rite of rites) {
    if (out[rite.key]) continue;
    let phrase = null;
    for (let attempt = 0; attempt < 1000 && phrase == null; attempt += 1) {
      const count = 1 + Math.floor(rng() * 3);
      const pool = [...words];
      const picked = [];
      let used = 0;
      while (picked.length < count && pool.length) {
        const i = Math.floor(rng() * pool.length);
        const word = pool.splice(i, 1)[0];
        // Spliced whether or not it fits, so a two-word entry that blows the budget costs this attempt one candidate rather than looping.
        const cost = phraseWordCount(word);
        if (used + cost > MAX_PHRASE_WORDS) continue;
        picked.push(word);
        used += cost;
      }
      const candidate = picked.join(" ");
      const norm = normalizeChant(candidate);
      const clashes = taken.some((t) => containsPhrase(norm, t) || containsPhrase(t, norm));
      if (picked.length && !clashes && !PROHIBITED_NORMALIZED.has(norm)) phrase = candidate;
    }
    if (phrase == null) throw new Error(`Could not roll a distinct Word of the Circle for ${rite.key}`);
    out[rite.key] = phrase;
    taken.push(normalizeChant(phrase));
  }
  return out;
}

// Which of an ALREADY ROLLED set of words no longer satisfies the rules a fresh roll applies, as a list of rite keys to roll again.
//
// This exists because a roll outlives the rules that made it. The dictionary, the blocklist, the word cap and the catalog can all move in a
// deploy, and GameState.riteWords is written once and then only ever topped up — so without this a game goes on printing a retired word or a
// reserved battle cry in the Grimoire, and firing on it, because nothing looks again. A key with NO phrase is missing rather than stale and is
// left to rollRiteWords' own top-up.
//
// Pure, so db/lib/riteWords.js can act on it and db/test/rites.test.js can pin it.
function staleRiteWords(words, rites = RITES) {
  const stale = [];
  const kept = [];
  for (const rite of rites) {
    const phrase = words?.[rite.key];
    if (typeof phrase !== "string" || !phrase.trim()) continue;
    const norm = normalizeChant(phrase);
    const broken =
      !norm ||
      phraseWordCount(phrase) > MAX_PHRASE_WORDS ||
      PROHIBITED_NORMALIZED.has(norm) ||
      norm.split(" ").some((word) => !DICTIONARY_WORDS.has(word)) ||
      // Against the phrases kept so far, not the whole stored set: two that nest can only both go if the catalog changed under them, and
      // re-rolling both would be twice the churn for one collision.
      kept.some((t) => containsPhrase(norm, t) || containsPhrase(t, norm));
    if (broken) stale.push(rite.key);
    else kept.push(norm);
  }
  return stale;
}

// The rite keys a line of speech chanted, given this game's words.
function matchRites(content, words) {
  if (!words) return [];
  const text = normalizeChant(content);
  if (!text) return [];
  const keys = [];
  for (const [key, phrase] of Object.entries(words)) {
    if (containsPhrase(text, normalizeChant(phrase))) keys.push(key);
  }
  return keys;
}

// Whether one ingredient list can be judged off a room floor alone — the person/corpse/photograph/weapon kinds are the scripted rite's to resolve.
function floorIngredients(rite) {
  return (rite?.ingredients ?? []).filter((i) => i.tag || i.resources);
}

module.exports = {
  THANATI_DICTIONARY,
  PROHIBITED_CIRCLE_PHRASES,
  MAX_PHRASE_WORDS,
  RITES,
  WINDOW_MS,
  GRACE_MS,
  riteByKey,
  normalizeChant,
  containsPhrase,
  phraseWordCount,
  staleRiteWords,
  rollRiteWords,
  matchRites,
  floorIngredients,
};
