// A character's displayed name is built from four parts rather than one
// string: an honorific, a required first name, a title that renders in
// quotes, and an optional last name. The honorific is earned at creation and
// the title is a GM's to grant — except through a Mulligan Potion, which
// buys a player all four (docs/systemdocs/CHARACTERS.md §1b).
//
//   Sir Jorren "the Blind" Vask
//
// Pure — no prisma, no I/O — so both faces of the game can require it, and so
// a client component can import it through web/lib/characterName.js without
// dragging PrismaClient into the browser bundle. Same posture as
// db/lib/roleColor.js and db/lib/gambitModifier.js, and spread into the @lifeweb/db
// barrel alongside them.
//
// The word list itself lives in db/lib/titles.js, along with what earns each
// one. Nothing here decides who may be a Baron.
const { TITLE_WORDS, earnedTitles } = require("./titles");

// Discord caps a webhook username at 80 characters, and bot/src/lib/proxy.js
// sends `Character.name` as-is. Slicing there would silently break
// db/lib/messageWipe.js, which keys its charactersByName map on the same column
// and looks it up by the webhook username — so cap the *inputs* instead and
// let the composed name be short by construction:
//
//   10 + 1 + 24 + 1 + (20 + 2 quotes) + 1 + 20 = 79
//
// Enforced by all three writers of `name`. Nothing downstream ever slices.
const NAME_LIMITS = Object.freeze({
  honorific: 10,
  firstName: 24,
  title: 20,
  lastName: 20,
});

// The full display name. This is what gets mirrored onto Character.name, so
// it is what players, tables, webhook usernames and audit snapshots all see.
function formatCharacterName({ honorific, firstName, title, lastName } = {}) {
  const quoted = title && title.trim() ? `"${title.trim()}"` : null;
  return [honorific, firstName, quoted, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

// First + last only. This is the Discord-facing form: it seeds the personal
// role's colour and name, and it is the character half of a nickname. Keeping
// those bare means a title never recolours or renames a role, and never eats
// into the 32-char nickname budget.
function formatBareName({ firstName, lastName } = {}) {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

// How long a composed name can get: the four caps above plus the separators
// and the two quote marks, 79 by the arithmetic in the NAME_LIMITS comment.
// Every field that asks a player to TYPE somebody's whole name caps here, so
// the box can hold anything the game can produce and nothing longer.
const FULL_NAME_LIMIT = 80;

// What two typed names are compared as: trimmed, inner whitespace collapsed,
// case folded. "  Sir   JORREN  " and "sir jorren" are the same key.
function nameKey(value) {
  return (value ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Does this character answer to what somebody typed?
//
// TWO forms count, and that is deliberate. The full display name is what a
// table or a proxied message shows — `Sir Jorren "the Blind" Vask` — but a
// player who has only ever heard the man called Jorren Vask should not be
// stopped by an honorific they never learned, or by a quoted title they have
// no way to punctuate. So the bare `First Last` (formatBareName) matches too.
//
// Exact either way. There is no fuzzy matching anywhere in this game, and the
// two callers — Engrave and the Arrest Warrant — are both things you should
// have to get right.
//
// `character` needs `name`, `firstName` and `lastName`.
function matchesTypedName(character, typed) {
  const key = nameKey(typed);
  if (!key) return false;
  return key === nameKey(character?.name) || key === nameKey(formatBareName(character ?? {}));
}

// Splits a legacy single-string name on the FIRST space, remainder to the
// last name: "Anna Maria de Vries" -> { Anna, Maria de Vries }. Mirrors the
// SQL in the character_name_parts migration; kept here so the backfill can
// repair a database restored from an older dump.
function splitLegacyName(name) {
  const trimmed = (name ?? "").trim();
  const at = trimmed.indexOf(" ");
  if (at === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, at),
    lastName: trimmed.slice(at + 1).trim() || null,
  };
}

// Two normalizers, because the GM and the player are asking different
// questions and a shared default would be a footgun in whichever direction it
// leaned. Both are server-side gates: every form that sets an honorific is a
// public endpoint, so the picker is only advisory.

// Is this a real title at all? The GM path (web/lib/characterWrite.js) — a GM
// may put any word on anyone, matching the rule in TAGS.md §3 that a GM grant
// ignores gates deliberately. It is also the only way to clear a title whose
// owner can no longer re-select it.
function normalizeHonorific(value) {
  const v = (value ?? "").toString().trim();
  return TITLE_WORDS.includes(v) ? v : null;
}

// Has THIS character earned it? The two player paths — creation and the
// Mulligan Potion rename.
//
// Call this ONLY where the player is choosing a title. A write that happens
// to touch the name for another reason must not re-validate: a character
// keeps a title after losing the tag that granted it (the picker just stops
// offering it), so re-normalizing on, say, a dynasty rename would silently
// strip a disgraced knight's "Sir". See web/lib/dynasty.js, which composes
// through formatCharacterName and never comes through here.
// `gender` is not optional in practice: it selects which form of a title the
// character has earned, so checking a man's "Lord" against the default
// NEUTRAL list ("Noble") rejects it and quietly files him untitled. Both
// callers pass the character's own.
function normalizeEarnedHonorific(value, { tagSlugs = [], roleSlug = null, gender = "NEUTRAL" } = {}) {
  const v = (value ?? "").toString().trim();
  if (!v) return null;
  return earnedTitles({ tagSlugs, roleSlug, gender }).includes(v) ? v : null;
}

// A character is an adult, and nobody in Ravenheart is spry at 91. Enforced
// server-side in both writers; the number is fixed once first saved.
const AGE_MIN = 18;
const AGE_MAX = 90;

module.exports = {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  FULL_NAME_LIMIT,
  formatCharacterName,
  formatBareName,
  nameKey,
  matchesTypedName,
  splitLegacyName,
  normalizeHonorific,
  normalizeEarnedHonorific,
};
