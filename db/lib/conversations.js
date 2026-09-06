// Conversation membership, in the database.
//
// A Conversation is a PlayerThread: a private Discord thread hanging off a
// Location channel, opened with the Converse button. Until phase 2 of the Hall
// the answer to "who is in it" lived ONLY in Discord's thread-member list,
// which had two problems. The web feed could not read it without a REST call
// per conversation per render, and a player whose Discord account is out of
// the channels entirely (the phase 5 "web only" switch) could not be in one at
// all.
//
// So the row is the truth now and Discord is its projection: every writer
// records the member here first, then adds the account. There are four of
// them — the Converse modal, /add, a mention into a conversation, and the
// invite replay — which is exactly why they share these functions rather than
// each doing their own upsert.
//
// Takes `prisma` as a parameter, the db/lib/dm.js convention: db/index.js
// imports this, so requiring it back would resolve to a partial exports
// object.

const { notifyPresence } = require("./presenceNotify");

// Every writer works from a Discord THREAD id, because that is what the
// interaction hands them; PlayerThread.id is the row's own cuid. One lookup
// here spares four call sites from remembering the difference.
async function conversationByThreadId(prisma, threadId) {
  if (!threadId) return null;
  return prisma.playerThread.findUnique({
    where: { threadId },
    select: { id: true, threadId: true, name: true, locationId: true },
  });
}

// Idempotent: a second /add on somebody already in the room is a no-op, and
// the presence notify only fires when the row is genuinely new, so a replayed
// invite does not wake every one of that player's tabs on every arrival.
async function addConversationMember(prisma, { playerThreadId = null, threadId = null, characterId } = {}) {
  if (!characterId) return false;
  const id = playerThreadId ?? (await conversationByThreadId(prisma, threadId))?.id ?? null;
  if (!id) return false;

  const existing = await prisma.playerThreadMember
    .findUnique({ where: { playerThreadId_characterId: { playerThreadId: id, characterId } }, select: { characterId: true } })
    .catch(() => null);
  if (existing) return false;

  const created = await prisma.playerThreadMember
    .create({ data: { playerThreadId: id, characterId } })
    .catch((err) => {
      // A unique violation is two writers racing on the same invite, which is
      // the state we wanted anyway.
      if (err?.code !== "P2002") console.error(`Conversation member add failed for ${characterId}:`, err.message ?? err);
      return null;
    });
  if (!created) return false;

  await notifyPresence(prisma, characterId);
  return true;
}

async function removeConversationMember(prisma, { playerThreadId = null, threadId = null, characterId } = {}) {
  if (!characterId) return false;
  const id = playerThreadId ?? (await conversationByThreadId(prisma, threadId))?.id ?? null;
  if (!id) return false;

  const { count } = await prisma.playerThreadMember
    .deleteMany({ where: { playerThreadId: id, characterId } })
    .catch((err) => {
      console.error(`Conversation member remove failed for ${characterId}:`, err.message ?? err);
      return { count: 0 };
    });
  if (count === 0) return false;

  await notifyPresence(prisma, characterId);
  return true;
}

// The conversations one character is in. `locationId` narrows them to the
// place they are standing, which is what Discord already does one layer down:
// a thread is only visible to somebody who can view its PARENT channel, and a
// character holds that overwrite for exactly one Location at a time. Leaving
// the list unfiltered would show a web player a room they had walked out of.
async function conversationsFor(prisma, characterId, { locationId = undefined } = {}) {
  if (!characterId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: {
      characterId,
      ...(locationId === undefined ? {} : { playerThread: { locationId } }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      playerThread: {
        select: { id: true, threadId: true, name: true, locationId: true, roomId: true },
      },
    },
  });
  return rows.map((row) => row.playerThread).filter(Boolean);
}

module.exports = {
  conversationByThreadId,
  addConversationMember,
  removeConversationMember,
  conversationsFor,
};
