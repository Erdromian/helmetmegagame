// The Game channel: what #turns says, written down so the web can read it
// (docs/systemdocs/CHAT.md). Discord's #turns is one rolling message that is
// deleted and reposted every turn, so nothing in it survives the turn it was
// posted in — a player reading the game on the web never saw the turn open at
// all. This is the one writer that fixes that: every post into `game:main` goes
// through here, so no call site hand-builds a row and the channel can never
// carry two shapes of the same thing.
//
// Three kinds, and they are the row's `channelKind` (db/lib/turnPostText.js):
// "turn" and "gameend" draw as blocks in the feed, "session" as one subtext
// line, the way it reads on Discord.
//
// Nobody writes into this channel but this file. db/lib/feedAccess.js builds
// the place with `canSpeak: false`, so mayWritePlace refuses every seat —
// the game speaks and nobody answers, exactly as @everyone is denied Send on
// the Discord channel.
//
// Takes `prisma` as a parameter rather than requiring db/index.js back: that
// would resolve to a partial exports object (same as archive.js, placeKey.js).

const { recordArchiveEvent, retractArchiveRow } = require("./archive");
const { GAME_PLACE_KEY } = require("./placeKey");
const { turnFacts } = require("../turnCalendar");
const { turnPlate } = require("./turnBanner");
const { factsLine, rosterLine } = require("./epilogue");
const { formatAntagonistLines } = require("./objectives");
const {
  GAME_POST,
  formatTurnPost,
  formatSessionPost,
  formatEndPost,
} = require("./turnPostText");

// MESSAGE, not TURN_START. /archive folds a TURN_START row into its day divider
// (web/app/(app)/archive/ArchiveTranscript.js) and db/index.js already writes
// one per zone for exactly that, so a TURN_START here would be a post nobody
// could read. MESSAGE + SYSTEM needs no enum change and is already outside
// /archive's Speech filter (web/lib/archiveQuery.js).
const ROW_KIND = "MESSAGE";

async function writeGamePost(prisma, { channelKind, content, turn = null }) {
  return recordArchiveEvent(prisma, {
    kind: ROW_KIND,
    source: "SYSTEM",
    placeKey: GAME_PLACE_KEY,
    channelKind,
    content,
    turn,
  });
}

// The turn post. Called where a turn actually OPENS — the side-effect thunk's
// wrapup step and Start Game — and deliberately not from
// db/lib/turnAnnouncement.js, which three callers use to repost the Discord
// console without a turn having turned.
//
// Belt and braces on top of that: a turn is announced once, so a second call
// for a turn already written down is a no-op rather than a second block.
async function postTurnToGame(prisma, turn, note, { clockFrozen = false, frozenReason = null, phase = null } = {}) {
  if (!turn?.number) return null;
  const already = await prisma.archiveEntry.findFirst({
    where: {
      placeKey: GAME_PLACE_KEY,
      channelKind: GAME_POST.TURN,
      turnNumber: turn.number,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (already) return null;

  const { day, date, clock } = turnFacts(turn, { clockFrozen, frozenReason, phase });
  // The same picture the Discord post carries, if any: only the nuke and the hellfire.
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    select: { game: { select: { nukeDetonatedTurn: true, ascensionFiredTurn: true } } },
  });
  const plate = turnPlate(state?.game);
  return writeGamePost(prisma, {
    channelKind: GAME_POST.TURN,
    turn,
    content: formatTurnPost({ number: turn.number, day, date, clock, note, plate }),
  });
}

// A sitting opening or closing. The words are db/lib/session.js's own, so a
// player who read one face has read both.
async function postSessionToGame(prisma, { open }) {
  return writeGamePost(prisma, {
    channelKind: GAME_POST.SESSION,
    content: formatSessionPost({ open }),
  });
}

// The reveal. Same object the Discord post is built from
// (db/lib/epilogue.js#formatEpilogue) and the same three helpers, so the two
// can never disagree about who died.
async function postGameEndToGame(prisma, epilogue) {
  if (!epilogue) return null;
  const sections = [];
  if (epilogue.antagonists?.length) {
    sections.push({ title: "The antagonists", lines: formatAntagonistLines(epilogue.antagonists) });
  }
  sections.push({
    title: "Who was who",
    lines: epilogue.roster?.length ? epilogue.roster.map(rosterLine) : ["Nobody."],
  });
  return writeGamePost(prisma, {
    channelKind: GAME_POST.GAME_END,
    content: formatEndPost({ facts: factsLine(epilogue.facts), note: epilogue.closingNote, sections }),
  });
}

// Resume takes the ending back (db/lib/gameEnd.js#resumeGameInDb). The Discord
// post stands — it has already been read — but leaving the block in everybody's
// feed would tell a running game it was over every time somebody scrolled.
async function retractGameEndFromGame(prisma) {
  const row = await prisma.archiveEntry.findFirst({
    where: { placeKey: GAME_PLACE_KEY, channelKind: GAME_POST.GAME_END, deletedAt: null },
    orderBy: { seq: "desc" },
    select: { id: true },
  });
  if (!row) return null;
  return retractArchiveRow(prisma, row.id);
}

module.exports = {
  postTurnToGame,
  postSessionToGame,
  postGameEndToGame,
  retractGameEndFromGame,
};
