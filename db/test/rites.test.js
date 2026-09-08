// node --test over the pure half of db/lib/rites.js: the roll, the matcher
// and the catalog's shape. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { RITES, THANATI_DICTIONARY, rollRiteWords, matchRites, normalizeChant, containsPhrase, riteByKey } = require("../lib/rites");

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

test("every rite gets one to three words and no phrase nests in another", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const words = rollRiteWords(seeded(seed));
    const raw = Object.values(words);
    const phrases = raw.map(normalizeChant);
    assert.equal(phrases.length, RITES.length);
    // Counted on the raw phrase: `exim’ha` is one dictionary word that
    // normalizes to two.
    for (const p of raw) {
      const n = p.split(" ").length;
      assert.ok(n >= 1 && n <= 3, p);
    }
    for (let i = 0; i < phrases.length; i += 1) {
      for (let j = 0; j < phrases.length; j += 1) {
        if (i === j) continue;
        assert.ok(!containsPhrase(phrases[i], phrases[j]), `${phrases[j]} nests in ${phrases[i]} (seed ${seed})`);
      }
    }
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
