// The two singleton rows a game runs on, and the questions asked of them.
//
//   GameConfig  DURABLE host configuration. Knobs, feature switches, Discord
//               pointers, the REST breaker. Restart Game never touches it.
//   GameState   PER-GAME state: the phase, when it started, the Lifeweb's
//               blood, the bomb, the bell. Restart Game deletes and recreates
//               it (web/app/(app)/gm/dev/actions.js#wipeGameData).
//
// Both are read through here rather than by an inline findUnique at every
// call site, so a reader that needs a moved field cannot reach for the wrong
// row. Takes the client as a parameter (a tx or the root prisma), the
// db/lib/dm.js convention.

async function getGameConfig(db) {
  return db.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// The id the very first Game row was backfilled with, in the migration that
// gave games their own table (20260911060000_games_outlive_the_wipe). The
// bootstrap below connects to it by name rather than creating a fresh cuid,
// so two upserts racing on an empty database cannot end up making two games.
// It is a bootstrap key and nothing else — every game after the first one is
// an ordinary cuid, and there is no ordinal any more to connect on instead.
const BOOTSTRAP_GAME_ID = "game1";

// What a brand-new GameState row is: CLOSED, and pointing at a game — made on
// the spot if a fresh database has no Game yet. Every upsert of the row uses
// this so none of them can trip on the required gameId.
const GAME_STATE_CREATE = {
  id: 1,
  game: {
    connectOrCreate: { where: { id: BOOTSTRAP_GAME_ID }, create: { id: BOOTSTRAP_GAME_ID } },
  },
};

async function getGameState(db) {
  return db.gameState.upsert({ where: { id: 1 }, update: {}, create: GAME_STATE_CREATE });
}

// Read-only variants for hot read paths: an upsert takes a write lock on the
// row, which a page render has no business holding.
async function readGameConfig(db, select) {
  return db.gameConfig.findUnique({ where: { id: 1 }, ...(select ? { select } : {}) });
}

async function readGameState(db, select) {
  return db.gameState.findUnique({ where: { id: 1 }, ...(select ? { select } : {}) });
}

// The denominator for every weighted seat. Start Game stamps the real one;
// until then the GM's "expected players" knob stands in, which is what lets a
// GM test-create before a lobby has gathered.
function effectivePlayerCount(config, state) {
  return state?.playerCount ?? config?.playerCount ?? 80;
}

// Whether turns tick at all. Both callers of advanceTurn check the phase
// themselves; this is for everything that derives a DEADLINE from the clock
// (db/lib/turnClock.js#moveWindow) — a game that is not running has no end
// time to count back from, exactly as a paused cron does not.
function isClockRunning(config, state) {
  return state?.phase === "RUNNING" && !config?.autoTurnAdvanceDisabled;
}

// One round trip for the readers that only want the boolean.
async function clockFrozen(db) {
  const [config, state] = await Promise.all([
    readGameConfig(db, { autoTurnAdvanceDisabled: true }),
    readGameState(db, { phase: true }),
  ]);
  return !isClockRunning(config, state);
}

module.exports = {
  GAME_STATE_CREATE,
  getGameConfig,
  getGameState,
  readGameState,
  effectivePlayerCount,
  clockFrozen,
};
