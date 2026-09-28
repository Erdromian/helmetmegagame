// A MUSTER late party's draw (docs/systemdocs/LATE-PARTIES.md §4), run once at
// the end of every turn from db/index.js's TURN_PASSES as "lateParty".
//
// The players who put their names down (LatePartyEntry) are rolled into the
// party's fates by the lobby's own roll, db/lib/fateAssignment.js#assignFates:
// shuffled, whitelisted fates first, then High, Med, Low. Each chair is the
// fate's slots less what the party has already seated or handed out. A winner
// gets an ordinary lobby seat -- an ASSIGNED LobbyEntry carrying the party's
// id, open for GameConfig.creationWindowHours -- so everything the lobby's
// seats already do comes with it: the wizard opens on Tags with the fate fixed,
// Decline frees it, and db/lib/lobbySweep.js sends the "You're in" DM, the
// reminder and the expiry. Nobody drawn is told anything: their name stays in
// for the next turn's draw.
//
// Idempotent through the pass runner: a resumed advance skips a draw that was
// recorded, and the draw itself runs in one transaction under the party's row
// lock, so it lands whole or not at all.

const { assignFates, newSeed } = require("./fateAssignment");
const { loadLiveParty, loadPartyCounts, latePartyCap } = require("./lateParty");
const { getGameConfig } = require("./gameState");

async function runLatePartyRaffle(prisma, turn) {
  const live = await loadLiveParty(prisma);
  if (!live || live.party.mode !== "MUSTER") return { drawn: 0, entered: 0 };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LateParty" WHERE id = ${live.party.id} FOR UPDATE`;
    const party = await tx.lateParty.findUnique({ where: { id: live.party.id }, include: { fates: true } });
    if (!party || party.endedAt) return { drawn: 0, entered: 0 };

    const [fates, entries, config] = await Promise.all([
      loadPartyCounts(tx, party),
      tx.latePartyEntry.findMany({
        where: { partyId: party.id },
        orderBy: [{ createdAt: "asc" }, { discordUserId: "asc" }],
      }),
      getGameConfig(tx),
    ]);

    // Somebody who has come back by another road (a spawn, Metempsychosis) is
    // out of the hat, and so is somebody already holding a seat.
    const ids = entries.map((e) => e.discordUserId);
    const [living, seated] = await Promise.all([
      tx.character.findMany({ where: { discordUserId: { in: ids }, status: "ALIVE" }, select: { discordUserId: true } }),
      tx.lobbyEntry.findMany({
        where: { discordUserId: { in: ids }, status: "ASSIGNED", expiresAt: { gt: new Date() } },
        select: { discordUserId: true },
      }),
    ]);
    const gone = new Set([...living, ...seated].map((r) => r.discordUserId));
    if (gone.size) {
      await tx.latePartyEntry.deleteMany({ where: { partyId: party.id, discordUserId: { in: [...gone] } } });
    }
    const players = entries
      .filter((e) => !gone.has(e.discordUserId))
      .map((e) => ({
        discordUserId: e.discordUserId,
        priorities: e.priorities ?? {},
        // Nobody the draw passes over is sent anywhere: they stay in the hat.
        joblessRole: "RETURN_TO_LOBBY",
        whitelisted: e.whitelisted,
      }));
    if (players.length === 0) return { drawn: 0, entered: 0 };

    const usable = fates.filter((f) => f.role);
    const roles = usable.map((f) => ({
      slug: f.role.slug,
      name: f.role.name,
      requiresWhitelist: f.role.requiresWhitelist,
      // The party opened it, so a spawn-only fate is drawable here.
      spawnOnly: false,
    }));
    const bySlug = new Map(usable.map((f) => [f.roleSlug, f]));
    const seed = newSeed();
    const { rows } = assignFates({
      players,
      roles,
      taken: new Map(usable.map((f) => [f.roleSlug, f.taken])),
      seed,
      pickable: (role) => bySlug.has(role.slug),
      capacity: (role) => latePartyCap(bySlug.get(role.slug)),
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (config.creationWindowHours ?? 12) * 3600 * 1000);
    const drawn = [];
    for (const row of rows) {
      if (!row?.roleSlug) continue;
      const role = bySlug.get(row.roleSlug).role;
      const seat = {
        status: "ASSIGNED",
        assignedRoleId: role.id,
        assignedAt: now,
        expiresAt,
        reminderSentAt: null,
        notifiedAt: null,
        characterId: null,
        latePartyId: party.id,
      };
      // One LobbyEntry per player, ever: whatever the lobby left there (a
      // spent CREATED row, a DECLINED one) is overwritten by the new seat.
      await tx.lobbyEntry.upsert({
        where: { discordUserId: row.discordUserId },
        create: { discordUserId: row.discordUserId, ...seat },
        update: seat,
      });
      await tx.latePartyEntry.delete({
        where: { partyId_discordUserId: { partyId: party.id, discordUserId: row.discordUserId } },
      });
      drawn.push({ discordUserId: row.discordUserId, role: role.slug });
    }

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: "system",
        actionType: "late_party_draw",
        turnId: turn?.id ?? null,
        details: { partyId: party.id, seed, entered: players.length, drawn },
      },
    });
    return { drawn: drawn.length, entered: players.length };
  });
}

module.exports = { runLatePartyRaffle };
