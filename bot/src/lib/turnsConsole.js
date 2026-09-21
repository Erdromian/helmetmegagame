const { prisma } = require("@lifeweb/db");
const { postTurnsConsole } = require("@lifeweb/db/lib/turnAnnouncement");
const {
  isTurnsChannel,
  syncTurnsChannelAccess,
} = require("@lifeweb/db/lib/turnsChannelAccess");
const { CONSOLE_TEXT } = require("@lifeweb/db/lib/turnsConsoleRow");
const { buildTurnAnnouncement } = require("@lifeweb/db/turnCalendar");
const { clockStatus, readGameState, CLOCK_STATE_SELECT } = require("@lifeweb/db/lib/gameState");

// #turns is one rolling message — announcement, turn banner and the
// Move/Travel buttons — that db/lib/turnAnnouncement.js replaces every turn.
// This file is only the COLD START: at ready, make sure that message exists
// at all. It normally does and this does nothing; it matters for a fresh
// guild that has never advanced a turn, and as the backstop for a failed
// repost. See finishGameWipe in web/app/(app)/gm/dev/actions.js for what
// Restart Game does instead: it CLEARS #turns and leaves it empty until Start
// Game, which is why the phase check below exists.

// Re-asserts who can see and speak in #turns (db/lib/turnsChannelAccess.js)
// and makes sure the console message exists, reusing it across restarts.
async function ensureTurnsConsole(guild) {
  const channel = [...guild.channels.cache.values()].find(isTurnsChannel);
  if (!channel) {
    console.error('Turns console: no text channel named "turns" in', guild.name);
    return;
  }

  await syncTurnsChannelAccess(prisma, { channelId: channel.id }).catch((err) => {
    console.error("Turns console: access sync failed:", err);
  });

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.turnsConsoleChannelId === channel.id && config.turnsConsoleMessageId) {
    const existing = await channel.messages.fetch(config.turnsConsoleMessageId).catch(() => null);
    if (existing) return;
  }

  // Nothing tracked AND the game is not running: #turns is meant to be empty. Restart Game clears the channel and forgets
  // the console (db/lib/turnAnnouncement.js#clearTurnsConsole), and a bot restart during the lobby must not quietly put a
  // Move/Travel console back in front of players who have no characters to move. Start Game posts the first message.
  // The access sync above still runs — who may read #turns is a question the lobby has too.
  const { phase } = (await readGameState(prisma, CLOCK_STATE_SELECT)) ?? {};
  if (phase !== "RUNNING") return;

  // Nothing tracked, or the tracked message is gone: repost against the open
  // turn with its own plate, if it has earned one (db/lib/turnBanner.js).
  const [openTurn, clock, state] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
    clockStatus(prisma),
    readGameState(prisma, {
      game: { select: { nukeDetonatedTurn: true, ascensionFiredTurn: true } },
    }),
  ]);
  const text = [
    openTurn
      ? buildTurnAnnouncement(openTurn, null, {
          clockFrozen: clock.frozen,
          frozenReason: clock.reason,
          phase: clock.phase,
        })
      : null,
    CONSOLE_TEXT,
  ]
    .filter(Boolean)
    .join("\n");

  await postTurnsConsole(prisma, channel.id, text, openTurn, config, state);
}

module.exports = { ensureTurnsConsole, isTurnsChannel };
