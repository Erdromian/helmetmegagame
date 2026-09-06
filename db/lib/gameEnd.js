// Ending a game, from either direction: the superadmin's End Game button or
// the bomb (docs/systemdocs/LOBBY.md §7). One function so both write the same
// things — GameState to ENDED with the archive open, the Game row's end,
// note and epilogue — and both hand back the same Discord post for the
// caller to send. Ended locks only the clock: late join and every other
// action keep working until Restart Game.

const { buildEpilogue, formatEpilogue } = require("./epilogue");
const { postMessageBatched } = require("./discordRest");

async function endGameInDb(db, { closingNote = null, reason = "gm", actorDiscordUserId = "system" } = {}) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, include: { game: true } });
  if (!state || state.phase === "ENDED") return { ended: false, state };

  const endedAt = new Date();
  const note = closingNote ?? state.closingNote ?? null;
  const epilogue = await buildEpilogue(db, { game: state.game, state: { ...state, endedAt }, closingNote: note });

  await db.gameState.update({
    where: { id: 1 },
    data: { phase: "ENDED", endedAt, closingNote: note, archiveVisible: true },
  });
  await db.game.update({
    where: { id: state.gameId },
    data: { endedAt, closingNote: note, playerCount: state.playerCount, startedAt: state.startedAt, epilogue },
  });
  await db.auditLog
    .create({ data: { actorDiscordUserId, actionType: "game_ended", details: { reason, closingNote: note } } })
    .catch((err) => console.error("game_ended audit failed:", err));

  return { ended: true, epilogue, post: formatEpilogue(epilogue, { number: state.game?.number }) };
}

// The undo. The archive stays open — closing it again would re-hide what
// every player has already seen — and the epilogue stays on the Game row
// until the next ending overwrites it.
async function resumeGameInDb(db, { actorDiscordUserId = "system" } = {}) {
  const state = await db.gameState.findUnique({ where: { id: 1 } });
  if (!state || state.phase !== "ENDED") return { resumed: false };
  await db.gameState.update({ where: { id: 1 }, data: { phase: "RUNNING", endedAt: null } });
  await db.game.update({ where: { id: state.gameId }, data: { endedAt: null } });
  await db.auditLog
    .create({ data: { actorDiscordUserId, actionType: "game_resumed", details: {} } })
    .catch((err) => console.error("game_resumed audit failed:", err));
  return { resumed: true };
}

// Posts the reveal to #turns. Best-effort; the game is already ended.
async function postGameEnded(db, post) {
  const config = await db.gameConfig.findUnique({ where: { id: 1 }, select: { turnsConsoleChannelId: true } });
  if (!config?.turnsConsoleChannelId) return false;
  await postMessageBatched(config.turnsConsoleChannelId, post);
  return true;
}

module.exports = { endGameInDb, resumeGameInDb, postGameEnded };
