// The web half of the message wipe (docs/systemdocs/HALL.md §7, CHANNELS.md §8).
//
// Discord's half deletes: db/lib/messageWipe.js walks every channel and empties
// it. The Hall cannot do that, and should not — ArchiveEntry IS the transcript
// /archive reads, so deleting a row to clear a scene would burn the record to
// tidy the screen. So the Hall reads past the wipe instead: GameConfig
// carries a WATERMARK, and every feed query asks for `seq > <floor>`.
//
// TWO of them, because the wipe has two cadences. `feedWipeSeq` moves on every
// turn and floors loc:/room:/conv: places; `feedWipeSummarySeq` moves only on a
// Dawn and floors zone: places, which is exactly what Discord's sweep clears on
// that slower schedule. Get these crossed and the two faces disagree about
// where the day starts.
//
// One nice consequence: the unread dots reset with the wipe on their own. A
// dot is "the newest seq here, against the newest seq this browser saw here",
// and after a wipe there is no newest seq here until somebody speaks.
//
// Takes `prisma` as a parameter, same reason as archive.js and say.js:
// db/index.js imports this, so requiring it back would resolve to a partial
// exports object.

// The watermark is taken as the wipe BEGINS, not after it, and that is the
// same instant `cutoffMs` names on the Discord side. A message posted while
// the wipe is still walking the map survives on Discord, and it has to
// survive here too, or where you were standing would decide whether what you
// said still exists.
// `summaries` is the Dawn half: pass true and the zone floor moves with the
// turn floor. Both columns go in ONE update, so the pair can never half-land.
async function markFeedWiped(prisma, { summaries = false } = {}) {
  try {
    const newest = await prisma.archiveEntry.aggregate({ _max: { seq: true } });
    const seq = newest?._max?.seq ?? null;
    if (seq === null || seq === undefined) return null;
    const data = { feedWipeSeq: seq };
    if (summaries) data.feedWipeSummarySeq = seq;
    await prisma.gameConfig.update({ where: { id: 1 }, data });
    return seq;
  } catch (err) {
    // Best-effort, like every other step of the wipe. A watermark that failed
    // to move shows a player yesterday's scene; it never loses anything.
    console.error("Feed wipe watermark failed:", err);
    return null;
  }
}

// The other floor, and the one that is always on: everything belonging to a
// PREVIOUS game.
//
// Restart Game deliberately keeps ArchiveEntry — it is the transcript
// /archive reads, and LOBBY.md §8 lists it as kept. But the Hall is the live
// room, not the record, so last game's scenes have no business rendering
// under the names of characters who no longer exist. `seq` only ever goes up,
// so every row of every finished game sits below every row of this one, and
// the highest of them IS the floor.
//
// It is read as the highest seq NOT in this game rather than the lowest seq in
// it, so a freshly wiped game with nothing said in it yet shows an empty Hall
// instead of yesterday's. A row with no gameId at all predates the column, so
// it is old by definition and sits below the line too.
const GAME_FLOOR_TTL_MS = 30 * 1000;
let gameFloorMemo = { gameId: null, seq: 0n, at: 0 };

async function previousGameFloor(prisma) {
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  const gameId = state?.gameId ?? null;
  // No game to be current means no way to tell old rows from new ones, and
  // the safe answer to that is to hide nothing.
  if (!gameId) return 0n;

  const now = Date.now();
  if (gameFloorMemo.gameId === gameId && now - gameFloorMemo.at < GAME_FLOOR_TTL_MS) {
    return gameFloorMemo.seq;
  }

  const rows = await prisma.$queryRaw`
    SELECT MAX("seq") AS "seq"
    FROM "ArchiveEntry"
    WHERE "gameId" IS NULL OR "gameId" <> ${gameId}
  `;
  const seq = rows?.[0]?.seq == null ? 0n : BigInt(rows[0].seq);
  gameFloorMemo = { gameId, seq, at: now };
  return seq;
}

// The two floors every feed read filters above, as BigInts: `turn` for
// loc:/room:/conv: places, `summary` for zone: places. The watermarks are only
// half of each — see previousGameFloor above for the other half, which is not
// tied to the wipe toggle and applies to both.
async function feedWipeFloors(prisma) {
  try {
    const [config, gameFloor] = await Promise.all([
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: { messageWipeEnabled: true, feedWipeSeq: true, feedWipeSummarySeq: true },
      }),
      previousGameFloor(prisma),
    ]);
    const on = Boolean(config?.messageWipeEnabled);
    const highest = (a, b) => (a > b ? a : b);
    return {
      turn: highest(on ? BigInt(config.feedWipeSeq ?? 0) : 0n, gameFloor),
      summary: highest(on ? BigInt(config.feedWipeSummarySeq ?? 0) : 0n, gameFloor),
    };
  } catch (err) {
    // Reading nothing must never mean hiding everything: the safe failure
    // here is the pre-wipe behaviour, which is a floor of zero.
    console.error("Feed wipe floors failed:", err);
    return { turn: 0n, summary: 0n };
  }
}

// Which of the two a given place reads. A zone: key is the summary channel,
// wiped only at Dawn; everything else clears every turn.
function floorForPlace(floors, placeKey) {
  return isSummaryPlace(placeKey) ? floors.summary : floors.turn;
}

function isSummaryPlace(placeKey) {
  return typeof placeKey === "string" && placeKey.startsWith("zone:");
}

// The lower of the two. A reader that has to pick ONE number for a mixed set
// of places — the stream's high-water clamp — must use this, or a zone row
// above the turn floor gets dropped as "already sent".
function lowestFloor(floors) {
  return floors.summary < floors.turn ? floors.summary : floors.turn;
}

// The wipe calls this so the Hall empties at once rather than at the end of
// the memo's half minute.
function forgetGameFloor() {
  gameFloorMemo = { gameId: null, seq: 0n, at: 0 };
}

// The same floor as a Prisma `seq` filter, folded into whatever else a query
// already asks of the column. `gt: 0n` is harmless but noisy, so it is left
// out entirely when the wipe is off.
function seqFilterAbove(floor, extra = {}) {
  if (!floor || floor <= 0n) return Object.keys(extra).length > 0 ? extra : undefined;
  return { ...extra, gt: extra.gt !== undefined && extra.gt > floor ? extra.gt : floor };
}

// A Prisma `where` fragment for a query spanning a MIXED set of places, where
// one `seq` filter can no longer serve all of them. Splits the zone: keys off
// and ORs the two clauses; with only one kind present it stays a plain
// single-clause where, which is the common case.
function placeSeqWhere(floors, placeKeys, extra = {}) {
  const summaryKeys = placeKeys.filter(isSummaryPlace);
  const turnKeys = placeKeys.filter((key) => !isSummaryPlace(key));

  const clause = (keys, floor) => ({
    placeKey: { in: keys },
    seq: seqFilterAbove(floor, extra),
  });

  if (summaryKeys.length === 0) return clause(turnKeys, floors.turn);
  if (turnKeys.length === 0) return clause(summaryKeys, floors.summary);
  return { OR: [clause(turnKeys, floors.turn), clause(summaryKeys, floors.summary)] };
}

module.exports = {
  markFeedWiped,
  feedWipeFloors,
  floorForPlace,
  lowestFloor,
  isSummaryPlace,
  forgetGameFloor,
  seqFilterAbove,
  placeSeqWhere,
};
