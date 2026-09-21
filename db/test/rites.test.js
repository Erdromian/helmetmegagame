// node --test over the pure half of db/lib/rites.js: the roll, the matcher
// and the catalog's shape. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RITES,
  THANATI_DICTIONARY,
  PROHIBITED_CIRCLE_PHRASES,
  MAX_PHRASE_WORDS,
  rollRiteWords,
  matchRites,
  normalizeChant,
  containsPhrase,
  phraseWordCount,
  staleRiteWords,
  riteByKey,
} = require("../lib/rites");

// A tiny seeded generator so a failing roll can be reproduced.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("the catalog is well-formed", () => {
  const keys = new Set();
  for (const r of RITES) {
    assert.ok(r.key && r.name && r.description, r.key);
    assert.ok(Number.isInteger(r.minChanters) && r.minChanters >= 1, r.key);
    assert.ok(Array.isArray(r.ingredients), r.key);
    assert.equal(typeof r.ingredientsText, "string", r.key);
    assert.ok(!keys.has(r.key), `duplicate key ${r.key}`);
    keys.add(r.key);
  }
  assert.equal(riteByKey("initial").minChanters, 1);
  assert.equal(riteByKey("nope"), null);
  assert.equal(new Set(THANATI_DICTIONARY.map(normalizeChant)).size, THANATI_DICTIONARY.length);
});

test("every rite gets one to three words, none prohibited, and no phrase nests in another", () => {
  const banned = new Set(PROHIBITED_CIRCLE_PHRASES.map(normalizeChant));
  for (let seed = 1; seed <= 300; seed += 1) {
    const words = rollRiteWords(seeded(seed));
    const raw = Object.values(words);
    const phrases = raw.map(normalizeChant);
    assert.equal(phrases.length, RITES.length);
    // Counted on the raw phrase, which is what a player has to say: `exim'ha`
    // is one word to read even though it normalizes to two, and `pestis
    // cruento` is one dictionary entry that is genuinely two words.
    for (const p of raw) {
      const n = phraseWordCount(p);
      assert.ok(n >= 1 && n <= MAX_PHRASE_WORDS, `${p} is ${n} words (seed ${seed})`);
    }
    // The battle cries, which players shout in character. Whole phrase only —
    // the words themselves are still in the dictionary and may be rolled in
    // any other combination.
    for (const p of phrases) {
      assert.ok(!banned.has(p), `${p} is a reserved battle cry (seed ${seed})`);
    }
    for (let i = 0; i < phrases.length; i += 1) {
      for (let j = 0; j < phrases.length; j += 1) {
        if (i === j) continue;
        assert.ok(!containsPhrase(phrases[i], phrases[j]), `${phrases[j]} nests in ${phrases[i]} (seed ${seed})`);
      }
    }
  }
});

test("a roll that outlived its rules is caught, phrase by phrase", () => {
  // The whole point: GameState.riteWords is written once, and the dictionary,
  // the blocklist and the cap can all move in a deploy afterwards.
  const good = rollRiteWords(seeded(7));
  assert.deepEqual(staleRiteWords(good), [], "a fresh roll is never stale");

  // One of each way a stored phrase can go bad.
  const rotten = {
    ...good,
    initial: "apigami",                        // word retired from the dictionary
    conversion: "pretiacruento",               // now a reserved battle cry
    sacrifice: "cruo marana domus lokemundux", // over the three-word cap
    scrying: "   ",                            // present but blank
  };
  const stale = staleRiteWords(rotten);
  for (const key of ["initial", "conversion", "sacrifice"]) {
    assert.ok(stale.includes(key), `${key} should be stale`);
  }
  assert.ok(!stale.includes("scrying"), "a blank phrase is MISSING, not stale — the top-up owns it");
  assert.ok(!stale.includes("panic"), "a phrase that is still legal is left alone");
});

test("two stored phrases that nest re-roll one of them, not both", () => {
  const words = { ...rollRiteWords(seeded(11)), initial: "cruo", conversion: "cruo marana" };
  const stale = staleRiteWords(words);
  assert.deepEqual(stale, ["conversion"], "the first one seen is kept, the collider goes");
});

test("the blocklist bars only the whole phrase, never its words", () => {
  const banned = new Set(PROHIBITED_CIRCLE_PHRASES.map(normalizeChant));
  // Every one of these is a prohibited phrase AND a dictionary entry, so the
  // rule has to tell "this exact phrase" from "a word that appears in one".
  for (const word of ["pretiacruento", "vilomaxus", "cruento paashaeximus"]) {
    assert.ok(THANATI_DICTIONARY.includes(word), `${word} should still be rollable in company`);
    assert.ok(banned.has(normalizeChant(word)), `${word} should be barred on its own`);
  }
  // Retired from the dictionary outright: they are battle cries and nothing else.
  for (const word of ["apigami", "stragarana"]) {
    assert.ok(!THANATI_DICTIONARY.includes(word), word);
  }
});

test("a top-up keeps the words already rolled and fills only the missing ones", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const full = rollRiteWords(seeded(seed));
    // A game that was rolled before three rites joined the catalog.
    const stale = { ...full };
    for (const key of ["madness", "fulfillment", "ascension"]) delete stale[key];

    const topped = rollRiteWords(seeded(seed + 5000), RITES, stale);
    assert.equal(Object.keys(topped).length, RITES.length);
    // Every phrase a player has already learned survives untouched.
    for (const [key, phrase] of Object.entries(stale)) assert.equal(topped[key], phrase);
    // And the new ones still nest in nothing, old or new.
    const phrases = Object.values(topped).map(normalizeChant);
    for (let i = 0; i < phrases.length; i += 1) {
      for (let j = 0; j < phrases.length; j += 1) {
        if (i === j) continue;
        assert.ok(!containsPhrase(phrases[i], phrases[j]), `${phrases[j]} nests in ${phrases[i]} (seed ${seed})`);
      }
    }
  }
  // An empty top-up is the ordinary roll.
  assert.equal(Object.keys(rollRiteWords(seeded(7), RITES, {})).length, RITES.length);
});

test("a mention token cannot chant: {char:<cuid>} is stripped before matching", () => {
  // A cuid is [a-z0-9], and the letters-only rule turns it into runs that the
  // matcher would otherwise treat as whole words.
  const words = { a: "cruo", b: "crudux cruo" };
  assert.deepEqual(matchRites("hey {char:c1cruo2xk9pq} come here", words), []);
  assert.deepEqual(matchRites("{resource:cruo}", words), []);
  // ...and the real thing still counts, tokens beside it or not.
  assert.deepEqual(matchRites("cruo", words), ["a"]);
  assert.deepEqual(matchRites("{char:abc123} cruo", words), ["a"]);
  assert.equal(normalizeChant("hey {char:c1cruo2xk9pq} come here"), "hey come here");
});

test("the matcher ignores case and punctuation and needs whole words in order", () => {
  const words = { a: "crudux cruo", b: "exim’ha", c: "cruonit" };
  assert.deepEqual(matchRites("Rise, brothers. CRUDUX CRUO!", words), ["a"]);
  assert.deepEqual(matchRites("she whispers exim'ha under her breath", words), ["b"]);
  assert.deepEqual(matchRites("cruo crudux", words), []);
  assert.deepEqual(matchRites("cruonita", words), []);
  assert.deepEqual(matchRites("crudux-cruo", words), ["a"]);
  assert.deepEqual(matchRites("", words), []);
  assert.deepEqual(matchRites("anything", null), []);
});

const { nameOnPhoto } = require("../lib/riteIngredients");

test("an old print's name still tells whose it is", () => {
  assert.equal(nameOnPhoto("Photo (Ada Rook)"), "Ada Rook");
  assert.equal(nameOnPhoto("Photo (Ada Rook · XY-1234)"), "Ada Rook");
  assert.equal(nameOnPhoto("A Blank Photo"), null);
});
