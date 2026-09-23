// The creation window's timers (docs/systemdocs/LOBBY.md §4), run by the bot
// every fifteen minutes beside the whisper poll:
//
//   * an assignment DM that never went out (a redeploy mid-Start, a closed
//     DM) is sent again once the entry is five minutes old and unstamped;
//   * six hours before a seat expires, one reminder DM;
//   * past expiry, the entry flips to EXPIRED — which is what frees the seat,
//     since capacity only counts ASSIGNED rows — and the player is told.
//
// Idempotent: every DM is stamped as sent, and an expired row is no longer
// ASSIGNED, so a tick the bot missed is simply caught up on the next one.

const { sendDm } = require("./dm");
const { DM_ACTION, dmAction } = require("./dmActions");
const { assignmentMessage, reminderMessage, expiredMessage, declineComponents, claimNotification } = require("./lobby");

const REMINDER_BEFORE_MS = 6 * 60 * 60 * 1000;
const RESEND_AFTER_MS = 5 * 60 * 1000;

async function runLobbySweep(prisma, { origin = "https://ravenheart.quest", now = new Date() } = {}) {
  let resent = 0;
  let reminded = 0;
  let expired = 0;

  const unnotified = await prisma.lobbyEntry.findMany({
    where: { status: "ASSIGNED", notifiedAt: null, assignedAt: { lte: new Date(now.getTime() - RESEND_AFTER_MS) }, expiresAt: { gt: now } },
    include: { assignedRole: { include: { startingLocation: { include: { zone: { select: { name: true } } } } } } },
  });
  for (const entry of unnotified) {
    // Start Game's own loop may have claimed it since the read above.
    if (!(await claimNotification(prisma, entry.id))) continue;
    const seat = {
      roleName: entry.assignedRole?.name ?? "your role",
      zoneName: entry.assignedRole?.startingLocation?.zone?.name ?? null,
      expiresAt: entry.expiresAt,
    };
    await sendDm(prisma, entry.discordUserId, assignmentMessage(seat, origin), {
      source: "lobby_assignment",
      components: declineComponents(entry.id),
      meta: dmAction(DM_ACTION.LOBBY_SEAT, entry.id),
    }).catch((err) => console.error(`Assignment resend failed for ${entry.discordUserId}:`, err));
    resent += 1;
  }

  const dueReminder = await prisma.lobbyEntry.findMany({
    where: {
      status: "ASSIGNED",
      reminderSentAt: null,
      expiresAt: { gt: now, lte: new Date(now.getTime() + REMINDER_BEFORE_MS) },
    },
    include: { assignedRole: { select: { name: true } } },
  });
  for (const entry of dueReminder) {
    // Stamp first: a DM that fails is not worth a second reminder later. Only
    // while the seat is still out — a character built since the read above
    // needs no nudge.
    const { count } = await prisma.lobbyEntry.updateMany({
      where: { id: entry.id, status: "ASSIGNED", reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (count === 0) continue;
    await sendDm(prisma, entry.discordUserId, reminderMessage({ roleName: entry.assignedRole?.name ?? "your role", expiresAt: entry.expiresAt }, origin), {
      source: "lobby_reminder",
    }).catch((err) => console.error(`Lobby reminder DM failed for ${entry.discordUserId}:`, err));
    reminded += 1;
  }

  const overdue = await prisma.lobbyEntry.findMany({
    where: { status: "ASSIGNED", expiresAt: { lte: now } },
    include: { assignedRole: { select: { name: true } } },
  });
  for (const entry of overdue) {
    // Conditional: a player who finished their character (or declined) between
    // the read above and here has already moved the row on. Overwriting CREATED
    // with EXPIRED told them their seat was gone a moment after they took it.
    const { count } = await prisma.lobbyEntry.updateMany({
      where: { id: entry.id, status: "ASSIGNED" },
      data: { status: "EXPIRED" },
    });
    if (count === 0) continue;
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

  return { resent, reminded, expired };
}

module.exports = { runLobbySweep };
