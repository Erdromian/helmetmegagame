// A MUSTER lateparty's draw (docs/systemdocs/LATE-PARTIES.md §4), run once at
// the end of every turn from db/index.js's TURN_PASSES as "lateParty", and the
// re-offer of a drawn seat that comes back.
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
// A drawn seat that comes BACK -- declined, or left to run out -- does not wait
// for that next draw: offerFreedSeat hands it straight on to somebody still in
// the hat who asked for that fate, by the same roll over that one chair. Only
// when nobody left wants it does it wait for the turn's end.
//
// The draw is idempotent through the pass runner: a resumed advance skips a
// draw that was recorded. Both run in one transaction under the party's row
// lock, so each lands whole or not at all, and never both at once.

const { assignFates, newSeed } = require("./fateAssignment");
const { loadLiveParty, loadPartyCounts, latePartyCap } = require("./lateParty");
const { getGameConfig } = require("./gameState");

// The Skinless are never drawn (db/lib/skinless.js): they never run out of
// room, so a player respawns as one at once. Named here rather than required,
// to keep this file's requires where they were.
const UNDRAWN_FATE_SLUGS = new Set(["skinless"]);

// The names still in the party's hat, as the roll's players. Somebody who has
// come back by another road (a spawn, Metempsychosis) is taken out, and so is
// somebody already holding a seat.
async function hatOf(tx, party) {
  const entries = await tx.latePartyEntry.findMany({
    where: { partyId: party.id },
    orderBy: [{ createdAt: "asc" }, { discordUserId: "asc" }],
  });
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
  return entries
    .filter((e) => !gone.has(e.discordUserId))
    .map((e) => ({
      discordUserId: e.discordUserId,
      priorities: e.priorities ?? {},
      // Nobody the roll passes over is sent anywhere: they stay in the hat.
      joblessRole: "RETURN_TO_LOBBY",
      whitelisted: e.whitelisted,
    }));
}

// The roll's view of a party fate. The party opened it, so a spawn-only fate
// is drawable here.
function rollRole(fate) {
  return { slug: fate.role.slug, name: fate.role.name, requiresWhitelist: fate.role.requiresWhitelist, spawnOnly: false };
}

// Hands every winning row its seat and takes its name out of the hat.
async function seatWinners(tx, party, rows, bySlug) {
  const config = await getGameConfig(tx);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (config.creationWindowHours ?? 12) * 3600 * 1000);
  const seated = [];
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
    seated.push({ discordUserId: row.discordUserId, role: role.slug });
  }
  return seated;
}

// The open MUSTER party with this id, locked for the caller's transaction, or
// null if it has ended (or was never a muster).
async function lockMuster(tx, partyId) {
  await tx.$queryRaw`SELECT id FROM "LateParty" WHERE id = ${partyId} FOR UPDATE`;
  const party = await tx.lateParty.findUnique({ where: { id: partyId }, include: { fates: true } });
  return party && !party.endedAt && party.mode === "MUSTER" ? party : null;
}

async function runLatePartyRaffle(prisma, turn) {
  const live = await loadLiveParty(prisma);
  if (!live || live.party.mode !== "MUSTER") return { drawn: 0, entered: 0 };

  return prisma.$transaction(async (tx) => {
    const party = await lockMuster(tx, live.party.id);
    if (!party) return { drawn: 0, entered: 0 };
    const [fates, players] = await Promise.all([loadPartyCounts(tx, party), hatOf(tx, party)]);
    if (players.length === 0) return { drawn: 0, entered: 0 };

    const usable = fates.filter((f) => f.role && !UNDRAWN_FATE_SLUGS.has(f.roleSlug));
    const bySlug = new Map(usable.map((f) => [f.roleSlug, f]));
    const seed = newSeed();
    const { rows } = assignFates({
      players,
      roles: usable.map(rollRole),
      taken: new Map(usable.map((f) => [f.roleSlug, f.taken])),
      seed,
      pickable: (role) => bySlug.has(role.slug),
      capacity: (role) => latePartyCap(bySlug.get(role.slug)),
    });
    const drawn = await seatWinners(tx, party, rows, bySlug);

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

// A drawn seat came back (db/lib/lobby.js#declineAssignment, or
// db/lib/lobbySweep.js on expiry). Offer that one chair to somebody still in
// the hat who asked for its fate -- High before Med before Low, random among
// equals, the whitelist honoured -- rather than holding it for the next draw.
// Returns the new holder's id, or null when the party has ended, the chair is
// no longer free, or nobody left in the hat wants that fate.
async function offerFreedSeat(prisma, { partyId, roleId, reason }) {
  if (!partyId || !roleId) return null;
  return prisma.$transaction(async (tx) => {
    const party = await lockMuster(tx, partyId);
    if (!party) return null;
    const fates = await loadPartyCounts(tx, party);
    const fate = fates.find((f) => f.role?.id === roleId);
    if (!fate || fate.taken >= latePartyCap(fate)) return null;
    const players = await hatOf(tx, party);
    if (players.length === 0) return null;

    const seed = newSeed();
    const { rows } = assignFates({
      players,
      roles: [rollRole(fate)],
      taken: new Map([[fate.roleSlug, 0]]),
      seed,
      pickable: () => true,
      // One chair: the one that just came back.
      capacity: () => 1,
    });
    const [offered] = await seatWinners(tx, party, rows, new Map([[fate.roleSlug, fate]]));
    if (!offered) return null;

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: "system",
        actionType: "late_party_reoffer",
        details: { partyId: party.id, seed, reason, role: fate.roleSlug, to: offered.discordUserId },
      },
    });
    return offered.discordUserId;
  });
}

module.exports = { runLatePartyRaffle, offerFreedSeat };
