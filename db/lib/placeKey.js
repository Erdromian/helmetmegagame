// Place keys: the one string that names WHERE something was said, shared by
// the two faces.
//
// A Discord channel id is not enough on its own — a Location has a channel, a
// Room has a thread, a Conversation has a thread, and a Zone has a summary
// channel, and the live feed has to subscribe to one of those without caring
// which kind it is. So every row carries a key of the form `loc:<id>`,
// `room:<id>`, `conv:<id>` or `zone:<id>`, a snapshot string with no FK behind
// it, exactly like every other id column on ArchiveEntry.
//
// Takes `prisma` as a parameter rather than requiring db/index.js, same reason
// as archive.js and dm.js: db/index.js imports this module, so requiring it
// back would resolve to a partial exports object.

function placeKeyForLocation(locationId) {
  return locationId ? `loc:${locationId}` : null;
}

function placeKeyForRoom(roomId) {
  return roomId ? `room:${roomId}` : null;
}

function placeKeyForConversation(playerThreadId) {
  return playerThreadId ? `conv:${playerThreadId}` : null;
}

function placeKeyForZone(zoneId) {
  return zoneId ? `zone:${zoneId}` : null;
}

// Memoised for a minute, the way archive.js#currentGameId is: this sits
// inline with the hottest path in the bot (every proxied message), and the
// channel layout only changes when db:sync-zones runs.
const CHANNEL_TTL_MS = 60 * 1000;
const channelMemo = new Map(); // channelId -> { key, at }

function forgetPlaceKeys() {
  channelMemo.clear();
}

// `channelId` is the THREAD's own id when the message was said inside a
// thread, matching what resolveChannelContext stores. `parentId` is the
// channel that thread hangs under, used only as a fallback so a thread nobody
// has a row for still resolves to the Location around it.
async function placeKeyForChannel(prisma, { channelId, parentId = null } = {}) {
  if (!channelId) return null;

  const cached = channelMemo.get(channelId);
  if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached.key;

  const key = await resolveChannelKey(prisma, channelId, parentId);
  channelMemo.set(channelId, { key, at: Date.now() });
  return key;
}

async function resolveChannelKey(prisma, channelId, parentId) {
  // Ordered cheapest-first by how often each kind is written to. All four are
  // indexed lookups, so the cost of a miss is small.
  const location = await prisma.location.findFirst({
    where: { discordChannelId: channelId },
    select: { id: true },
  });
  if (location) return placeKeyForLocation(location.id);

  const room = await prisma.room.findFirst({
    where: { discordThreadId: channelId },
    select: { id: true },
  });
  if (room) return placeKeyForRoom(room.id);

  const conversation = await prisma.playerThread.findFirst({
    where: { threadId: channelId },
    select: { id: true },
  });
  if (conversation) return placeKeyForConversation(conversation.id);

  const zone = await prisma.zone.findFirst({
    where: { discordSummaryChannelId: channelId },
    select: { id: true },
  });
  if (zone) return placeKeyForZone(zone.id);

  // A thread nobody has a row for — a forum scene, say — still belongs to the
  // Location its parent channel is, which is the place a reader would expect
  // to find it under.
  if (parentId && parentId !== channelId) {
    const parent = await prisma.location.findFirst({
      where: { discordChannelId: parentId },
      select: { id: true },
    });
    if (parent) return placeKeyForLocation(parent.id);
  }

  return null;
}

// The other direction: what a key points at. Returns { kind, id } or null.
function parsePlaceKey(placeKey) {
  if (typeof placeKey !== "string") return null;
  const at = placeKey.indexOf(":");
  if (at <= 0) return null;
  const kind = placeKey.slice(0, at);
  const id = placeKey.slice(at + 1);
  if (!id) return null;
  if (!["loc", "room", "conv", "zone"].includes(kind)) return null;
  return { kind, id };
}

// Where on Discord a place key points, for the outbox: the channel a webhook
// belongs to, plus the thread to post into when there is one.
//
// A webhook cannot be created on a thread — Discord hangs it off the parent
// channel and the execute call carries `?thread_id=`. So `channelId` here is
// always the channel that owns the webhook, and `threadId` is non-null only
// for a Room or a Conversation.
async function discordTargetForPlaceKey(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return null;

  if (parsed.kind === "loc") {
    const location = await prisma.location.findUnique({
      where: { id: parsed.id },
      select: { discordChannelId: true },
    });
    return location?.discordChannelId ? { channelId: location.discordChannelId, threadId: null } : null;
  }

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { discordThreadId: true, location: { select: { discordChannelId: true } } },
    });
    if (!room?.discordThreadId || !room.location?.discordChannelId) return null;
    return { channelId: room.location.discordChannelId, threadId: room.discordThreadId };
  }

  if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { threadId: true, location: { select: { discordChannelId: true } } },
    });
    if (!conversation?.threadId || !conversation.location?.discordChannelId) return null;
    return { channelId: conversation.location.discordChannelId, threadId: conversation.threadId };
  }

  if (parsed.kind === "zone") {
    const zone = await prisma.zone.findUnique({
      where: { id: parsed.id },
      select: { discordSummaryChannelId: true },
    });
    return zone?.discordSummaryChannelId ? { channelId: zone.discordSummaryChannelId, threadId: null } : null;
  }

  return null;
}

module.exports = {
  placeKeyForChannel,
  discordTargetForPlaceKey,
  placeKeyForLocation,
  placeKeyForRoom,
  placeKeyForConversation,
  placeKeyForZone,
  parsePlaceKey,
  forgetPlaceKeys,
};
