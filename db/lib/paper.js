// Paper: what a sheet is, what it says, and who gets to find out.
// See docs/systemdocs/PAPERWORK.md.
//
// A written sheet is a Tag row minted at runtime with `custom: true` and
// `ephemeral: true` — the same shape as a crate (db/lib/depotCrates.js) or a
// corpse (db/lib/corpseMint.js), and for the same reason: being a tag buys
// carry weight, transfers, room stashes, theft and looting for free rather
// than needing a parallel inventory.
//
// What makes paper different from every other tag in the catalog is that its
// text is PRIVATE. Every other tag's description is the same sentence for
// everybody; a letter's depends on the reader's eyes and letters. So the text
// lives on Tag.paperText, which TAG_CHIP_FIELDS never selects, and the
// description a viewer actually sees is composed here, per request.
//
// That is not a nicety. web/lib/referenceData.js#getVisibleTags ships the
// WHOLE catalog to every signed-in browser. A letter's text sitting in
// `description` would publish every letter in the game to everyone playing it.
//
// No Prisma import — both faces compose the same sentence.

const { readBlock } = require("./reading");

// The blank catalog tag. Stackable stock, not a document: it carries no
// paperKind at all, which is what tells it apart from a sheet somebody wrote
// on and then rubbed out (there is no such thing — writing is append-only).
const PAPER_SLUG = "paper";
// The craftable blank book (docs/tags.yaml): ten sheets bound with nothing in
// them yet. Writing on one is what mints a BOOK row, the way writing on a
// sheet mints a PAPER row.
const BLANK_BOOK_SLUG = "blank-book";

// Where every paper row lives, catalog and runtime alike. Same idiom as
// CORPSE_GROUP_SLUG: a written note is per-character and never in
// docs/tags.yaml, so the GROUP is what carries the colour and what code can
// match on, rather than any catalog flag.
const PAPER_GROUP_SLUG = "items-paper";


// What the text boxes will take. Here rather than beside the server actions
// because BOTH faces need them — the counter under the box has to promise
// exactly what the action will accept, and three mirrored numbers is three
// things to drift. This file is prisma-free (it requires only ./reading, which
// requires only ./examineVision), so a "use client" component may import it.
//
// A sheet can be written on again, so WRITE_MAX is a per-pass cap, not a
// lifetime one. A book cannot, so BOOK_MAX is the whole thing.
const WRITE_MAX = 2000;
const BOOK_MAX = 12000;
const TITLE_MAX = 60;

const BLANK_LINE = "*Blank paper.*";

// What a book says when you are not holding it. Every other catalog tag's
// description is the same sentence for everybody, but a book's is its whole
// contents — and the catalog goes to every signed-in browser, so composing the
// text for anyone who has not picked the book up would publish the Library to
// the whole game. Reaching the shelf is meant to be the cost.
const CLOSED_BOOK_LINE = "A bound book. You would have to pick it up to read it. ‡";
const SEALED_LINE = "Opening it permanently breaks the seal. This one bears a seal:";
const BROKEN_LINE = "An envelope with a broken seal. The wax looks like:";

// A stamp with no mark on it yet — the Merchant's, before any Merchant exists.
const UNMARKED_SEAL = "an unreadable smudge";

// Is this row a document rather than an ordinary tag?
function isPaper(tag) {
  return Boolean(tag?.paperKind);
}

// A bound book. Written once, at binding, and never appended to again — that
// single rule is the whole difference between a book and a sheet.
function isBook(tag) {
  return tag?.paperKind === "BOOK";
}

// Is this row a wax stamp?
//
// Carrying a mark is most of it, but not all: a spent envelope keeps the mark
// it was broken from (paperMint.js#breakSeal sets sealMark on the BROKEN_SEAL
// row so the wax can still be described), so the mark alone said yes to one.
// That put broken seals in the Seal picker and let a letter be closed with a
// seal somebody had already opened.
//
// A stamp is stock, a document is not — so the second half is having no
// paperKind at all, the same test isPaper()/isBook() read from the other side.
function isSeal(tag) {
  return Boolean(tag?.sealMark) && !tag?.paperKind;
}

// What a wax stamp presses into the wax. Falls back rather than printing
// "null" into a letter nobody can then identify.
function markOf(tag) {
  return tag?.sealMark || UNMARKED_SEAL;
}

// The sentence THIS viewer sees on THIS row.
//
// `viewer` is { tags, phase, indoors } — the same shape readBlock takes, with
// the tags being the viewer's own CharacterTag rows. Pass nothing and the
// reader is treated as unable to read, which is the safe direction: a vision
// gate should fail closed.
//
// A SEALED letter's text is never composed, literate viewer or not. That is
// what the seal IS. Reading it means breaking it, which is a Consume and
// leaves the envelope behind as evidence.
function paperDescription(tag, viewer = null) {
  // The blank catalog tag carries no paperKind — it is stock, not a document —
  // so it falls through here to its own authored description, which IS
  // BLANK_LINE. Kept as one string in docs/tags.yaml rather than special-cased
  // by slug, so the chip, the Write picker and the Depot shelf cannot drift.
  if (!isPaper(tag)) return tag?.description ?? null;

  if (tag.paperKind === "SEALED") {
    return `${SEALED_LINE} ${markOf(tag)} ‡`;
  }
  if (tag.paperKind === "BROKEN_SEAL") {
    return `${BROKEN_LINE} ${markOf(tag)} ‡`;
  }

  const text = (tag.paperText ?? "").trim();
  // `holdsIt` is passed only by callers that ship the whole catalog at once
  // (web/lib/referenceData.js). Everywhere else the row IS the thing in the
  // reader's hands, so an absent flag means "yes". A book always has text —
  // both writers refuse an empty one — so there is no blank-book case.
  if (isBook(tag) && viewer?.holdsIt === false) return CLOSED_BOOK_LINE;
  if (!text) return BLANK_LINE;

  const blocked = readBlock(viewer?.tags ?? [], {
    phase: viewer?.phase ?? null,
    indoors: viewer?.indoors ?? true,
  });
  return blocked ?? text;
}

// The title a freshly written sheet wears.
//
// DELIBERATELY ANONYMOUS. Tag.name travels everywhere a tag does — the Transfer
// dialog, the Loot panel, a room's Storage readout, the bot's inspect embed —
// and none of those surfaces knows anything about literacy. A title reading
// "hand of Ada" would therefore hand every one of them the one fact the whole
// system exists to protect, to readers and illiterates alike, and would gut
// both anonymous notice-pinning and any future use of the Forger tag.
//
// So the name says nothing and the DESCRIPTION says everything, because the
// description is the one field composed per viewer (paperDescription above).
//
// It used to say "A Note (XY-1234)" — a waybill code, and the only reason for
// it was that Tag.name was @unique, so every sheet needed a title no other tag
// had. That made the object's own name into its database key, which is what a
// slug is for and what `slug` on this row already is. The constraint is gone
// and so is the code. Ada tells her two notes apart by reading them, which is
// the only way anybody was ever meant to.
function paperName() {
  return "A Note";
}

// Two letters, four digits — the same shape as a Depot shipment id, and for
// the same reason: it has to read like something stamped on the object rather
// than like a database key.
//
// No longer used for paper, which is just "A Note" now. It still breaks a name
// collision for the two kinds of row that DO want to be told apart on sight —
// a disguise (db/lib/disguiseMint.js) and a photograph (photoMint.js), where
// two identically named ones in a list are genuinely confusing.
const NOTE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

function noteCode(rng = Math.random) {
  const a = NOTE_LETTERS[Math.floor(rng() * NOTE_LETTERS.length)];
  const b = NOTE_LETTERS[Math.floor(rng() * NOTE_LETTERS.length)];
  return `${a}${b}-${String(Math.floor(rng() * 9000) + 1000)}`;
}

// A stamp's SHORT label, for titling the letters it closes. The mark itself is
// a whole sentence ("A cross with a rapier on one side and a skull on the
// other.") and would make an unreadable title, so this pulls the short form out
// of the stamp's own name: "Wax Seal (Three Cups)" -> "Three Cups", "Banneret's
// Wax Stamp" -> "Banneret".
//
// Derived rather than authored as a third field, because both name shapes in
// the catalog already carry it and a third field is a third thing to drift.
function sealLabel(stampTag) {
  const name = stampTag?.name ?? "";
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const possessive = name.match(/^(.+?)'s\s+Wax\s+Stamp$/i);
  if (possessive) return possessive[1].trim();
  return name.trim() || "an unknown seal";
}

// A book wears its title, unlike a note, which is deliberately anonymous. The
// contents are still gated — paperDescription decides who may read them — but
// what is written on the spine is what the binder chose to advertise, and a
// shelf of books called "A Note (TG-4596)" would be useless to everybody.
function bookName(title) {
  const clean = (title ?? "").trim();
  return clean ? `${clean} (a book)` : "An Untitled Book";
}

function sealedName(label) {
  return `Sealed Letter (${label})`;
}

function brokenSealName(label) {
  return `Broken Seal (${label})`;
}

// Appending, which is the only way a sheet ever changes. You can always write
// more; you can never unwrite. A blank line between passages so two hands, or
// one hand on two days, do not run together into a paragraph nobody can parse.
function appendText(existing, addition) {
  const before = (existing ?? "").trim();
  const after = (addition ?? "").trim();
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`;
}

module.exports = {
  PAPER_SLUG,
  BLANK_BOOK_SLUG,
  PAPER_GROUP_SLUG,
  WRITE_MAX,
  BOOK_MAX,
  TITLE_MAX,
  BLANK_LINE,
  CLOSED_BOOK_LINE,
  UNMARKED_SEAL,
  isPaper,
  isBook,
  isSeal,
  markOf,
  sealLabel,
  bookName,
  paperDescription,
  paperName,
  noteCode,
  sealedName,
  brokenSealName,
  appendText,
};
