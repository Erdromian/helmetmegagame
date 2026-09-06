// The pub/sub half of the live feed: one Postgres NOTIFY per archived row.
//
// Postgres is the only thing the bot and the web app share, so it is also the
// message bus. A row is written, then its seq and place key go out on
// `bascinet_feed`; the web's SSE hub (web/lib/feedHub.js) fans it out to the
// browsers watching that place, and the bot's outbox (bot/src/lib/feedOutbox.js)
// picks up the WEB rows it has to post on to Discord.
//
// The payload is deliberately tiny — just enough to find the row again. NOTIFY
// has an 8000-byte ceiling and a listener that trusted the payload's contents
// would be reading data it never re-authorised.
//
// Best-effort like every other write in archive.js: a failed notify costs a
// browser its instant update, and the client's next reconnect catches up from
// its cursor anyway. It is never worth throwing a player's message away over.

const FEED_CHANNEL = "bascinet_feed";

// `op` says what happened to the row: "new" (default), "edit" or "delete".
// A listener still loads the row and re-checks who may see it — the op only
// tells it which of the three things to do, never what the row says.
async function notifyFeed(prisma, { seq, placeKey, op = "new" } = {}) {
  if (seq === null || seq === undefined || !placeKey) return false;
  try {
    // seq is a BigInt off the row; JSON.stringify cannot serialise one, so it
    // goes over the wire as a string and every reader parses it back with
    // BigInt(), never Number() — past 2^53 a Number cursor silently stops
    // moving.
    const payload = JSON.stringify({ seq: String(seq), placeKey, op });
    await prisma.$executeRaw`SELECT pg_notify(${FEED_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Feed notify failed:", err);
    return false;
  }
}

module.exports = { notifyFeed, FEED_CHANNEL };
