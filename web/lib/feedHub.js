import "server-only";
import { Client } from "pg";
import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { FEED_CHANNEL } from "@lifeweb/db/lib/feedNotify";

// One Postgres LISTEN per web process, fanned out to every open SSE stream.
//
// The alternative was a poll, which is what the GM inbox does at 3 s. Chat
// cannot feel right on a poll, and a socket service would be a whole new
// Railway deployment for traffic that is one-directional anyway (sends are an
// ordinary POST). Railway runs `next start` as one long-lived Node server with
// one replica, so a module singleton reaches every stream in the process.
//
// Kept on globalThis for the same reason the Prisma client is: `next dev`
// re-evaluates a module on every hot reload, and a fresh listener per reload
// would leak a database connection each time.

const HUB_KEY = "__bascinetFeedHub";
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

function createHub() {
  return {
    // placeKey -> Set<(row) => void>
    subscribers: new Map(),
    client: null,
    connecting: false,
    backoffMs: BACKOFF_MIN_MS,
  };
}

function hub() {
  if (!globalThis[HUB_KEY]) globalThis[HUB_KEY] = createHub();
  return globalThis[HUB_KEY];
}

// A subscriber's callback is player code as far as this module is concerned —
// a closed stream throws on write. One bad subscriber must never stop the
// others from being told, and must never take the process down.
function fanOut(placeKey, row) {
  const set = hub().subscribers.get(placeKey);
  if (!set) return;
  for (const send of [...set]) {
    try {
      send(row);
    } catch (err) {
      console.error("Feed subscriber failed:", err);
    }
  }
}

async function handleNotification(msg) {
  if (msg.channel !== FEED_CHANNEL || !msg.payload) return;
  let parsed;
  try {
    parsed = JSON.parse(msg.payload);
  } catch {
    return;
  }
  if (!parsed?.seq || !parsed?.placeKey) return;

  // Nobody in this process is watching that place, so there is no reason to
  // pay for the row.
  const set = hub().subscribers.get(parsed.placeKey);
  if (!set || set.size === 0) return;

  // seq crosses the wire as a string; BigInt, never Number — the column is a
  // bigint and a Number cursor loses precision at the top of the range.
  const row = await prisma.archiveEntry.findUnique({
    where: { seq: BigInt(parsed.seq) },
    select: FEED_ROW_SELECT,
  });
  if (!row || row.deletedAt) return;
  fanOut(parsed.placeKey, feedRowShape(row));
}

function scheduleReconnect() {
  const h = hub();
  const wait = h.backoffMs;
  h.backoffMs = Math.min(h.backoffMs * 2, BACKOFF_MAX_MS);
  const timer = setTimeout(() => {
    connect().catch((err) => console.error("Feed hub reconnect failed:", err));
  }, wait);
  timer.unref?.();
}

// A single Client, not a Pool: LISTEN belongs to one session, and a pooled
// connection can be handed to another query between notifications.
async function connect() {
  const h = hub();
  if (h.client || h.connecting) return;
  if (!process.env.DATABASE_URL) {
    console.warn("Feed hub: no DATABASE_URL, the live feed will not update.");
    return;
  }
  h.connecting = true;

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  const drop = (err) => {
    if (h.client !== client && h.connecting === false) return;
    if (err) console.error("Feed hub listener error:", err);
    if (h.client === client) h.client = null;
    h.connecting = false;
    client.removeAllListeners();
    client.end().catch(() => {});
    scheduleReconnect();
  };

  client.on("error", drop);
  client.on("end", () => drop(null));
  client.on("notification", (msg) => {
    handleNotification(msg).catch((err) => console.error("Feed hub notification failed:", err));
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${FEED_CHANNEL}`);
    h.client = client;
    h.connecting = false;
    h.backoffMs = BACKOFF_MIN_MS;
  } catch (err) {
    console.error("Feed hub could not start listening:", err);
    drop(null);
  }
}

// Returns an unsubscribe. The caller (the SSE route) calls it from the
// request's abort handler, so a closed tab takes its subscription with it.
export function subscribeToPlace(placeKey, send) {
  const h = hub();
  let set = h.subscribers.get(placeKey);
  if (!set) {
    set = new Set();
    h.subscribers.set(placeKey, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.subscribers.get(placeKey);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.subscribers.delete(placeKey);
  };
}
