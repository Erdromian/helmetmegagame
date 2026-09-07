// The third NOTIFY channel of the live feed: "somebody is typing here."
//
// db/lib/feedNotify.js carries messages, db/lib/presenceNotify.js carries
// place changes, and this one carries the smallest thing of the three — a
// place key and a character id. No name: which name that character is wearing
// right now is a forced-name/concealment question, and answering it on the
// WRITER's side would let a typing ping out a name the reader is not owed.
// The web hub resolves the presented name for itself before it fans anything.
//
// Best-effort like the other two. A dropped typing notify costs nothing: the
// line was going to disappear six seconds later anyway.

const TYPING_CHANNEL = "bascinet_typing";

async function notifyTyping(prisma, { placeKey, characterId } = {}) {
  if (!placeKey || !characterId) return false;
  try {
    const payload = JSON.stringify({ placeKey, characterId });
    await prisma.$executeRaw`SELECT pg_notify(${TYPING_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Typing notify failed:", err);
    return false;
  }
}

module.exports = { notifyTyping, TYPING_CHANNEL };
