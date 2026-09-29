// Restart Game's message wipe (wipeGameData, web/app/(app)/gm/dev/actions.js)
// — distinct from the routine per-turn message wipe (messageWipe.js), which
// spares the Room threads' starters and the location anchors. This one does
// not: every message-bearing channel and every anchor/starter clears, on the
// theory that a restart is a bigger reset than a turn. What it does NOT do
// any more is touch structure — no category, channel or role is ever
// deleted. That is now the Discord mirror's job (db/lib/discordMirror),
// which repairs whatever this empties, including a quest Room's thread and
// a zone Room's starter, once finishGameWipe runs it in "full" scope.
// Entirely sequential, same rate-limit reasoning as messageWipe.js.
const {
  getGuildChannels,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
} = require("./discordRest");

const CHANNEL_TYPE_TEXT = 0;

async function wipeChannelMessages(channelId, options) {
  const messages = await fetchAllMessages(channelId);
  if (messages.length > 0) await bulkDeleteMessages(channelId, messages.map((m) => m.id), options);
}

// A zone #summary is the one channel a restart must leave EMPTY. The rest
// take the ordinary cap on over-14-day deletes, but a game that sat ended for
// a fortnight left every summary older than that, and the cap of 50 left the
// rest of the last day's posts standing into the next game. A summary is
// wiped once a game-day, so this is one day's posts at most.
const SUMMARY_CLEAR = { oldCap: Infinity };

// Same sweep as the old runFullChannelWipe — every archive/turns/summary/
// location channel's messages — but it never deletes a category, a channel
// or a role, and it treats a Location's threads by what they ARE rather than
// wiping the lot:
//
//   - an ordinary zone Room's thread (no questId) is kept. Its messages are
//     cleared like any other channel, and its starter id/hash are nulled so
//     the mirror reposts the starter into the now-empty thread on its next
//     run (the same hash-mismatch trick runFullChannelWipe uses on anchors).
//   - a quest Room's thread, and any thread that matches no Room at all (a
//     Conversation, or a stray), is deleted outright. Neither needs to
//     survive: a Conversation's PlayerThread row is already gone by the time
//     this runs (wipeGameData's transaction), and a quest Room's thread is
//     one the mirror already knows how to build from scratch — buildDesired
//     puts every Room, quest ones included, into its Location's thread list
//     (discordMirror/desired.js), which is more than the old YAML sync could
//     ever do for a quest room.
//
// Anchors are nulled unconditionally, same as before: every summary/location
// channel's messages just went, so every anchor needs to repost regardless
// of whether its own hash changed.
//
// One failed channel no longer stops the sweep. It used to throw out of the
// whole thing, so a hiccup in #archive left every zone's #summary holding the
// last game. Each channel is tried on its own, the zone summaries first, and
// the failures are thrown together at the end, after the DB half has run, so
// finishGameWipe still reports the step as failed and retries it.
async function wipeGameMessages(prisma) {
  const failures = [];
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${label}: ${err.message}`);
      console.error(`Game wipe: ${label} failed, continuing:`, err.message);
    }
  };

  const zones = await prisma.zone.findMany({ include: { locations: true } });
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) {
      await attempt(`${zone.name ?? zone.id} #summary`, () =>
        wipeChannelMessages(zone.discordSummaryChannelId, SUMMARY_CLEAR),
      );
    }
  }

  const channels = await getGuildChannels();

  const archiveChannels = channels.filter((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "archive");
  for (const channel of archiveChannels) await attempt("#archive", () => wipeChannelMessages(channel.id));

  const turnsChannel = channels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "turns");
  if (turnsChannel) await attempt("#turns", () => wipeChannelMessages(turnsChannel.id));

  const rooms = await prisma.room.findMany({
    where: { discordThreadId: { not: null } },
    select: { id: true, discordThreadId: true, questId: true },
  });
  const roomByThreadId = new Map(rooms.map((r) => [r.discordThreadId, r]));
  // A room's other threads, one per further Location it opens onto
  // (db/lib/roomSides.js). Kept and cleared exactly like the home thread, or
  // every Restart would delete them and leave the mirror rebuilding each one.
  const sides = await prisma.roomSide.findMany({
    where: { discordThreadId: { not: null } },
    select: { roomId: true, discordThreadId: true, room: { select: { questId: true } } },
  });
  for (const side of sides) {
    roomByThreadId.set(side.discordThreadId, { id: side.roomId, questId: side.room?.questId ?? null, side: true });
  }
  const questRoomIdsToUnlink = [];

  for (const zone of zones) {
    for (const location of zone.locations) {
      if (!location.discordChannelId) continue;
      const label = location.name ?? location.id;

      await attempt(`${label} threads`, async () => {
        const active = await listActiveThreadsForChannel(location.discordChannelId);
        const archivedPublic = await listArchivedPublicThreads(location.discordChannelId);
        const archivedPrivate = await listArchivedPrivateThreads(location.discordChannelId);
        const threadsById = new Map();
        for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) threadsById.set(thread.id, thread);

        for (const thread of threadsById.values()) {
          const room = roomByThreadId.get(thread.id);
          if (room && !room.questId) {
            await attempt(`${label} / ${thread.name ?? thread.id}`, () => wipeChannelMessages(thread.id));
          } else {
            await attempt(`${label} / ${thread.name ?? thread.id}`, async () => {
              await deleteThread(thread.id);
              if (room && !room.side) questRoomIdsToUnlink.push(room.id);
            });
          }
        }
      });

      await attempt(label, () => wipeChannelMessages(location.discordChannelId));
    }
  }

  await prisma.location.updateMany({ data: { anchorMessageId: null, anchorHash: null } });
  // Zone rooms kept their thread; only the starter inside it needs a repost.
  await prisma.room.updateMany({
    where: { questId: null },
    data: { starterMessageId: null, postHash: null },
  });
  await prisma.roomSide.updateMany({
    where: { room: { questId: null } },
    data: { starterMessageId: null, postHash: null },
  });
  // Quest rooms lost their thread outright; unlink so the mirror creates a
  // fresh one instead of trying to hash-match a thread that is gone.
  if (questRoomIdsToUnlink.length > 0) {
    await prisma.room.updateMany({
      where: { id: { in: questRoomIdsToUnlink } },
      data: { discordThreadId: null, starterMessageId: null, postHash: null },
    });
    await prisma.roomSide.updateMany({
      where: { roomId: { in: questRoomIdsToUnlink } },
      data: { discordThreadId: null, starterMessageId: null, postHash: null },
    });
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} channel(s) not cleared — ${failures.join("; ")}`);
  }
}

module.exports = { wipeGameMessages };
