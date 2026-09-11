// The anonymous identity a character posts under when they use `/conceal`
// (see bot/src/events/messageCreate.js). Pure — no prisma, no I/O — same
// posture as db/lib/characterName.js.
//
// The alias deliberately carries only what a stranger could tell at a glance:
// roughly how old someone looks, and how they present. Everything else — the
// name, the appearance, the faction — is what concealing is for.


// Under YOUNG you read as young, at OLD and above you read as old, and the
// broad middle gets no adjective at all — which is what makes the word mean
// something when it does appear.
const YOUNG_UNDER = 25;
const OLD_FROM = 55;

// Straight off Character.gender. This used to be inferred from the title —
// first from two hardcoded MAN/WOMAN arrays here, then from a `gender` on each
// word — which meant an untitled character was always "Person" however they
// present, and that a Censor was too. A character carries their own gender
// now, so the alias can simply say it.
function genderWord(gender) {
  if (gender === "MAN") return "Man";
  if (gender === "WOMAN") return "Woman";
  return "Person";
}

function ageWord(age) {
  if (typeof age !== "number" || Number.isNaN(age)) return null;
  if (age < YOUNG_UNDER) return "Young";
  if (age >= OLD_FROM) return "Old";
  return null;
}

// "Young Man" / "Old Woman" / "Person". Used as the webhook username, so it
// is Title Case and comfortably inside Discord's 80-char cap.
//
// Destructured off a whole Character row, which is what both call sites pass
// (bot/src/events/messageCreate.js, interactionCreate.js) — so moving from
// `honorific` to `gender` needed no change at either.
//
// The alias is frozen into ArchiveEntry.concealedAlias at send time, so a
// later gender change never rewrites history. That is correct: the archive
// records who someone was as they were known then.
function concealedAlias({ age, gender } = {}) {
  return [ageWord(age), genderWord(gender)].filter(Boolean).join(" ");
}

// The line shown when someone 🔍-inspects a concealed message. Lower-cased
// mid-sentence: "An unknown young woman, their identity concealed."
function concealedLine(alias) {
  return `An unknown ${(alias || "person").toLowerCase()}, their identity concealed.`;
}

// "a young man" / "an old woman" — the alias as a noun phrase for a line of
// prose. Shared by the whisper poll and the room stash announcements so the
// same person reads the same way in both.
function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "a young woman" — the alias as a row in a list of who is standing here.
// A description rather than a name, so it is lower-cased and takes an
// article, and it prefers what a viewer LAST HEARD this person called
// (db/lib/sightings.js) over what they would be called right now: a hood put
// on after you heard them speak does not change what you know.
//
// Shared by whosHere's concealed column and presentedMembers' strip, which
// sit inches apart on /chat — two spellings of one hood in a single viewport
// is worse than either.
function aliasRow(character, sightingName = null) {
  return withArticle((sightingName ?? concealedAlias(character ?? {})).toLowerCase());
}

// "An old woman", ready to start a sentence.
function aliasSubject(character) {
  return capitalizeFirst(withArticle(concealedAlias(character ?? {}).toLowerCase()));
}

// Every alias a hood can produce: the three age words (one of them nothing)
// against the three gender words, nine strings in all. Built from the same two
// functions the alias itself is, so it cannot drift away from them.
//
// It exists to read an ARCHIVED row back. ArchiveEntry.concealedAlias holds a
// forced name as well as a hood's alias, and only one of the two is drawn from
// this closed set — so an alias that is not in here was a forced name, however
// long ago, and no lookup against what the speaker holds today is needed to
// say so. See presentedIdentity.js#wasHooded.
const CONCEALED_ALIASES = new Set(
  [null, 24, 60].flatMap((age) => ["MAN", "WOMAN", "NEUTRAL"].map((gender) => concealedAlias({ age, gender }))),
);

function isConcealedAlias(alias) {
  return CONCEALED_ALIASES.has(alias);
}

module.exports = {
  concealedAlias,
  concealedLine,
  genderWord,
  withArticle,
  capitalizeFirst,
  aliasRow,
  aliasSubject,
  isConcealedAlias,
};
