// The single source of the summed Gambit die modifier. Two contributors:
// Hunger at -1 * min(hungerStreak, cap), and the bottom two mood bands
// (docs/systemdocs/MOOD.md) — Afraid at a flat -1, Panicking at a flat -2.
// A mood is one number, so it lands in exactly one band and the two can
// never sum; the modifier is read straight off the band table.
//
// It stays a list-returning module rather than collapsing to one number,
// because Action.diceModifier is one Int and the confirm DM still wants the
// contribution NAMED ("−2 Hungry"). Keeping the shape also means a new
// contributor is an append here rather than a rewrite of five call sites —
// which is what happened when the old Mood track was removed and this went
// from two contributors to one, again when Disappointed brought it back to
// two, again when the fear dial replaced Disappointed, and again when the
// fear dial became the mood dial and stopped being a tag.
//
// No prisma import, so both bot/ and web/ import it by subpath.
const { HUNGER_SLUG } = require("./constants");
const { HUNGER_STREAK_CAP } = require("./hungerPass");
const { bandOf } = require("./mood");

const HUNGER_LABEL = "Hungry";

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[].
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

function hasHunger(characterTags = []) {
  return holds(characterTags, HUNGER_SLUG);
}

// The escalating half of the Hunger penalty: -1 per consecutive hungry turn
// (Character.hungerStreak, written by hungerPass.js), floored at
// -HUNGER_STREAK_CAP — the same cap that grants `dying`. A character with no
// streak recorded (hungerStreak 0, or the field missing on an older read)
// still gets -1 as long as they hold the tag, so this can't regress to 0
// for anyone who has gone hungry at least once.
function hungerModifier(hungerStreak = 0) {
  return -Math.min(Math.max(hungerStreak, 1), HUNGER_STREAK_CAP);
}

// [{ label, value }] — omitting anything worth 0. This is the breakdown the
// confirm DM renders; gambitModifierTotal() is the number that goes in the
// column.
//
// `hungerStreak` and `mood` are second arguments, not read off characterTags,
// because they live on Character rather than on a tag: see the comments on
// Character.hungerStreak and Character.mood in schema.prisma.
//
// EVERY caller must pass `mood`, and select it. A missed one reads undefined,
// lands in Fine, and quietly hands somebody back a penalty they should be
// carrying — which is the one way this can go wrong silently.
function gambitModifiers(characterTags = [], { hungerStreak = 0, mood = 0 } = {}) {
  const out = [];

  if (hasHunger(characterTags)) out.push({ label: HUNGER_LABEL, value: hungerModifier(hungerStreak) });

  const band = bandOf(mood);
  if (band?.gambit) out.push({ label: band.label, value: band.gambit });

  return out;
}

function gambitModifierTotal(characterTags = [], opts = {}) {
  return gambitModifiers(characterTags, opts).reduce((sum, m) => sum + m.value, 0);
}

// "−1 Hungry" — U+2212 minus, matching the bot's roll line. Takes the
// array so a caller that already computed it doesn't recompute.
function formatGambitModifiers(modifiers = []) {
  return modifiers.map((m) => `${m.value > 0 ? "+" : "−"}${Math.abs(m.value)} ${m.label}`).join(" ");
}

module.exports = {
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
};
