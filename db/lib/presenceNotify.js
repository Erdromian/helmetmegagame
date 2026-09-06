// The second NOTIFY channel of the live feed: "this character's places have
// changed."
//
// db/lib/feedNotify.js carries messages. This one carries nothing but a
// character id, because the answer to "which places may they see now" is a
// query the listener has to run again anyway — and running it on the reader's
// side is what keeps a notification from being an authorisation.
//
// Three things move a character between places: their feet
// (locationMove.js), a key (roomAccess.js, when the entitled set actually
// changes), and being let into or out of a Conversation (conversations.js).
// Each of those calls in here, the web's SSE hub wakes the streams that
// character owns, and the stream re-asks db/lib/feedAccess.js#placesFor.
//
// Best-effort, exactly like notifyFeed: a failed notify costs a browser its
// instant place list, and the next reconnect rebuilds it from scratch. It is
// never worth throwing a move away over.

const PRESENCE_CHANNEL = "bascinet_presence";

async function notifyPresence(prisma, characterId) {
  if (!characterId) return false;
  try {
    const payload = JSON.stringify({ characterId });
    await prisma.$executeRaw`SELECT pg_notify(${PRESENCE_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Presence notify failed:", err);
    return false;
  }
}

module.exports = { notifyPresence, PRESENCE_CHANNEL };
