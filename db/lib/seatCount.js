// How many of a role's seats are spoken for, from every direction at once:
// characters sitting in them (ALIVE, plus DEAD on a seat that never reopens),
// a live wizard hold (RoleReservation), and a live lobby assignment
// (LobbyEntry ASSIGNED with a future expiresAt — LOBBY.md §4). One function
// so the picker, the wizard's hold, createCharacter's race check, a threat
// spawn and the roll itself cannot disagree about what "full" means.
//
// `excludeDiscordUserId` leaves out the caller's OWN hold and assignment, so
// re-reserving to slide an expiry never fails against itself and an assigned
// player's own seat reads as available to them.

const { seatHolderStatuses } = require("./roleCapacity");

async function heldSeats(db, role, { excludeDiscordUserId = null, now = new Date() } = {}) {
  const others = excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {};
  const [seated, reserved, assigned] = await Promise.all([
    db.character.count({ where: { roleId: role.id, status: { in: seatHolderStatuses(role) } } }),
    db.roleReservation.count({ where: { roleId: role.id, expiresAt: { gt: now }, ...others } }),
    db.lobbyEntry.count({
      where: { assignedRoleId: role.id, status: "ASSIGNED", expiresAt: { gt: now }, ...others },
    }),
  ]);
  return seated + reserved + assigned;
}

// The lobby assignments alone, grouped by role id — the picker's takenCounts
// folds this in beside its own groupBys.
async function assignedCountsByRole(db, roleIds, { excludeDiscordUserId = null, now = new Date() } = {}) {
  const rows = await db.lobbyEntry.groupBy({
    by: ["assignedRoleId"],
    where: {
      assignedRoleId: { in: roleIds },
      status: "ASSIGNED",
      expiresAt: { gt: now },
      ...(excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {}),
    },
    _count: true,
  });
  return new Map(rows.map((r) => [r.assignedRoleId, r._count]));
}

module.exports = { heldSeats, assignedCountsByRole };
