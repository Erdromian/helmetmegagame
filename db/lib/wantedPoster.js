// The world puts a face up — Wanted and Debtor alike. A character who turns up already Wanted (a creation-time buy) gets three sheets the moment
// they arrive: one in the garrison mess, one in the Censor's office, one pinned to the board in the Square. Debtor works the same shape in
// different rooms — the Merchant's, or the Exactor's Den, by which of the two Debtor tags was taken — and its line never names a zone: the debt
// is the debt wherever the debtor stands. The Wanted line names the zone the character
// STARTED in and never updates — a snapshot going stale the moment they move. Three separate sheets, not one: NoticePost.tagId is @unique, so a
// pinned poster cannot also be sitting in a stash. Takes `prisma`, stays off the @lifeweb/db barrel.

const { mintUnownedPaper } = require("./paperMint");
const { addToRoomStack } = require("./tagWrites");
const { expiryFrom } = require("./turnFormat");
const { DEBTOR_SLUG, DEBTOR_EXACTOR_SLUG } = require("./constants");
// The tag itself lives in wanted.js; this file is only the paper. Both re-exported below.
const { WANTED_SLUG, isWanted } = require("./wanted");
const { hasNoticeboard } = require("./noticeboard");

const DEBTOR_DEBT_OBOLS = 40;
const DEBTOR_STARTING_OBOLS = 20;

// NoticePost.expiresTurn is required, so a poster needs a clock — this is the one that reads as "indefinitely".
const POSTER_TURNS = 30;

// One spec per kind of notice: who authored it, which two rooms get a loose sheet, which Location's noticeboard gets the pinned one (null for
// none), the text, and whether that text needs a zone name.
const NOTICE_SPECS = {
  WANTED: {
    author: "The Cerberon",
    roomSlugs: ["fortress-1-4", "fortress-1-2"],
    boardLocationSlug: "town-2",
    text: (name, zoneName) => `WANTED: ${name}. Last seen in the ${zoneName}.`,
    needsZone: true,
  },
  DEBTOR: {
    author: "The Merchant",
    // The loose sheets go in the Merchant's own rooms (undertown-6); the
    // pinned one goes on the Depot's board next door, which is where the
    // `noticeboard:` attribute stayed when the two were split.
    roomSlugs: ["undertown-6-2", "undertown-6-1"],
    boardLocationSlug: "undertown-5",
    text: (name) => `DEBTOR: ${name}. Owes: ${DEBTOR_DEBT_OBOLS} obols. Send the dockers.`,
    needsZone: false,
  },
  DEBTOR_EXACTOR: {
    author: "The Exactor",
    // His office and the Den's bar. Nothing is pinned: the Den has no
    // noticeboard, and a debt to the Exactor is not announced at the Depot.
    roomSlugs: ["undertown-9-3", "undertown-8-1"],
    boardLocationSlug: null,
    text: (name) => `${name}. Owes the house: ${DEBTOR_DEBT_OBOLS} obols.`,
    needsZone: false,
  },
};

// Which notice each Debtor tag puts up. The two conflict (docs/tags.yaml), so a character holds one at most.
const DEBTOR_NOTICES = [
  [DEBTOR_SLUG, NOTICE_SPECS.DEBTOR],
  [DEBTOR_EXACTOR_SLUG, NOTICE_SPECS.DEBTOR_EXACTOR],
];

function heldDebts(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return DEBTOR_NOTICES.filter(([slug]) => held.has(slug)).map(([, spec]) => spec);
}

function isDebtor(heldSlugs) {
  return heldDebts(heldSlugs).length > 0;
}

// Puts the three sheets up for one notice spec. Best-effort by contract: a poster may never cost a character that already exists.
async function postNotices(prisma, character, openTurn, spec) {
  const zoneName = character?.zone?.name ?? character?.zoneName ?? null;
  if (!character?.id) return { rooms: 0, pinned: false };
  if (spec.needsZone && !zoneName) return { rooms: 0, pinned: false };

  const text = spec.needsZone ? spec.text(character.name, zoneName) : spec.text(character.name);
  const turnNumber = openTurn?.number ?? null;

  const rooms = await prisma.room.findMany({
    where: { slug: { in: spec.roomSlugs } },
    select: { id: true },
  });
  const board = spec.boardLocationSlug
    ? await prisma.location.findUnique({ where: { slug: spec.boardLocationSlug }, select: { id: true, attributes: true } })
    : null;
  // The board can be gone: a GM may destroy a Noticeboard structure (db/lib/structureGrants.js). A notice pinned where there is no board
  // is one nobody can read, and it would come back the moment somebody built a new board there. The loose sheets still go out.
  const boardStands = board != null && hasNoticeboard(board);

  // One transaction per sheet rather than one for all three — Postgres aborts a whole transaction on the first failed statement, so batching
  // would turn one unlucky waybill code into three lost posters.
  let posted = 0;
  for (const room of rooms) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${room.id}`, spec.author, text);
      await addToRoomStack(tx, room.id, tag.id, 1, {});
    });
    posted += 1;
  }

  let pinned = false;
  if (boardStands && turnNumber != null) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${board.id}`, spec.author, text);
      await tx.noticePost.create({
        data: {
          locationId: board.id,
          tagId: tag.id,
          // Nullable by design: a notice outlives whoever pinned it, and neither the Cerberon nor the Merchant are a character.
          postedById: null,
          postedTurn: turnNumber,
          expiresTurn: expiryFrom(turnNumber, POSTER_TURNS),
        },
      });
    });
    pinned = true;
  }

  return { rooms: posted, pinned };
}

async function postWantedPosters(prisma, character, openTurn) {
  return postNotices(prisma, character, openTurn, NOTICE_SPECS.WANTED);
}

async function postDebtorNotices(prisma, character, openTurn, heldSlugs) {
  for (const spec of heldDebts(heldSlugs)) await postNotices(prisma, character, openTurn, spec);
}

module.exports = {
  isWanted,
  postWantedPosters,
  WANTED_SLUG,
  isDebtor,
  postDebtorNotices,
  DEBTOR_STARTING_OBOLS,
};
