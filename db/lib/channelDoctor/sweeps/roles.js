// The channel doctor's "cheap: role membership" sweep — zone role
// membership, location occupancy (its own module, called here to keep the
// original sequence), turn-ping, the Deadchat seat, character-role
// orphans, seat stamping, and spectator visibility. Moved verbatim out of
// runChannelDoctor (W2d).
const { getGuildChannels, deleteGuildRole } = require("../../discordRest");
const { ghostUserIds } = require("../../ghost");
const { mintCharacterRole } = require("../../characterRole");
const { deadchatSeatHolders, openDeadchatTo, closeDeadchatTo } = require("../../deadchat");
const { managedSpectatorChannels, spectatorDrift, applySpectatorOverwrite } = require("../../spectatorAccess");
const { SPECTATOR_ROLE_ID } = require("../../roleIds");
const { looksLikeCharacterRole, standingRoleIds, reconcileRoleMembership } = require("../shared");
const { runLocationOccupancySweep } = require("./locationOccupancy");

// Character roles one pass may mint (see the character-role check below).
const MAX_ROLE_MINTS_PER_PASS = 50;

async function runRoleMembershipSweep({
  report,
  prisma,
  zones,
  alive,
  members,
  characters,
  liveRoles,
  memberList,
  spectators,
  locations,
  liveLocationChannels,
  rolesById,
}) {
  // Zone roles: exactly the living characters standing in each zone.
  for (const zone of zones) {
    if (!zone.discordRoleId) continue;
    await reconcileRoleMembership({
      roleId: zone.discordRoleId,
      label: `Zone: ${zone.name}`,
      // A character not mirrored to Discord holds no Discord access at all, so they are
      // not in this set and the doctor takes the role back off them if they
      // somehow still wear it (docs/systemdocs/CHAT.md §6).
      shouldHave: alive.filter((c) => c.zoneId === zone.id && c.discordMirrored).map((c) => c.discordUserId),
      members,
      report,
    });
  }

  await runLocationOccupancySweep({ report, prisma, locations, liveLocationChannels, alive });

  // Turn-ping: living characters' preferences, nobody else — and not a
  // un-mirrored one. The ping is a <@&role> inside the #turns console, and
  // #turns is opened by the zone role that not mirroring takes away
  // (db/lib/turnsChannelAccess.js), so holding the role there meant being
  // pinged twice a day about a channel you cannot open. Bidirectional, like
  // every reconcile here, which is what makes this one predicate both take
  // the role off everybody already in that state and hand it back the moment
  // they switch Discord mirroring on.
  await reconcileRoleMembership({
    roleId: process.env.DISCORD_TURN_PING_ROLE_ID,
    label: "turn-ping",
    shouldHave: alive.filter((c) => c.turnPingOptIn && c.discordMirrored).map((c) => c.discordUserId),
    members,
    report,
  });

  // The Deadchat seat: whoever db/lib/ghost.js says is a ghost, and nobody else. Per-member
  // overwrites on one channel (db/lib/deadchat.js), not a role — the Ghost role this replaces
  // printed "dead" on a profile card to anyone who clicked.
  //
  // BIDIRECTIONAL, which inverts what the old ghost reconcile did on purpose. That one was
  // database -> role only, on the argument that the role was a cache of a derived set and decided
  // nothing, so drift cost a dead player some channels and nothing more. Here the overwrite IS the
  // access, and drift the other way is a living player sitting in the dead's room reading it. So
  // both directions are swept, and a seat nobody should hold is taken back.
  //
  // A departed member keeps neither: they are not in `members`, so the add arm skips them, and the
  // remove arm below takes the seat off anyone the database does not name — which is the cleanup
  // path for somebody who left the guild mid-death.
  await reconcileDeadchatSeats({ prisma, characters, members, report });

  // Character roles: every ALIVE character has one, playing on Discord or
  // not — /add can't name a character without one (db/lib/characterRole.js).
  // A missing or deleted role is minted on apply, which is also how the
  // web-only characters made before that rule got theirs. No orphan
  // character-signature roles: those are deleted on apply, same conservatism
  // as prune-orphan-roles. The orphan pass reads `liveRoles` as it was before
  // any minting, so a role minted here is never mistaken for one.
  const claimedRoleIds = new Set(characters.map((c) => c.discordRoleId).filter(Boolean));
  const standing = standingRoleIds();
  // The zone ACCESS roles. Kept narrow on purpose: this same set is what
  // #turns grants view to below, and a GM seat has no business there — every
  // GM already holds a global GM role, which #turns grants outright.
  const zoneRoleIds = new Set(zones.map((z) => z.discordRoleId).filter(Boolean));
  // The per-zone GM seats. Not character roles, so the orphan sweep below
  // must never offer to delete one; nothing else wants them.
  const zoneGmRoleIds = new Set(zones.map((z) => z.gmRoleId).filter(Boolean));
  // Minting is capped per pass and stops at the first refusal: role creation
  // is a slow per-guild bucket, the bot-start pass is awaited before the bot
  // is ready, and every 429 counts toward the REST breaker. What is left over
  // is still reported, and the next pass (every turn's end) mints it.
  let mints = 0;
  let mintRefused = false;
  const mint = (c) => async () => {
    try {
      await mintCharacterRole(prisma, c);
    } catch (err) {
      mintRefused = true;
      throw err;
    }
  };
  for (const c of alive) {
    const problem = !c.discordRoleId
      ? "living character has no Discord role recorded"
      : !rolesById.has(c.discordRoleId)
        ? "recorded character role no longer exists"
        : null;
    if (!problem) continue;
    const repair = !mintRefused && mints < MAX_ROLE_MINTS_PER_PASS ? mint(c) : undefined;
    if (repair) mints += 1;
    await report("character-role", c.name, problem, repair);
  }
  for (const role of liveRoles) {
    if (
      claimedRoleIds.has(role.id) ||
      standing.has(role.id) ||
      zoneRoleIds.has(role.id) ||
      zoneGmRoleIds.has(role.id)
    ) {
      continue;
    }
    if (!looksLikeCharacterRole(role)) continue;
    if (role.managed || role.permissions !== "0") continue;
    const held = memberList.some((m) => m.roles.includes(role.id));
    if (held) continue;
    await report("character-role", role.name, "orphan character role (no character claims it)", () =>
      deleteGuildRole(role.id),
    );
  }

  // Seat stamping: nothing seat-scoped may point at a cave level.
  const badSeatZones = zones.filter((z) => z.kind === "CAVE_LEVEL").map((z) => z.id);
  if (badSeatZones.length > 0) {
    const [actions, notes] = await Promise.all([
      prisma.action.count({ where: { zoneId: { in: badSeatZones } } }),
      prisma.note.count({ where: { zoneId: { in: badSeatZones } } }),
    ]);
    if (actions > 0 || notes > 0) {
      await report(
        "seat-stamp",
        "Action/Note",
        `${actions + notes} rows stamped with a cave-level zoneId instead of the Caves seat`,
      );
    }
  }

  // The spectator role itself. Its id is hardcoded (db/lib/roleIds.js), so a
  // role deleted and made again in the guild leaves every overwrite below
  // aimed at nobody — each one written faithfully, and every spectator still
  // locked out of everything. Report only: the fix is the new id in code.
  if (!rolesById.has(SPECTATOR_ROLE_ID)) {
    await report(
      "spectator-role",
      SPECTATOR_ROLE_ID,
      "the Spectator role id in db/lib/roleIds.js is not a role in this guild, so no spectator overwrite reaches anyone",
    );
  }

  // The spectator seat's visibility on every managed channel — the backstop
  // for a phase transition whose sweep died. One channel list, PUTs only on
  // drift, so it stays in the cheap scope.
  {
    const [managedSpectator, liveChannels] = await Promise.all([
      managedSpectatorChannels(prisma),
      getGuildChannels(),
    ]);
    for (const target of spectatorDrift(managedSpectator, liveChannels, spectators)) {
      await report(
        "spectator-visibility",
        target.label,
        spectators ? "spectators cannot see a channel they should" : "spectators can see a channel while the game is not on",
        () => applySpectatorOverwrite(target.id, { visible: spectators }),
      );
    }
  }

  return { zoneRoleIds, zoneGmRoleIds };
}

// Discord allows 1000 overwrites on a channel. Deadchat's population is the players who have died
// and not re-rolled — tens, realistically — but the failure is silent, so it is reported well before
// it is fatal rather than discovered as a refused write.
const SEAT_WARN_AT = 800;

async function reconcileDeadchatSeats({ prisma, characters, members, report }) {
  let held;
  try {
    held = await deadchatSeatHolders(prisma);
  } catch (err) {
    await report("deadchat-seat", "channel", `couldn't read the Deadchat channel: ${err.message ?? err}`);
    return;
  }
  // No channel provisioned yet is not drift — db:sync-deadchat has simply not run.
  if (held.length === 0) {
    const { deadchatChannelId } = require("../../deadchat");
    if (!(await deadchatChannelId(prisma))) return;
  }

  if (held.length >= SEAT_WARN_AT) {
    await report("deadchat-seat", "channel", `${held.length} seats, approaching Discord's 1000-overwrite cap`);
  }

  const want = ghostUserIds(characters);
  const has = new Set(held);

  for (const userId of want) {
    if (has.has(userId)) continue;
    if (!members.get(userId)) continue; // left the guild — the character checks report that
    await report("deadchat-seat", userId, "a ghost with no Deadchat seat", () =>
      openDeadchatTo(prisma, userId),
    );
  }
  for (const userId of has) {
    if (want.has(userId)) continue;
    await report("deadchat-seat", userId, "holds a Deadchat seat and shouldn't", () =>
      closeDeadchatTo(prisma, userId),
    );
  }
}

module.exports = { runRoleMembershipSweep };
