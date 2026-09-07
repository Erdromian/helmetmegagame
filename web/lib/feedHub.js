import "server-only";
import { Client } from "pg";
import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { FEED_CHANNEL } from "@lifeweb/db/lib/feedNotify";
import { PRESENCE_CHANNEL } from "@lifeweb/db/lib/presenceNotify";
import { TYPING_CHANNEL } from "@lifeweb/db/lib/typingNotify";
import { DM_CHANNEL } from "@lifeweb/db/lib/dmNotify";
import { withoutDmNoise, PLAYER_DM_SELECT, playerDmRow } from "./dmThread";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

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
    // characterId -> Set<() => void>. The second channel, added in phase 2:
    // a character's PLACE LIST changes when they walk, when a key opens a
    // door, or when somebody lets them into a conversation, and an open
    // stream has to resubscribe rather than wait for the tab to reload.
    presenceSubscribers: new Map(),
    // placeKey -> Set<({ placeKey, characterId, name }) => void>. The third
    // channel, added in phase 6, and the only one whose payload the hub
    // enriches before fanning it: the notify carries an id, and the presented
    // name is resolved here (see typingNameFor).
    typingSubscribers: new Map(),
    // discordUserId -> Set<(row) => void>. The fourth channel: a DirectMessage
    // landed for this account, and the Hall's Bascinet conversation is open
    // in a tab (HALL.md §2b). Raised by a Postgres trigger rather than by any
    // writer (db/lib/dmNotify.js).
    dmSubscribers: new Map(),
    // characterId -> { name, at }. A typing event fires every few seconds per
    // person, and resolving forced name + concealment is two queries; nobody's
    // mask comes off often enough to pay that on every keystroke burst.
    nameMemo: new Map(),
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

// Presence carries nothing but a character id on purpose. The stream re-asks
// db/lib/feedAccess.js#placesFor for itself, so a notification is a nudge and
// never an authorisation.
function handlePresence(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  const set = hub().presenceSubscribers.get(parsed?.characterId);
  if (!set) return;
  for (const wake of [...set]) {
    try {
      wake();
    } catch (err) {
      console.error("Presence subscriber failed:", err);
    }
  }
}

const NAME_MEMO_MS = 30_000;

// The name this character is WEARING, not the name on their sheet. A typing
// line is a line in the scene, so it obeys the same forced-name > concealment
// > own-name order every message does (db/lib/presentedIdentity.js) — a mask
// that hides who spoke and then announces who is about to would be worse than
// no line at all.
async function typingNameFor(characterId) {
  const h = hub();
  const cached = h.nameMemo.get(characterId);
  // A miss on `name` rather than on the key: the same entry is written by
  // avatarVersionFor below, which knows the face and not the mask.
  if (cached && cached.name != null && Date.now() - cached.at < NAME_MEMO_MS) return cached.name;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return null;
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  const name = presentedIdentity(character, { forcedName, concealment }).name ?? null;
  h.nameMemo.set(characterId, {
    ...(cached ?? {}),
    name,
    avatarVersion: character.updatedAt?.getTime?.() ?? null,
    at: Date.now(),
  });
  return name;
}

// The cache-buster on a face's URL, which has to be the character's updatedAt
// and nothing else.
//
// ArchiveEntry holds characterId as a SNAPSHOT column, not a foreign key
// (schema.prisma), so a row cannot join its character and feedRowShape falls
// back to the row's own sentAt. That fallback is a different number for every
// message, so /api/avatar/<id>?v=… changed on every line and the browser
// refetched a face it already had — most visibly on your own send, where the
// optimistic row (updatedAt) and the streamed row (sentAt) disagreed and the
// avatar blinked. Memoised beside the typing name for the same reason: nobody
// gets a new portrait often enough to pay a query per message.
async function avatarVersionFor(characterId) {
  if (!characterId) return null;
  const h = hub();
  const cached = h.nameMemo.get(characterId);
  if (cached && Date.now() - cached.at < NAME_MEMO_MS && cached.avatarVersion !== undefined) {
    return cached.avatarVersion;
  }
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { updatedAt: true },
  });
  const avatarVersion = character?.updatedAt?.getTime?.() ?? null;
  h.nameMemo.set(characterId, { ...(cached ?? { name: null }), at: Date.now(), avatarVersion });
  return avatarVersion;
}

async function handleTyping(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed?.placeKey || !parsed?.characterId) return;

  // Nobody in this process is watching that place, so nothing is worth
  // spending on a name.
  const set = hub().typingSubscribers.get(parsed.placeKey);
  if (!set || set.size === 0) return;

  const name = await typingNameFor(parsed.characterId);
  if (!name) return;

  const event = { placeKey: parsed.placeKey, characterId: parsed.characterId, name };
  for (const send of [...set]) {
    try {
      send(event);
    } catch (err) {
      console.error("Typing subscriber failed:", err);
    }
  }
}

// A DirectMessage row landed. The payload is an id and the account it is for,
// and the row is re-read here through the desk's own noise filter
// (dmThread.js#withoutDmNoise) — a mention relay or an inspect embed is not
// conversation on the desk, and it is not conversation in the Hall either.
// What goes out is the PLAYER's shape of the row: no author.
async function handleDm(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed?.id || !parsed?.discordUserId) return;
  const set = hub().dmSubscribers.get(String(parsed.discordUserId));
  if (!set || set.size === 0) return;

  const row = await prisma.directMessage.findFirst({
    where: withoutDmNoise({ id: String(parsed.id), discordUserId: String(parsed.discordUserId) }),
    select: PLAYER_DM_SELECT,
  });
  if (!row) return;
  const shaped = playerDmRow(row);
  for (const send of [...set]) {
    try {
      send(shaped);
    } catch (err) {
      console.error("DM subscriber failed:", err);
    }
  }
}

async function handleNotification(msg) {
  if (msg.channel === DM_CHANNEL) {
    if (msg.payload) await handleDm(msg.payload);
    return;
  }
  if (msg.channel === PRESENCE_CHANNEL) {
    if (msg.payload) handlePresence(msg.payload);
    return;
  }
  if (msg.channel === TYPING_CHANNEL) {
    if (msg.payload) await handleTyping(msg.payload);
    return;
  }
  if (msg.channel !== FEED_CHANNEL || !msg.payload) return;
  let parsed;
  try {
    parsed = JSON.parse(msg.payload);
  } catch {
    return;
  }
  if (!parsed?.seq || !parsed?.placeKey) return;
  const op = parsed.op ?? "new";

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
  if (!row) return;

  // A deleted row is still an event — a browser holding it has to be told to
  // drop it. Only its seq goes out; the words that were taken back do not.
  if (row.deletedAt || op === "delete") {
    fanOut(parsed.placeKey, { op: "delete", seq: String(row.seq), placeKey: parsed.placeKey });
    return;
  }

  // An edit goes out as the whole row, and the client replaces by seq. That
  // way there is one shape on the wire for "here is a message" whether it is
  // the first time or the second.
  //
  // `clientId` goes back out to EVERY watcher of the place, not just the tab
  // that sent it. That is fine and cheaper than the alternative: it is a
  // random token with nothing in it, and a browser only ever acts on one it
  // is still holding a pending row for.
  fanOut(
    parsed.placeKey,
    feedRowShape(row, {
      op: op === "edit" ? "edit" : "new",
      avatarVersion: await avatarVersionFor(row.characterId),
      ...(parsed.clientId ? { clientId: String(parsed.clientId) } : {}),
    }),
  );
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
    // Both channels on the ONE client: LISTEN belongs to a session, and a
    // second connection would double the reconnect logic for no gain.
    await client.query(`LISTEN ${FEED_CHANNEL}`);
    await client.query(`LISTEN ${PRESENCE_CHANNEL}`);
    await client.query(`LISTEN ${TYPING_CHANNEL}`);
    await client.query(`LISTEN ${DM_CHANNEL}`);
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

// The same contract again, for the typing channel. Separate from
// subscribeToPlace because a stream subscribes to both for the same place and
// has to be able to drop one without the other — and because a typing event
// is not a row, so mixing it into the row fan-out would put a shape on that
// wire that every reader would have to test for.
export function subscribeToTyping(placeKey, send) {
  const h = hub();
  let set = h.typingSubscribers.get(placeKey);
  if (!set) {
    set = new Set();
    h.typingSubscribers.set(placeKey, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.typingSubscribers.get(placeKey);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.typingSubscribers.delete(placeKey);
  };
}

// The same contract as subscribeToPlace, for the other channel: returns an
// unsubscribe the SSE route calls from the request's abort handler.
export function subscribeToPresence(characterId, wake) {
  const h = hub();
  if (!characterId) return () => {};
  let set = h.presenceSubscribers.get(characterId);
  if (!set) {
    set = new Set();
    h.presenceSubscribers.set(characterId, set);
  }
  set.add(wake);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.presenceSubscribers.get(characterId);
    if (!current) return;
    current.delete(wake);
    if (current.size === 0) h.presenceSubscribers.delete(characterId);
  };
}

// The same contract once more, keyed on the Discord account rather than on a
// place: a DM is addressed to a person, wherever their character stands.
export function subscribeToDm(discordUserId, send) {
  const h = hub();
  if (!discordUserId) return () => {};
  const key = String(discordUserId);
  let set = h.dmSubscribers.get(key);
  if (!set) {
    set = new Set();
    h.dmSubscribers.set(key, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.dmSubscribers.get(key);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.dmSubscribers.delete(key);
  };
}
