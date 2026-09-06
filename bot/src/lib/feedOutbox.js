// The outbox: the bot is the only process that talks to Discord about chat.
//
// A message typed into /play is written straight to ArchiveEntry with
// `source = WEB` and no `discordMessageId`. This module listens on the
// `bascinet_feed` NOTIFY channel, picks those rows up, and posts them into the
// Location's Discord channel through the same webhook path a proxied message
// takes. The web app therefore never needs a Discord token for chat, and one
// process owns the rate-limit lane.
//
// Two ways in, on purpose. The LISTEN is the fast path (a fraction of a second
// from send to Discord); drainFeedOutbox() is the catch-up, run once on ready,
// which is what makes a bot restart mid-send harmless. That is the same
// posture every other catch-up pass in ready.js takes.

const { Client } = require("pg");
const { prisma } = require("@lifeweb/db");
const { postAsCharacter } = require("@lifeweb/db/lib/discordRest");
const { loadForcedName, loadConcealment } = require("@lifeweb/db/lib/presentedIdentity");
const { FEED_CHANNEL } = require("@lifeweb/db/lib/feedNotify");
const { parsePlaceKey } = require("@lifeweb/db/lib/placeKey");

// How far back the catch-up looks. A row older than this that never reached
// Discord is not worth posting into a scene that moved on hours ago — the
// archive still has it.
const DRAIN_WINDOW_MS = 24 * 60 * 60 * 1000;
const DRAIN_LIMIT = 200;

// Reconnect backoff, doubling to a cap. A listener that retried in a tight
// loop against a database that is down would be the loudest thing in the log.
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

let listener = null;
let backoffMs = BACKOFF_MIN_MS;
let stopped = false;
// One row at a time, in arrival order: two concurrent posters against the
// same channel webhook would interleave a scene.
let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn).catch((err) => console.error("Feed outbox job failed:", err));
  return queue;
}

// Every callback below goes through this. An exception out of a pg event
// handler is an unhandled rejection, and an unhandled rejection kills the bot.
function guarded(label, fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.catch === "function") out.catch((err) => console.error(`${label} failed:`, err));
    } catch (err) {
      console.error(`${label} failed:`, err);
    }
  };
}

// Which Discord channel a place key names. Only `loc:` is wired for the
// spike; rooms, conversations and zone summaries are phase 1, and a row for
// one of those is left alone rather than guessed at.
async function channelIdForPlaceKey(placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return null;
  if (parsed.kind !== "loc") {
    console.log(`Feed outbox: no Discord target for place key ${placeKey} yet — skipping.`);
    return null;
  }
  const location = await prisma.location.findUnique({
    where: { id: parsed.id },
    select: { discordChannelId: true },
  });
  return location?.discordChannelId ?? null;
}

// The identity load messageCreate.js does, for a character the web sent as:
// a forced name beats a concealment beats their own, and postAsCharacter
// resolves the three itself given these two pieces.
async function identityPiecesFor(characterId) {
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  return { forcedName, concealment };
}

// One row, posted. Returns true when Discord took it.
async function pushRow(row) {
  if (!row || row.source !== "WEB" || row.discordMessageId || row.deletedAt) return false;
  if (!row.characterId) return false;

  // Re-read the claim right before the post. The drain and a notification can
  // both pick a row up at startup, and the updateMany guard below only stops
  // the second CLAIM — by then the second post has already hit Discord.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { discordMessageId: true, deletedAt: true },
  });
  if (!fresh || fresh.discordMessageId || fresh.deletedAt) return false;

  const channelId = await channelIdForPlaceKey(row.placeKey);
  if (!channelId) return false;

  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    // Exactly what presentedIdentity reads: `concealed` is the character's
    // own /conceal switch, `age`/`gender` build the concealed alias ("young
    // man"), and `updatedAt` is the avatar's cache-busting version.
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return false;

  const { forcedName, concealment } = await identityPiecesFor(character.id);

  const posted = await postAsCharacter(channelId, character, row.content, { forcedName, concealment });
  if (!posted?.id) return false;

  // updateMany, not update: the row may have been soft-deleted or already
  // claimed by the other path since it was read, and the guard makes this
  // idempotent rather than double-posting on a race.
  const claimed = await prisma.archiveEntry.updateMany({
    where: { id: row.id, discordMessageId: null },
    data: { discordMessageId: posted.id, discordChannelId: channelId, discordSyncedAt: new Date() },
  });
  return claimed.count > 0;
}

async function pushBySeq(seq) {
  const row = await prisma.archiveEntry.findUnique({
    where: { seq },
    select: {
      id: true,
      seq: true,
      placeKey: true,
      characterId: true,
      content: true,
      source: true,
      discordMessageId: true,
      deletedAt: true,
    },
  });
  await pushRow(row);
}

// Every WEB row of the last day that never reached Discord. Called on ready,
// so a message sent while the bot was down still lands.
async function drainFeedOutbox() {
  try {
    const rows = await prisma.archiveEntry.findMany({
      where: {
        source: "WEB",
        discordMessageId: null,
        deletedAt: null,
        sentAt: { gte: new Date(Date.now() - DRAIN_WINDOW_MS) },
      },
      orderBy: { seq: "asc" },
      take: DRAIN_LIMIT,
      select: {
        id: true,
        seq: true,
        placeKey: true,
        characterId: true,
        content: true,
        source: true,
        discordMessageId: true,
        deletedAt: true,
      },
    });
    let sent = 0;
    for (const row of rows) {
      try {
        if (await pushRow(row)) sent += 1;
      } catch (err) {
        console.error(`Feed outbox couldn't post archive row ${row.id}:`, err);
      }
    }
    if (rows.length) console.log(`Feed outbox: ${sent}/${rows.length} pending web message(s) pushed to Discord.`);
    return sent;
  } catch (err) {
    console.error("Feed outbox drain failed:", err);
    return 0;
  }
}

function scheduleReconnect() {
  if (stopped) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  setTimeout(guarded("Feed outbox reconnect", openListener), wait).unref?.();
}

// One pg client, not a Pool: LISTEN is a property of a single session, and a
// pooled connection can be handed to somebody else between notifications.
async function openListener() {
  if (stopped || listener) return;
  if (!process.env.DATABASE_URL) {
    console.warn("Feed outbox: no DATABASE_URL, the web feed will not reach Discord.");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  listener = client;

  const drop = guarded("Feed outbox listener", (err) => {
    if (listener !== client) return;
    if (err) console.error("Feed outbox listener error:", err);
    listener = null;
    client.removeAllListeners();
    client.end().catch(() => {});
    scheduleReconnect();
  });

  client.on("error", drop);
  client.on("end", () => drop(null));

  client.on(
    "notification",
    guarded("Feed outbox notification", (msg) => {
      if (msg.channel !== FEED_CHANNEL || !msg.payload) return;
      let parsed;
      try {
        parsed = JSON.parse(msg.payload);
      } catch {
        return;
      }
      if (!parsed?.seq) return;
      // The payload carries seq as a string on purpose; a Number would lose
      // precision, and Prisma wants a BigInt for the column anyway.
      const seq = BigInt(parsed.seq);
      enqueue(() => pushBySeq(seq));
    }),
  );

  try {
    await client.connect();
    await client.query(`LISTEN ${FEED_CHANNEL}`);
    backoffMs = BACKOFF_MIN_MS;
    console.log("Feed outbox listening on bascinet_feed.");
  } catch (err) {
    console.error("Feed outbox could not start listening:", err);
    if (listener === client) {
      listener = null;
      client.removeAllListeners();
      client.end().catch(() => {});
    }
    scheduleReconnect();
  }
}

// Called from ready. Never throws: a bot that cannot start the outbox is a
// bot whose web feed is one-way, not a bot that fails to come up.
async function startFeedOutbox() {
  stopped = false;
  await openListener().catch((err) => console.error("Feed outbox failed to start:", err));
  // Through the same queue the notifications use, so the drain and a row that
  // arrives while it runs never post side by side.
  await enqueue(drainFeedOutbox);
}

function stopFeedOutbox() {
  stopped = true;
  const client = listener;
  listener = null;
  if (client) {
    client.removeAllListeners();
    client.end().catch(() => {});
  }
}

module.exports = { startFeedOutbox, drainFeedOutbox, stopFeedOutbox };
