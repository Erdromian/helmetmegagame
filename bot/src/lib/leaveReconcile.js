// The startup catch-up for departures the bot slept through: the
// guildMemberRemove handler only fires while the gateway is connected. This
// pass diffs the living roster against actual guild membership on every
// ready and runs the shared departure path (db/lib/playerDeparture.js) for
// anyone missed. Called from ready.js AFTER the channel doctor. Idempotent
// via the `leftGuildAt: null` filter.
const { prisma } = require("@lifeweb/db");
const { markPlayerDeparted } = require("@lifeweb/db/lib/playerDeparture");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");

async function reconcileDepartures(client, guild) {
  // syncDiscordAccountsForGuild ran a full guild.members.fetch() moments ago
  // (ready.js), so the cache is already warm. Fetching a second time costs
  // nothing against the REST budget but DOES spend the gateway's own opcode-8
  // allowance, and in production it was the one that lost: "Leave reconcile
  // failed: GatewayRateLimitError: Request with opcode 8 was rate limited."
  // That took the safety net down. Reuse what the first fetch left behind and
  // only go to the gateway if nothing did. The mass-flag rail below still
  // catches a cache that came back thin, so a bad read can never read as an
  // exodus.
  const members = guild.members.cache.size > 0 ? guild.members.cache : await guild.members.fetch();

  const alive = await prisma.character.findMany({
    where: { status: "ALIVE", leftGuildAt: null },
    select: { id: true, name: true, discordUserId: true },
  });
  const candidates = alive.filter((character) => !members.has(character.discordUserId));

  // The hard rail: a truncated fetch must never read as a mass exodus.
  const limit = Math.max(5, Math.ceil(alive.length * 0.2));
  if (members.size === 0 || candidates.length > limit) {
    const message =
      `Leave reconcile ABORTED: ${candidates.length} of ${alive.length} living characters ` +
      `look departed against a member list of ${members.size}. That smells like a bad fetch, ` +
      `not a mass exodus — nobody was flagged.`;
    console.error(message);
    const channel = await client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) await channel.send(`⚠ ${message}`).catch(() => {});
    return { checked: alive.length, flagged: 0, aborted: true };
  }

  if (candidates.length === 0) return { checked: alive.length, flagged: 0, aborted: false };

  const channel = await client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch((err) => {
    console.error(`Leave reconcile: cannot fetch #leave (${LEAVE_ANNOUNCE_CHANNEL_ID}):`, err.message);
    return null;
  });

  let flagged = 0;
  for (const candidate of candidates) {
    try {
      const result = await markPlayerDeparted(prisma, {
        discordUserId: candidate.discordUserId,
        username: null, // the account is gone; the character name carries the alert
        viaReconcile: true,
      });
      flagged += 1;
      if (channel?.isTextBased()) {
        await channel
          .send(`[caught at startup] ${result.alert}`)
          .catch((err) => console.error(`Leave reconcile alert failed for ${candidate.name}:`, err.message));
      }
      if (result.roleUpdate) {
        await guild.roles
          .edit(result.roleUpdate.roleId, { name: result.roleUpdate.name, color: result.roleUpdate.color })
          .catch((err) =>
            console.error(`Leave reconcile: failed to mark ${candidate.name}'s role catatonic:`, err.message),
          );
      }
    } catch (err) {
      console.error(`Leave reconcile failed for ${candidate.name} (${candidate.discordUserId}):`, err);
    }
  }

  console.log(`Leave reconcile: ${flagged} departed player(s) caught up (${alive.length} living characters checked).`);
  return { checked: alive.length, flagged, aborted: false };
}

module.exports = { reconcileDepartures };
