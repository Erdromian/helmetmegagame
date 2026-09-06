// The creation window's two timers (docs/systemdocs/LOBBY.md §4), run by the
// bot every fifteen minutes beside the whisper poll:
//
//   * six hours before a seat expires, one reminder DM;
//   * past expiry, the entry flips to EXPIRED — which is what frees the seat,
//     since capacity only counts ASSIGNED rows — and the player is told.
//
// Idempotent: a reminder is stamped as sent, and an expired row is no longer
// ASSIGNED, so a tick the bot missed is simply caught up on the next one.

const { sendDm } = require("./dm");
const { reminderMessage, expiredMessage } = require("./lobby");

const REMINDER_BEFORE_MS = 6 * 60 * 60 * 1000;

async function runLobbySweep(prisma, { origin = "https://ravenheart.quest", now = new Date() } = {}) {
  let reminded = 0;
  let expired = 0;

  const dueReminder = await prisma.lobbyEntry.findMany({
    where: {
      status: "ASSIGNED",
      reminderSentAt: null,
      expiresAt: { gt: now, lte: new Date(now.getTime() + REMINDER_BEFORE_MS) },
    },
    include: { assignedRole: { select: { name: true } } },
  });
  for (const entry of dueReminder) {
    // Stamp first: a DM that fails is not worth a second reminder later.
    await prisma.lobbyEntry.update({ where: { id: entry.id }, data: { reminderSentAt: now } });
    await sendDm(prisma, entry.discordUserId, reminderMessage({ roleName: entry.assignedRole?.name ?? "your role", expiresAt: entry.expiresAt }), {
      source: "lobby_reminder",
    }).catch((err) => console.error(`Lobby reminder DM failed for ${entry.discordUserId}:`, err));
    reminded += 1;
  }

  const overdue = await prisma.lobbyEntry.findMany({
    where: { status: "ASSIGNED", expiresAt: { lte: now } },
    include: { assignedRole: { select: { name: true } } },
  });
  for (const entry of overdue) {
    await prisma.lobbyEntry.update({ where: { id: entry.id }, data: { status: "EXPIRED" } });
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "lobby_seat_expired",
          details: { entryId: entry.id, discordUserId: entry.discordUserId, role: entry.assignedRole?.name ?? null },
        },
      })
      .catch((err) => console.error("Lobby expiry audit failed:", err));
    await sendDm(prisma, entry.discordUserId, expiredMessage({ roleName: entry.assignedRole?.name ?? "your role" }, origin), {
      source: "lobby_expired",
    }).catch((err) => console.error(`Lobby expiry DM failed for ${entry.discordUserId}:`, err));
    expired += 1;
  }

  return { reminded, expired };
}

module.exports = { runLobbySweep, REMINDER_BEFORE_MS };
