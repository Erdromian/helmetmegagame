const { prisma, advanceTurn: advanceTurnInDb } = require("@lifeweb/db");

// Thin wrapper around the shared db.advanceTurn(): adds the audit log entry
// (process-specific — the announcement, Hunger DMs and message wipe are all
// composed inside advanceTurn() itself, REST-based, so this needs no gateway
// client). Called by the nightly cron in ready.js, and safe to call
// manually as a GM force-advance since it's idempotent about which turn is
// "current".
//
// The side effects are awaited inline here, unlike the web action which defers
// them past the response: this is a background cron with nobody waiting on it,
// so the straight-line order keeps the logs readable.
async function advanceTurn() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.autoTurnAdvanceDisabled) {
    console.log("Turn-advance cron skipped: autoTurnAdvanceDisabled is on.");
    return null;
  }

  const { advanced, refused, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

  // The game is not running — in the lobby, or ended. Its clock is stopped
  // by design (docs/systemdocs/LOBBY.md §1), so this is a quiet skip.
  if (refused === "NOT_RUNNING") {
    console.log("Turn-advance cron skipped: the game is not in its Running phase.");
    return null;
  }

  // Another caller (a GM on the Dev Panel, most likely) won the race and
  // already advanced the turn. Nothing to log, nothing to announce.
  if (!advanced) return newTurn;

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: previousTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        phase: newTurn.phase,
      },
    },
  });

  await runSideEffects();

  return newTurn;
}

module.exports = { advanceTurn };
