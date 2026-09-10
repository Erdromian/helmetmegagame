// Opening a conversation: the one copy of it.
//
// A conversation is a private Discord thread hanging off a LOCATION channel
// (Discord has no threads inside threads, so a Room is only the link the
// whisper poll reads) plus a PlayerThread row and a PlayerThreadMember per
// member. The row is the truth and Discord's thread membership is its
// projection — db/lib/conversations.js says so at length, and warns that the
// several callers are exactly why these functions are shared.
//
// This file exists because that warning came true. The bot's Converse modal
// and Chat's Converse dialog had grown two near-identical copies of the
// sequence below, and db/lib/xomPass.js needed a third. Both originals now
// call this instead.
//
// It does the DISCORD half, so it is post-commit work like everything else in
// db/lib/locationMove.js: callers run it after their own writes have landed,
// and it never throws — a caller gets `{ ok: false, error }` and decides what
// to say.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { startPrivateThread, addThreadMember } = require("./discordRest");
const { addConversationMember } = require("./conversations");

// `characterIds` is everybody who should be in it, creator included; each is
// added as a row first and to the Discord thread second, because a failed
// thread add must never decide whether the conversation shows up in somebody's
// places. A "web only" character is deliberately left off the Discord side
// (CHAT.md §6) — their row is their membership.
//
// Returns { ok, conversation, threadId } or { ok: false, error }.
async function openConversationThread(
  prisma,
  { locationId, roomId = null, name, characterIds = [], creatorCharacterId = null } = {},
) {
  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name." };
  if (!locationId) return { ok: false, error: "That place has no channel yet — tell a GM." };

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, discordChannelId: true },
  });
  if (!location?.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM." };
  }

  const wanted = [...new Set(characterIds.filter(Boolean).map(String))];
  const members = await prisma.character.findMany({
    where: { id: { in: wanted } },
    select: { id: true, discordUserId: true, webOnly: true },
  });

  let thread;
  try {
    thread = await startPrivateThread(location.discordChannelId, trimmed);
  } catch (err) {
    console.error(`Failed to open a conversation in ${location.name}:`, err);
    return { ok: false, error: "Couldn't open that — try again, or tell a GM." };
  }

  const creator = members.find((m) => m.id === creatorCharacterId) ?? null;
  const openTurn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { number: true } })
    .catch(() => null);
  const conversation = await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name: trimmed,
      locationId: location.id,
      roomId,
      creatorCharacterId: creator?.id ?? null,
      creatorDiscordUserId: creator?.discordUserId ?? null,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });

  for (const member of members) {
    await addConversationMember(prisma, {
      playerThreadId: conversation.id,
      characterId: member.id,
    }).catch((err) => console.error(`Conversation member row for ${member.id} failed:`, err));
    if (member.discordUserId && !member.webOnly) {
      await addThreadMember(thread.id, member.discordUserId).catch(() => {});
    }
  }

  return { ok: true, conversation, threadId: thread.id };
}

module.exports = { openConversationThread };
