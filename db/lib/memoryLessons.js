// What a line said in a room TEACHES the people who heard it — the pure half
// of db/lib/memoryHearing.js (docs/systemdocs/MEMORIES.md §2b). No database,
// no requires beyond the name formatter, so db/test/memoryLessons.test.js can
// drive it with plain objects.
//
// The doc's two rules, and the one Bascinet added on top:
//
//   A NAME is learned when somebody's first or last name is said in a room
//   they are standing in.
//
//   A ROLE is learned when the character says their own role, or when their
//   role and their name are said in the same sentence.
//
//   And only from a speaker who KNOWS. The subject saying it themselves
//   always counts; anybody else counts only if their own Friends entry for
//   the subject already holds that name (and, for a role, that role). The
//   game only ever teaches what is TRUE, so without this rule a question —
//   "is Marrow the Sheriff?" — would be answered by watching whether the
//   Friends list filled in. A guess teaches nothing, a right one included.

const { formatBareName } = require("./characterName");

// A first name shorter than this never counts on its own — "Al" would be
// named by every "al dente". The same floor db/lib/mentions.js uses, less one:
// a lesson is rarer and louder than a ping, and two letters is a real name.
const MIN_NAME = 2;

// Names that are also ordinary words a sentence opens with. One of these only
// counts somewhere a word is not normally capitalised — mid-sentence — so "Will
// you come?" teaches nobody that Will is here, and "Come here, Will" does.
const SENTENCE_START_WORDS = new Set(
  [
    "a", "an", "and", "are", "art", "august", "be", "bill", "but", "can", "chase", "dawn", "did", "do", "faith",
    "frank", "grace", "he", "hope", "hunter", "i", "is", "it", "jack", "joy", "june", "mark", "may", "no", "not",
    "page", "pat", "rob", "rose", "she", "sky", "so", "sue", "summer", "the", "they", "this", "we", "will", "yes",
    "you",
  ],
);

// A chip — `{char:<id>|<Name>}` — reads as the name it froze: a speaker who
// picked somebody off the @ menu said their name. A chip for a hooded or
// disguised subject froze the alias, which matches nobody. Every other token
// (`{tag:…}`, `{resource:…}`) is not speech and is blanked, as is a URL.
const CHAR_CHIP_RE = /\{char:[^{}|\n]*\|([^{}\n]*)\}/g;
const TOKEN_RE = /\{[a-z]+:[^{}\n]*\}/g;
const URL_RE = /https?:\/\/\S+/g;

function speechText(content) {
  if (typeof content !== "string" || !content) return "";
  return content.replace(CHAR_CHIP_RE, (_, name) => ` ${name} `).replace(TOKEN_RE, " ").replace(URL_RE, " ");
}

// Sentences, the doc's unit for "role and name together". A line break ends one
// as surely as a full stop does.
function sentencesOf(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The spelling that counts: capitalised, whatever case the player typed it
// in. Matching is case-SENSITIVE, because "will" and "hand" are words and
// "Will" and "Hand" are more likely to be a name and a title.
function capitalised(word) {
  const w = (word ?? "").trim();
  return w ? w[0].toUpperCase() + w.slice(1) : "";
}

// Every place `form` stands as a whole word in `sentence`, Unicode-aware (see
// db/lib/mentions.js#namesIn for why not `\b`). An apostrophe is a boundary,
// so "Marrow's hammer" names Marrow.
function positionsOf(sentence, form) {
  if (!form) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(form)}(?![\\p{L}\\p{N}_])`, "gu");
  const out = [];
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) out.push(m.index);
  return out;
}

// Whether index `at` opens the sentence — nothing but punctuation, quotes or
// space before it.
function opensSentence(sentence, at) {
  return !/[\p{L}\p{N}]/u.test(sentence.slice(0, at));
}

// The name forms a candidate can be heard by: their first name, and their last
// name when no one else in the room shares it. The Baron's whole house wears one
// surname, so "Vask" said in the throne room names nobody in particular.
function nameFormsFor(candidate, lastNameCounts) {
  const forms = [];
  const first = capitalised(candidate.firstName);
  if (first.length >= MIN_NAME) forms.push(first);
  const last = capitalised(candidate.lastName);
  if (last.length >= MIN_NAME && (lastNameCounts.get(last) ?? 0) === 1 && last !== first) forms.push(last);
  return forms;
}

// The first form of `forms` said in this sentence, or null. A form that is
// also a common opening word does not count where it opens the sentence.
function nameSaidIn(sentence, forms) {
  for (const form of forms) {
    const hits = positionsOf(sentence, form).filter(
      (at) => !(SENTENCE_START_WORDS.has(form.toLowerCase()) && opensSentence(sentence, at)),
    );
    if (hits.length > 0) return { form, hits };
  }
  return null;
}

// The words a role is heard by: the seat's own name and the character's title,
// which a GM may have hand-edited ("Disgraced Knight").
function roleWordsFor(candidate) {
  const role = candidate.role;
  if (!role?.examineVisible) return [];
  return [...new Set([capitalised(role.name), capitalised(candidate.roleTitle)].filter(Boolean))];
}

// Whether this sentence names the role — and, when `name` is given, names it
// beside that name. A role word that OPENS a sentence only counts when the name
// follows it straight away ("Sheriff Marrow, a word"), so "Hand me the knife,
// Marrow" teaches nobody that Marrow is the Hand.
function roleSaidIn(sentence, roleWords, name) {
  for (const word of roleWords) {
    for (const at of positionsOf(sentence, word)) {
      if (!opensSentence(sentence, at)) return true;
      if (!name) continue;
      const after = sentence.slice(at + word.length).replace(/^[\s,]+/, "");
      if (after.startsWith(name.form)) return true;
    }
  }
  return false;
}

// Whether the speaker's own entry holds the name form that was said.
function entryHoldsName(entry, form) {
  if (!entry?.name) return false;
  return positionsOf(entry.name.toLowerCase(), form.toLowerCase()).length > 0;
}

// The whole question. `speaker` and every candidate carry
// `{ id, firstName, lastName, roleTitle, role: { slug, name, examineVisible } }`;
// `candidates` are the people in the room whose own identity is showing (never
// a hood or a forced name — the caller filters those), the speaker included if
// they are. `speakerKnows` maps a subject id to the speaker's own entry
// `{ name, roleSlug }`.
//
// Returns one lesson per subject: `{ subjectId, name, role, entry }`, where
// `name` means "a listener with no entry gets one" and `role` means "a
// listener's empty role gets filled". `entry` is the row a new entry is made
// from.
function lessonsFrom({ content, speaker, candidates, speakerKnows = new Map() }) {
  const text = speechText(content);
  if (!text.trim() || !speaker?.id) return [];
  const sentences = sentencesOf(text);
  const lastNameCounts = new Map();
  for (const c of candidates ?? []) {
    const last = capitalised(c.lastName);
    if (last) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
  }

  const lessons = [];
  for (const candidate of candidates ?? []) {
    if (!candidate?.id) continue;
    const self = candidate.id === speaker.id;
    const entry = self ? null : speakerKnows.get(candidate.id);
    // Somebody the speaker has never met is somebody the speaker cannot name.
    if (!self && !entry) continue;

    const forms = nameFormsFor(candidate, lastNameCounts);
    const roleWords = roleWordsFor(candidate);
    const knowsRole = self || (Boolean(entry?.roleSlug) && entry.roleSlug === candidate.role?.slug);

    let name = false;
    let role = false;
    for (const sentence of sentences) {
      const said = nameSaidIn(sentence, forms);
      if (said && (self || entryHoldsName(entry, said.form))) name = true;
      if (knowsRole && roleWords.length > 0) {
        // Your own title said by you is an introduction on its own; anybody
        // else has to say it beside your name.
        if (said && roleSaidIn(sentence, roleWords, said)) role = true;
        else if (self && roleSaidIn(sentence, roleWords, null)) role = true;
      }
    }
    if (!name && !role) continue;
    lessons.push({
      subjectId: candidate.id,
      name,
      role,
      entry: {
        name: formatBareName(candidate) || candidate.name || "Someone",
        roleText: role ? (candidate.roleTitle ?? candidate.role?.name ?? null) : null,
        roleSlug: role ? (candidate.role?.slug ?? null) : null,
      },
    });
  }
  return lessons;
}

module.exports = { lessonsFrom, speechText, sentencesOf, SENTENCE_START_WORDS };
