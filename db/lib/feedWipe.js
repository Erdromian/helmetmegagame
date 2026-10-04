// Web half of the message wipe (CHAT.md §7, CHANNELS.md §8). Discord deletes;
// Chat reads past a GameConfig WATERMARK instead (`seq > <floor>`), since
// ArchiveEntry IS the transcript /archive reads. TWO watermarks: `feedWipeSeq`
// every turn (loc:/room:/conv:), `feedWipeSummarySeq` only on a day boundary (zone:) —
// cross these and the faces disagree where the day starts. Takes `prisma`, same reason as archive.js/say.js.

// Taken as the wipe BEGINS (Discord's `cutoffMs`); `summaries` is the once-a-day half, both columns go in ONE update, never half-landed.
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
    console.error("Feed wipe watermark failed:", err);
    return null;
  }
}

// Always-on floor for everything from a PREVIOUS game (Restart Game keeps
// ArchiveEntry, LOBBY.md §8). Highest seq NOT in this game, not lowest seq in it, so a fresh empty game shows empty Chat, not yesterday's.
//
// The read walks back through every row of the current game (tens of thousands by mid-game), so it
// runs once at a time and stops running at all once its answer can no longer move. It can move only
// early on: for up to half a minute after a wipe, a process holding a stale archive.js#currentGameId
// memo still stamps rows with the OLD game id, above the new game's first seqs. Past
// GAME_FLOOR_SETTLE_MS nothing can, and the floor is final for the life of the game. On 2026-10-04
// eighty copies of this query, all fired by one expired memo, stalled the database at a turn end.
const GAME_FLOOR_TTL_MS = 30 * 1000;
const GAME_FLOOR_SETTLE_MS = 5 * 60 * 1000;
const NO_GAME_FLOOR = { gameId: null, seq: 0n, at: 0, final: false, pending: null };
let gameFloorMemo = NO_GAME_FLOOR;

async function previousGameFloor(prisma) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    select: { gameId: true, game: { select: { createdAt: true } } },
  });
  const gameId = state?.gameId ?? null;
  // No current game means no way to tell old rows from new; safe answer is to hide nothing.
  if (!gameId) return 0n;

  const now = Date.now();
  const memo = gameFloorMemo;
  if (memo.gameId === gameId) {
    if (memo.final || (memo.at > 0 && now - memo.at < GAME_FLOOR_TTL_MS)) return memo.seq;
    // Every caller waits on the one read already in flight rather than starting its own.
    if (memo.pending) return memo.pending;
  }

  const createdAt = state?.game?.createdAt ? new Date(state.game.createdAt).getTime() : null;
  const pending = (async () => {
    const rows = await prisma.$queryRaw`
      SELECT MAX("seq") AS "seq"
      FROM "ArchiveEntry"
      WHERE "gameId" IS NULL OR "gameId" <> ${gameId}
    `;
    return rows?.[0]?.seq == null ? 0n : BigInt(rows[0].seq);
  })();
  const keep = memo.gameId === gameId ? memo : { ...NO_GAME_FLOOR, gameId };
  gameFloorMemo = { ...keep, pending };

  try {
    const seq = await pending;
    // A wipe (forgetGameFloor) or another game's read may have replaced the memo meanwhile.
    if (gameFloorMemo.pending === pending) {
      const final = createdAt !== null && now - createdAt > GAME_FLOOR_SETTLE_MS;
      gameFloorMemo = { gameId, seq, at: now, final, pending: null };
    }
    return seq;
  } catch (err) {
    if (gameFloorMemo.pending === pending) gameFloorMemo = { ...gameFloorMemo, pending: null };
    throw err;
  }
}

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
      // Deadchat only ever stops at the GAME boundary — neither wipe watermark applies to it. See
      // isPersistentPlace below for why.
      persist: gameFloor,
    };
  } catch (err) {
    console.error("Feed wipe floors failed:", err);
    return { turn: 0n, summary: 0n, persist: 0n };
  }
}

// Persistent first: a persistent place is never also a summary, but checking it first says which
// rule wins without relying on that.
function floorForPlace(floors, placeKey) {
  if (isPersistentPlace(placeKey)) return floors.persist ?? 0n;
  return isSummaryPlace(placeKey) ? floors.summary : floors.turn;
}

function isSummaryPlace(placeKey) {
  return typeof placeKey === "string" && placeKey.startsWith("zone:");
}

// DEADCHAT survives every turn, and this is what makes the two faces agree about that. The Discord
// wipe already never touches it — runMessageWipe walks zone summaries, Location channels and the
// special channels marked `wipe: "clear"`, and Deadchat is in none of those loops. Without this
// arm the web would still apply the per-turn floor, so a ghost would find yesterday's conversation
// on Discord and an empty room in /chat.
//
// It still stops at `persist` (the previous-game floor), so a new game starts with an empty
// Deadchat rather than the last game's dead still talking.
//
// The GAME CHANNEL is persistent for a related reason: it is the record of the turns themselves
// (db/lib/gameChannel.js), and a turn post wiped at the moment the next turn opens would be a
// channel that is empty every time anybody looks at it. It stops at `persist` too, so a new game
// starts with no memory of the last one's turns.
function isPersistentPlace(placeKey) {
  if (typeof placeKey !== "string") return false;
  return placeKey.startsWith("dead:") || placeKey.startsWith("game:");
}

// A reader picking ONE number for a mixed set of places must use this, or a zone row above the turn floor gets dropped as "already sent".
// `persist` is in the min too, and is usually the whole answer: it is the lowest of the three, and
// a catch-up scan that started above it would skip every Deadchat row older than this turn.
function lowestFloor(floors) {
  const candidates = [floors.turn, floors.summary, floors.persist ?? 0n];
  return candidates.reduce((lowest, next) => (next < lowest ? next : lowest));
}

function forgetGameFloor() {
  gameFloorMemo = NO_GAME_FLOOR;
}

function seqFilterAbove(floor, extra = {}) {
  if (!floor || floor <= 0n) return Object.keys(extra).length > 0 ? extra : undefined;
  return { ...extra, gt: extra.gt !== undefined && extra.gt > floor ? extra.gt : floor };
}

// A query spanning MIXED places groups the keys by which floor each takes and ORs the groups. One
// group present stays a plain single clause, which is the common case: a living player's list holds
// no dead: key at all, and a ghost's holds exactly one.
function placeSeqWhere(floors, placeKeys, extra = {}) {
  const groups = [
    [placeKeys.filter(isPersistentPlace), floors.persist ?? 0n],
    [placeKeys.filter(isSummaryPlace), floors.summary],
    [placeKeys.filter((key) => !isSummaryPlace(key) && !isPersistentPlace(key)), floors.turn],
  ].filter(([keys]) => keys.length > 0);

  const clause = (keys, floor) => ({
    placeKey: { in: keys },
    seq: seqFilterAbove(floor, extra),
  });

  // No keys at all: keep the old shape rather than an empty OR, which matches everything.
  if (groups.length === 0) return clause([], floors.turn);
  if (groups.length === 1) return clause(groups[0][0], groups[0][1]);
  return { OR: groups.map(([keys, floor]) => clause(keys, floor)) };
}

module.exports = {
  markFeedWiped,
  feedWipeFloors,
  floorForPlace,
  isPersistentPlace,
  lowestFloor,
  isSummaryPlace,
  forgetGameFloor,
  seqFilterAbove,
  placeSeqWhere,
};
