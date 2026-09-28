// Writing, sealing and reading what you carry, both faces (PAPERWORK.md). They
// were web/app/(app)/character/paperActions.js's writePaperImpl, sealLetterImpl
// and readMyPaper and still are — those call the functions here, and so does
// the Discord bot (bot/src/lib/verbs/paper.js). NEITHER write nor seal files a
// request: writing costs nothing and spends no Move. See ./common.js for the
// result shape.
//
// `character` needs name, concealed, location.indoors and tags with the paper
// and concealment fields of each tag (paperActions.js#requireWriter's select).
const { readBlock } = require("../reading");
const { PAPER_SLUG, BLANK_BOOK_SLUG, WRITE_MAX, BOOK_MAX, TITLE_MAX, isBook, isPaper, isSeal, paperDescription, paperView } = require("../paper");
const { writeNewPaper, appendToPaper, sealPaper, bindBook } = require("../paperMint");
const { concealmentFrom, forcedNameFrom, presentedIdentity } = require("../presentedIdentity");
const { cleanCustomText } = require("../customText");
const { isDaylight } = require("../turnClock");
const { refuse, asResult } = require("./common");
const { RING_TEXT } = require("../ringText");

function readerOf(character) {
  return { daylight: isDaylight(), indoors: character.location?.indoors ?? true };
}

// Who signs the paper, internally: the PRESENTED name, so a hooded writer
// doesn't put their real one on a sheet somebody may find. Never shown to
// another player — only tells a GM whose hand it was.
function writerName(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags, character),
    concealment: concealmentFrom(character.tags),
  }).name;
}

// What a character could write on: a blank sheet, a blank book, or a note
// already started.
function writableTags(character) {
  return character.tags.filter(
    (ct) => ct.tag.slug === PAPER_SLUG || ct.tag.slug === BLANK_BOOK_SLUG || ct.tag.paperKind === "PAPER",
  );
}

// What a seal could close: a written sheet. And the stamps to close it with.
function sealableTags(character) {
  return {
    letters: character.tags.filter((ct) => ct.tag.paperKind === "PAPER" && (ct.tag.paperText ?? "").trim()),
    stamps: character.tags.filter((ct) => isSeal(ct.tag)),
  };
}

// --- Write (web: paperActions.js#writePaperImpl) ---------------------------------

function writePaper(prisma, { character, tagId: rawTagId, text: rawText, title: rawTitle }) {
  return asResult(async () => {
    // Same sentence a paper shows a reader who can't read it — naming WHICH of
    // letters or eyes stopped them would leak a condition.
    if (readBlock(character.tags, readerOf(character))) refuse("You can't read this.");
    const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
    if (!held) refuse("You aren't holding that.");
    const writingBook = held.tag.slug === BLANK_BOOK_SLUG;
    const text = String(rawText ?? "").trim().slice(0, writingBook ? BOOK_MAX : WRITE_MAX);
    if (!text) refuse("Write something first.");
    // CLEANED, NOT JUST TRIMMED: a paper's name reaches bot messages.
    const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
    if (writingBook && !title) refuse("Give it a title first.");
    const hand = writerName(character);
    let result;
    await prisma.$transaction(async (tx) => {
      if (writingBook) {
        const [locked] = await tx.$queryRaw`
          SELECT "quantity" FROM "CharacterTag"
          WHERE "characterId" = ${character.id} AND "tagId" = ${held.tagId}
          FOR UPDATE`;
        if (!locked || locked.quantity < 1) refuse("You aren't holding that.");
        result = await bindBook(tx, { id: character.id, name: hand }, held.tagId, title, text);
        return;
      }
      if (held.tag.slug === PAPER_SLUG) {
        result = await writeNewPaper(tx, { id: character.id, name: hand }, held.tagId, text, title);
        return;
      }
      // APPEND-ONLY — nothing anywhere in the game shortens paperText.
      if (held.tag.paperKind === "PAPER") {
        result = await appendToPaper(tx, held.tagId, held.tag.paperText, text);
        return;
      }
      if (held.tag.paperKind === "SEALED") refuse("It's sealed. Break the seal first.");
      if (isBook(held.tag)) refuse("It's bound. You'd have to tear it up and start again.");
      refuse("You can't write on that.");
    });
    return { touched: [character.id], name: result.name, tagId: result.id, line: "Written." };
  });
}

// --- Seal (web: paperActions.js#sealLetterImpl) ------------------------------------

function sealLetter(prisma, { character, tagId: rawTagId, stampTagId: rawStampId, title: rawTitle }) {
  return asResult(async () => {
    const paperRow = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
    const stampRow = character.tags.find((ct) => ct.tagId === String(rawStampId ?? ""));
    if (!paperRow || !stampRow) refuse("You aren't holding that.");
    if (!isSeal(stampRow.tag)) refuse(RING_TEXT.sealNotASeal);
    if (!isPaper(paperRow.tag) || paperRow.tag.paperKind !== "PAPER") refuse("That isn't a letter you can seal.");
    if (!(paperRow.tag.paperText ?? "").trim()) refuse("There's nothing written on it.");
    const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
    let sealed;
    await prisma.$transaction(async (tx) => {
      sealed = await sealPaper(tx, paperRow.tag, stampRow.tag, { title });
    });
    return { touched: [character.id], name: sealed.name, line: "Sealed." };
  });
}

// --- Read (web: paperActions.js#readMyPaper) ---------------------------------------

// The text of a paper you carry, through paperDescription, so a reader who has
// since gone blind gets the same refusal here as everywhere.
function readHeldPaper(prisma, { character, tagId: rawTagId }) {
  return asResult(async () => {
    const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
    if (!held || !isPaper(held.tag)) refuse("You aren't holding that.");
    const reader = { tags: character.tags, ...readerOf(character) };
    return {
      text: paperDescription(held.tag, reader),
      paper: paperView(held.tag, reader),
      kind: held.tag.paperKind,
      name: held.tag.name,
    };
  });
}

module.exports = { writableTags, sealableTags, writePaper, sealLetter, readHeldPaper, writerName };
