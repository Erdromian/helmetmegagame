const { prisma, buildNarrowcastContext, computeNarrowcastAccess, NARROWCAST_SLUGS } = require("@lifeweb/db");
const { pushToUser } = require("@lifeweb/db/lib/webPush");
const { MENTION_SOURCE } = require("@lifeweb/db/lib/dmKinds");
const { parsePlaceKey, discordTargetsForPlaceKey } = require("@lifeweb/db/lib/placeKey");
const characterMentions = require("@lifeweb/db/lib/characterMentions");
const { sendDm } = require("./dm");

// Character-role mentions: who was pinged, and may they hear it. Character.discordRoleId is
// @unique, so a mentioned role resolves to one character.

// A ping must not carry further than a voice would: Location gates on location, zone's #summary
// on zone, special channels on db/lib/specialChannels.js. A room that opens onto several
// Locations (db/lib/roomSides.js) carries a voice to every side, and a thread's parent channel
// only names the side it hangs off, so a room asks the shared rule, which knows every side —
// the one the web's relay and the bare-name lookup already ask (MAP.md §2d).
async function canHearPing(character, context, placeKey = null) {
  if (parsePlaceKey(placeKey)?.kind === "room") return characterMentions.canHearPing(prisma, character, placeKey);
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

// Every thread of a room that opens onto several Locations, each with the Location it hangs
// off (db/lib/placeKey.js#discordTargetsForPlaceKey); [] for any other place, which has one.
async function roomThreads(placeKey) {
  if (parsePlaceKey(placeKey)?.kind !== "room") return [];
  return discordTargetsForPlaceKey(prisma, placeKey).catch(() => []);
}

// The link a mention DM carries, for one reader. A Discord thread can only be opened by somebody
// who can see its parent channel, so the link to the line where it was said is dead for a reader
// on another side of the room. Theirs is their own side's thread, where the relay
// (./roomRelay.js) puts its copy — the copy is posted after the DM, so the link is to the thread
// rather than the message. Pure: `threads` is roomThreads()'s answer.
function linkForReader({ link, threads, originThreadId, readerLocationId, guildId }) {
  if (!link || !Array.isArray(threads) || threads.length < 2 || !readerLocationId || !guildId) return link;
  const origin = threads.find((t) => t.threadId === originThreadId);
  if (!origin || origin.locationId === readerLocationId) return link;
  const theirs = threads.find((t) => t.locationId === readerLocationId && t.threadId);
  return theirs ? `https://discord.com/channels/${guildId}/${theirs.threadId}` : link;
}

// A browser notification, plus a Discord DM when `dm` is given ({ client, link }) — the caller
// decides that: only a role mention (an @, never a bare name) whose target witnesses the
// place it was said in (db/lib/archiveWitnesses.js#witnessIdsAt). Carries
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
  linkForReader,
  messageLink,
  roomThreads,
  notifyMentioned,
  resolveMentionedCharacters,
};
