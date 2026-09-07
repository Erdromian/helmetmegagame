// What a Room overhears of a Conversation.
//
// Pure — no prisma, no I/O — so bot/src/lib/whisperPoll.js can hand it a
// window of text and get back one line to print. The poll answers WHO was
// whispering; this file answers what leaked out of it.
//
// The shape of the rule is borrowed from SS13/SS14, where a whisper outside
// speaking range arrives with each letter independently replaced. You are left
// with word shapes, message lengths, and the occasional word that survives
// intact — which is tantalising in a way that a flat "you can't make it out"
// never is. db/lib/muffle.js is that renderer, shared with the shout.
//
// Bascinet differs in one way that matters: a whisper here is a 15-minute
// PERIOD with a body of text behind it, not a single line. So the leak samples
// rather than garbles — a handful of contiguous runs pulled out of the window
// at random, with no regard for punctuation. A fragment that starts and ends
// mid-thought reads as something overheard; a whole tidy sentence reads as
// something quoted, which is a different and much stronger thing to give away.

const { muffle } = require("./muffle");

// Heavy on purpose, and the same 0.7 the shout loses at its furthest audible
// remove. Past this the line stops being a message you failed to catch.
const LEAK_MUFFLE = 0.7;

// A run shorter than this is not worth printing; longer than this and the room
// is being handed a sentence rather than a scrap.
const FRAGMENT_MIN_WORDS = 4;
const FRAGMENT_MAX_WORDS = 10;

// Words are not a bound on their own. A message with no whitespace in it —
// a pasted URL, a base64 blob, a line of Chinese or Japanese, none of which
// `/\s+/` can split — is ONE word, so the word rules above would hand back the
// whole thing verbatim. That is both the strongest possible leak and, at a few
// thousand characters, a message Discord refuses outright: postMessage does not
// chunk (db/lib/discordRest.js), so the room would hear nothing at all, name
// line included. Characters are the backstop the word count cannot be.
const FRAGMENT_MAX_CHARS = 90;
const LEAK_MAX_CHARS = 600;

// Chinese, Japanese and Thai do not put spaces between words, so a whole
// sentence in them counts as ONE word and the word window never bites. Left
// there, a player writing in those scripts would have their entire message
// sampled where a player writing English has 4–10 words of a longer one taken —
// a penalty for the script rather than a rule of the game. A message that is a
// single long token gets a character window instead, sized to hold about as
// much meaning as the word window does.
const CHAR_WINDOW_MIN = 12;
const CHAR_WINDOW_MAX = 30;

// No one message may count for more than this when the pool is weighed. Without
// it, pasting a wall of text is a reliable way to drown your own conversation:
// sampling is proportional, so junk crowds out everything said around it, and
// the ladder reads the junk as a busy fifteen minutes. A long message still
// counts for more than a short one, just not without limit.
const MESSAGE_WEIGHT_CAP = 80;

// The fragments sit on ONE line, and the gaps between them have to read as
// gaps. Joined AFTER muffling, so the ellipsis never turns into static itself.
const SEPARATOR = " … ";

// How many fragments a window leaks, by the words said in it. The thresholds
// are stretched well past what they would need to be if people wrote tersely,
// because they do not: a busy Conversation clears a few hundred words in
// fifteen minutes, so the top of the ladder has to be genuinely hard to reach.
// A window under the first threshold leaks one fragment, and each threshold
// crossed adds another, so the count is just the position in this table.
const LADDER = [80, 200, 450, 900, 1800];

function fragmentCountFor(totalWords) {
  if (!(totalWords > 0)) return 0;
  const tier = LADDER.findIndex((ceiling) => totalWords < ceiling);
  return tier === -1 ? LADDER.length + 1 : tier + 1;
}

// Mentions and custom emoji come out BEFORE anything is sampled. A surviving
// `<@id>` would ping a real person out of a leak, and 70% static is not the
// same thing as a guarantee — the odds of a short token coming through whole
// are small, not zero, and "small" is the wrong bar for pinging someone.
const MENTION = /<[@#!&:a-zA-Z]?[^<>]*>/g;

// A proxied attachment is archived as a placeholder on its own line —
// "[image]" or "[attachment]" (bot/src/lib/proxy.js#attachmentPlaceholders).
// Nobody SAID that, so it comes out before the pool is built: a picture posted
// into a Conversation should not pad the word count, and a garbled "[image]"
// in the middle of overheard speech is noise pretending to be a word.
const PLACEHOLDER_LINE = /^\[(image|attachment)\]$/;

// Emphasis marks are Discord's formatting, not the character's words, and they
// distort the word shapes the muffling exists to preserve.
const MARKDOWN = /[*_~`|]/g;

function poolOf(texts) {
  const pool = [];
  for (const text of texts ?? []) {
    const raw = String(text ?? "")
      .split("\n")
      .filter((line) => !PLACEHOLDER_LINE.test(line.trim()))
      .join(" ");
    const words = raw
      .replace(MENTION, " ")
      .replace(MARKDOWN, "")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length) pool.push(words);
  }
  return pool;
}

// Weighted by length, so a long message is drawn from in proportion to how
// much of the window it actually is. Picking messages uniformly would let one
// three-word aside carry the same weight as a paragraph.
const weightOf = (words) => Math.min(words.length, MESSAGE_WEIGHT_CAP);

function pickMessage(pool, totalWeight, rng) {
  let roll = rng() * totalWeight;
  for (const words of pool) {
    roll -= weightOf(words);
    if (roll < 0) return words;
  }
  return pool[pool.length - 1];
}

// Trims to whole code points, so the character cap can never sever a surrogate
// pair the muffling is careful to keep intact.
function clampChars(text, max) {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

function drawFragment(pool, totalWords, rng) {
  const words = pickMessage(pool, totalWords, rng);
  if (words.length <= FRAGMENT_MIN_WORDS) {
    const joined = words.join(" ");
    const points = Array.from(joined);
    // Short enough to be a scrap already — "run now" is the whole overhearing.
    if (points.length <= CHAR_WINDOW_MAX) return joined;
    const span = CHAR_WINDOW_MAX - CHAR_WINDOW_MIN + 1;
    const length = CHAR_WINDOW_MIN + Math.floor(rng() * span);
    const start = Math.floor(rng() * (points.length - length + 1));
    return points.slice(start, start + length).join("");
  }
  const span = FRAGMENT_MAX_WORDS - FRAGMENT_MIN_WORDS + 1;
  const length = Math.min(
    words.length,
    FRAGMENT_MIN_WORDS + Math.floor(rng() * span),
  );
  const start = Math.floor(rng() * (words.length - length + 1));
  return clampChars(words.slice(start, start + length).join(" "), FRAGMENT_MAX_CHARS);
}

// A bounded redraw, not a search. A window with only one thing in it SHOULD
// repeat rather than spin, so this gives up and takes the duplicate.
const REDRAWS = 12;

// `texts` is every message in the window from a speaker the room can hear —
// Subtle is filtered out by the caller, before a word of theirs gets this far.
// Returns null when there is nothing to overhear, which the caller reads as
// "print the name line alone".
function leakLine(texts, { rng = Math.random } = {}) {
  const pool = poolOf(texts);
  if (!pool.length) return null;

  // The ladder reads the capped weight too, so a wall of pasted text cannot
  // inflate a quiet conversation into a six-fragment one.
  const totalWords = pool.reduce((sum, words) => sum + weightOf(words), 0);
  const count = fragmentCountFor(totalWords);
  if (!count) return null;

  const fragments = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let fragment = drawFragment(pool, totalWords, rng);
    for (let redraw = 0; redraw < REDRAWS && seen.has(fragment); redraw += 1) {
      fragment = drawFragment(pool, totalWords, rng);
    }
    seen.add(fragment);
    fragments.push(fragment);
  }

  const line = fragments.map((f) => muffle(f, LEAK_MUFFLE, rng)).join(SEPARATOR);
  // Belt and braces. Every fragment is already clamped, so this can only fire
  // if the caps above are ever loosened — and the cost of being wrong is the
  // room hearing nothing at all, name line included.
  return clampChars(line, LEAK_MAX_CHARS);
}

module.exports = {
  leakLine,
  fragmentCountFor,
  FRAGMENT_MIN_WORDS,
  FRAGMENT_MAX_WORDS,
  FRAGMENT_MAX_CHARS,
  MESSAGE_WEIGHT_CAP,
  SEPARATOR,
};
