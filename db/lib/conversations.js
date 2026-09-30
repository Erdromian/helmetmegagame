// Conversation (PlayerThread) membership: the row is truth, Discord is its
// projection. Takes `prisma` as a param (db/lib/dm.js convention — db/index.js imports this).

const { presentedMembers } = require("./presentedMembers");
const { notifyPresence } = require("./presenceNotify");

// Writers work from a Discord THREAD id; PlayerThread.id is the row's own cuid.
async function conversationByThreadId(prisma, threadId) {
  if (!threadId) return null;
  return prisma.playerThread.findUnique({
    where: { threadId },
    select: { id: true, threadId: true, name: true, locationId: true },
  });
}

// Idempotent: a second /add is a no-op; notify fires only when the row is new, so a replayed invite doesn't wake every tab on every arrival.
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
      // A unique violation is two writers racing on the same invite — the state we wanted anyway.
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

// `locationId` narrows to where the character stands; unfiltered would show them a room they'd walked out of.
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

// Raw ids — the ONLY thing to test membership against; conversationMembers
// below withholds ids for hooded members, which would lock them out of their own conversation.
async function conversationMemberIds(prisma, playerThreadId) {
  if (!playerThreadId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: { playerThreadId },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  return rows.map((row) => row.characterId);
}

// Membership IS the permission to /add or /remove. Ask the rows, never
// Discord's thread-member list — a web-only character is in the rows and in no thread anywhere.
async function isConversationMember(prisma, playerThreadId, characterId) {
  if (!playerThreadId || !characterId) return false;
  const ids = await conversationMemberIds(prisma, playerThreadId);
  return ids.includes(characterId);
}

// Presented list; dead members dropped (a body cannot be in a conversation).
// Goes through db/lib/presentedMembers.js so hooded members stay masked; `viewer` null errs toward hiding every hood.
async function conversationMembers(prisma, playerThreadId, viewer, options) {
  if (!playerThreadId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: { playerThreadId },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  if (rows.length === 0) return [];
  return presentedMembers(prisma, rows.map((row) => row.characterId), viewer, options);
}

module.exports = {
  conversationMemberIds,
  isConversationMember,
  addConversationMember,
  removeConversationMember,
  conversationsFor,
  conversationMembers,
};
