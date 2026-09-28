// Seat holds for a fate in progress on the creation wizard, so a player who
// picks a capacity-1 fate and spends ten minutes on the tag menu doesn't lose
// the seat at Confirm with no warning. Wizard-side half; the race-closing
// lock lives in createActions.js's create transaction.
//
// Takes `prisma` as its first parameter (db/lib/dm.js convention),
// deliberately off the @lifeweb/db barrel — db/lib/fateCapacity.js (the
// seat-cap math this builds on) IS in the barrel, so requiring by path keeps
// the two call shapes distinct.
const { fateCapacity } = require("./fateCapacity");
const { lateJoinOpeningFor, lateJoinCapacity } = require("./lateJoin");
const { partySeatUnderLock } = require("./lateParty");
const { heldSeats, heldSeatsByFate } = require("./seatCount");

// Long enough to read the tag menu, short enough that an abandoned tab frees
// a unique seat the same session. Refreshed on every wizard step advance.
const RESERVATION_TTL_MS = 30 * 60 * 1000;

// Called inline by every read/write below rather than from a cron job.
async function sweepExpired(tx, roleId) {
  await tx.roleReservation.deleteMany({ where: { roleId, expiresAt: { lt: new Date() } } });
}

// Takes a row lock on the Role first so two concurrent reservers serialize
// instead of both reading the same stale count.
// `partyId` is the live late party when this role is one of its fates
// (db/lib/lateParty.js): the party's slots are the cap then, counted off the
// characters the party made.
async function reserveFate(prisma, discordUserId, roleId, playerCount, { partyId = null } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${roleId} FOR UPDATE`;
    await sweepExpired(tx, roleId);

    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role) return { ok: false, reason: "ROLE_NOT_FOUND" };

    if (partyId) {
      const seat = await partySeatUnderLock(tx, partyId, role, { excludeDiscordUserId: discordUserId });
      if (!seat) return { ok: false, reason: "PARTY_OVER" };
      if (seat.held >= seat.cap) return { ok: false, reason: "ROLE_FULL" };
    } else {
      // A late join's cap is the number of chairs a GM opened (db/lib/lateJoin.js),
      // not a share of the roster. Asked under the same row lock as everything
      // else here, so closing the door mid-wizard wins.
      const opening = await lateJoinOpeningFor(tx, role.slug);
      const cap = opening?.enabled ? lateJoinCapacity(opening) : fateCapacity(role, playerCount);
      // Caller's own hold on THIS role doesn't count against itself.
      if ((await heldSeats(tx, role, { excludeDiscordUserId: discordUserId })) >= cap) {
        return { ok: false, reason: "ROLE_FULL" };
      }
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    // @unique on discordUserId: reserving a different role releases the
    // first as part of the same upsert.
    await tx.roleReservation.upsert({
      where: { discordUserId },
      create: { discordUserId, roleId, expiresAt },
      update: { roleId, expiresAt },
    });
    return { ok: true, expiresAt };
  });
}

// The picker's count, everyone EXCEPT the caller, so a player's own hold
// renders their role available to them and taken to everyone else.
async function takenCounts(prisma, roles, excludeDiscordUserId, { countReservations = true } = {}) {
  if (roles.length === 0) return new Map();
  await prisma.roleReservation.deleteMany({
    where: { roleId: { in: roles.map((r) => r.id) }, expiresAt: { lt: new Date() } },
  });
  return heldSeatsByFate(prisma, roles, { excludeDiscordUserId: excludeDiscordUserId ?? null, countReservations });
}

async function releaseFate(prisma, discordUserId) {
  await prisma.roleReservation.deleteMany({ where: { discordUserId } });
}

module.exports = { reserveFate, takenCounts, releaseFate };
