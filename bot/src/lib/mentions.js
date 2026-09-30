const { prisma, buildNarrowcastContext, computeNarrowcastAccess, NARROWCAST_SLUGS } = require("@lifeweb/db");
const { pushToUser } = require("@lifeweb/db/lib/webPush");
const { MENTION_SOURCE } = require("@lifeweb/db/lib/dmKinds");
const { sendDm } = require("./dm");

// Character-role mentions: who was pinged, and may they hear it. Character.discordRoleId is
// @unique, so a mentioned role resolves to one character.

// A ping must not carry further than a voice would: Location gates on location, zone's #summary
// on zone, special channels on db/lib/specialChannels.js.
async function canHearPing(character, context) {
  if (NARROWCAST_SLUGS.includes(context.channelKind)) {
    const ctx = await buildNarrowcastContext(prisma, character.id);
    return Boolean(computeNarrowcastAccess(ctx)[context.channelKind]?.view);
  }
  if (context.locationId) return character.locationId === context.locationId;
  if (context.zoneId) return character.zoneId === context.zoneId;
  return false;
}

// The ALIVE characters behind the roles mentioned. Read before proxying deletes the original
// (bot/src/lib/proxy.js). Self-pings DO relay — the proxy already suppresses the ping itself
// (PROXYING.md §2).
async function resolveMentionedCharacters(roleIds) {
  if (roleIds.length === 0) return [];
  return prisma.character.findMany({
    where: { discordRoleId: { in: roleIds }, status: "ALIVE" },
  });
}

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// A browser notification, plus a Discord DM when `dm` is given ({ client, link }) — the caller
// decides that: only a role mention (an @, never a bare name) whose target witnesses the
// Conversation or Room it was said in (db/lib/archiveWitnesses.js#privateWitnessIds). Carries
// where and a link, never the message text. `placeKey` rides in meta so /chat can open the place.
async function notifyMentioned(character, context, { placeKey = null, dm = null } = {}) {
  const place = context.locationName ?? context.zoneName ?? null;
  const nowhere = context.channelKind ? `#${context.channelKind}` : "somewhere"; // special channel has no place
  const where = context.threadName
    ? `${place ?? "somewhere"} · ${context.threadName}`
    : (place ?? nowhere);

  if (dm?.client && dm.link) {
    const user = await dm.client.users.fetch(character.discordUserId).catch(() => null);
    if (user) {
      await sendDm(user, `» *You were mentioned in ${where}.*\n${dm.link}`, {
        source: MENTION_SOURCE,
        meta: { placeKey, where },
      }).catch(() => {});
    }
  }

  await pushToUser(prisma, character.discordUserId, { // browser notification, after the DM, never affects it
    title: `${character.name} was named`,
    body: `in ${where}`,
    url: placeKey ? `/chat#${encodeURIComponent(placeKey)}` : "/chat",
  }).catch(() => {});
}

module.exports = {
  canHearPing,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
};
