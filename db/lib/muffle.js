// Static. What speech sounds like when you only half catch it.
//
// Pure — no prisma, no I/O. Two systems garble text and they must garble it
// the same way, or the game grows two dialects of noise: db/lib/shout.js muffles
// by distance, and bot/src/lib/whisperPoll.js muffles the fragments a Room
// overhears out of a Conversation. This module is the one implementation.
//
// It answers HOW MUCH is lost, never how much SHOULD be — the fraction is the
// caller's, because distance and eavesdropping are different rules that happen
// to share a renderer.

// Light, medium, heavy — picked at random per character so a muffled line
// looks like static rather than like a censor bar.
const BLOCKS = ["░", "▒", "▓"];

// Replaces `fraction` of the NON-WHITESPACE characters with a block. Spaces
// survive on purpose: the word shapes are what tells a listener how much they
// missed, and a solid bar of noise reads as no message at all rather than as a
// message they failed to catch.
//
// `rng` is injectable so the tests can pin the static down; every caller in the
// game leaves it alone.
function muffle(text, fraction, rng = Math.random) {
  if (fraction <= 0) return text;
  // Array.from walks code POINTS. `.split("")` walks UTF-16 units, which
  // replaces half of a surrogate pair and leaves a lone surrogate behind —
  // that reaches Discord as `�`, which reads as a broken message rather than
  // as a muffled one. Emoji and combining marks survive or go whole.
  return Array.from(String(text))
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      if (rng() >= fraction) return ch;
      return BLOCKS[Math.floor(rng() * BLOCKS.length)];
    })
    .join("");
}

module.exports = { muffle };
