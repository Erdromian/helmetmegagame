// Concussed and Amnesiac scramble what /memories shows — and what a look
// reads from it (docs/systemdocs/MEMORIES.md §5). Pure, no requires, so the
// page loader, db/lib/examineRow.js and db/test/memoryScramble.test.js all ask
// the same function.
//
// NOTHING IS STORED. Whether a memory is scrambled, and into what, is derived
// every time from three things: who is remembering, when the scrambling tag
// arrived, and which three-day stretch of the game it is. So the real text is
// never touched, a tag coming off restores everything on the next read with no
// write, and every one of the ~130 places that grant or remove a tag is covered
// without any of them knowing this file exists.
//
// "Roughly 75%": every WORD rolls on its own, three in four — so a memory comes
// back with about a quarter of its words still legible, scattered through it,
// rather than whole memories lost and whole memories kept. A PIN rolls digit
// by digit. What is scrambled comes out as letters of the same length, digits
// for digits, with spaces and punctuation left standing, so it still looks
// like the thing it used to be.

const SCRAMBLING_TAG_SLUGS = ["concussed", "amnesiac"];

// How often the fog shifts. The doc says "every few days"; three in-game
// days. Concussed wears off long before that, so in practice this is
// Amnesiac's clock.
const RESCRAMBLE_DAYS = 3;

// The share of words scrambled, out of 100.
const SCRAMBLE_PERCENT = 75;

// FNV-1a, 32-bit. Not cryptographic and does not need to be: it only has to be
// stable, and spread nearby inputs apart.
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — a small seeded generator, so one seed always yields the same
// nonsense.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Whether `character` is scrambled today, and the seed for it. `tags` are
// CharacterTag rows with `acquiredAt` and `tag.slug` (or a bare `slug`).
// The seed changes when the tag is first applied — the earliest `acquiredAt`
// of the two — and again every RESCRAMBLE_DAYS game days after.
function scrambleState({ characterId, tags, dayNumber }) {
  const held = (tags ?? []).filter((t) => SCRAMBLING_TAG_SLUGS.includes(t?.tag?.slug ?? t?.slug));
  if (!characterId || held.length === 0) return { active: false, seed: 0 };
  const since = Math.min(
    ...held.map((t) => {
      const at = t.acquiredAt ? new Date(t.acquiredAt).getTime() : 0;
      return Number.isFinite(at) ? at : 0;
    }),
  );
  const stretch = Math.floor(Math.max(0, Number(dayNumber) || 0) / RESCRAMBLE_DAYS);
  return { active: true, seed: hash32(`${characterId}|${since}|${stretch}`) };
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";

// Garbles one piece of text, the same way every time for the same seed and key.
function garble(seed, key, text) {
  const next = rng(hash32(`${seed}|${key}|text`));
  let out = "";
  for (const ch of text) {
    if (/\p{Lu}/u.test(ch)) out += LOWER[Math.floor(next() * 26)].toUpperCase();
    else if (/\p{L}/u.test(ch)) out += LOWER[Math.floor(next() * 26)];
    else if (/\p{N}/u.test(ch)) out += String(Math.floor(next() * 10));
    else out += ch;
  }
  return out;
}

// A chip in a body — `{char:<id>|<Name>}`, `{tag:…}` — would survive a garble
// with its id intact and its braces broken. So a scrambled item is flattened
// first: a chip becomes the name it froze, any other token its label or
// nothing, and only then is it garbled.
function flattenTokens(text) {
  return text
    .replace(/\{char:[^{}|\n]*\|([^{}\n]*)\}/g, "$1")
    .replace(/\{[a-z]+:([^{}|\n]*)(?:\|([^{}\n]*))?\}/g, (_, a, b) => b ?? a);
}

// A word: letters and digits, with an apostrophe inside it ("don't") kept as
// part of it. Everything between words stands as it is.
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
// With `eachChar`, every letter or digit is a word of its own — a PIN.
const CHAR = /[\p{L}\p{N}]/gu;

// One item, as the remembering character sees it: `{ text, scrambled }`.
// `key` names the item ("friend:<id>:name", "line:<seq>"), and each word in it
// rolls on its own key under that. `scrambled` is true when ANY word was lost:
// that is the item a player cannot edit or star, because saving it would
// write the nonsense in. An item that kept every word comes back untouched,
// chips and all. Empty text is never scrambled — there is nothing to lose.
function scrambleText(state, key, text, { eachChar = false } = {}) {
  if (!state?.active || typeof text !== "string" || !text.trim()) return { text, scrambled: false };
  let i = 0;
  let scrambled = false;
  const out = flattenTokens(text).replace(eachChar ? CHAR : WORD, (word) => {
    const at = i++;
    if (hash32(`${state.seed}|${key}|w${at}|roll`) % 100 >= SCRAMBLE_PERCENT) return word;
    scrambled = true;
    return garble(state.seed, `${key}:w${at}`, word);
  });
  return scrambled ? { text: out, scrambled: true } : { text, scrambled: false };
}

// One item with several fields — a journal entry's title and body, a line of
// the day's speaker and words. Each field rolls word by word on its own key;
// the item is scrambled if any word in any field was lost. `fields` is
// `{ name: text }`; returns the same shape plus `scrambled`.
function scrambleFields(state, key, fields) {
  const out = { scrambled: false };
  for (const [field, text] of Object.entries(fields)) {
    const shown = scrambleText(state, `${key}:${field}`, text);
    out[field] = shown.text;
    if (shown.scrambled) out.scrambled = true;
  }
  return out;
}

// A Friends entry as its owner can read it today. Keyed by the entry's own id
// and field, so the Friends section and a look (db/lib/examineRow.js) garble
// exactly the same fields the same way — a role the page cannot read is a role
// the look cannot read either.
function scrambleEntry(state, entry) {
  const name = scrambleText(state, `friend:${entry.id}:name`, entry.name ?? "");
  const roleText = scrambleText(state, `friend:${entry.id}:role`, entry.roleText ?? "");
  const notes = scrambleText(state, `friend:${entry.id}:notes`, entry.notes ?? "");
  return {
    name: name.text,
    roleText: roleText.text || null,
    notes: notes.text,
    scrambled: { name: name.scrambled, roleText: roleText.scrambled, notes: notes.scrambled },
    anyScrambled: name.scrambled || roleText.scrambled || notes.scrambled,
  };
}

module.exports = {
  scrambleState,
  scrambleText,
  scrambleEntry,
  scrambleFields,
  SCRAMBLING_TAG_SLUGS,
  RESCRAMBLE_DAYS,
  SCRAMBLE_PERCENT,
};
