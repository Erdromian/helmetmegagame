// The outbox: the bot is the only process that talks to Discord about chat.
// A message typed into /chat is written straight to ArchiveEntry with
// `source = WEB` and no `discordMessageId`; this module listens on the
// `bascinet_feed` NOTIFY channel, picks those rows up, and posts them via
// the same webhook path a proxied message takes. Two ways in: the LISTEN is
// the fast path, drainFeedOutbox() is the catch-up run once on ready, making
// a bot restart mid-send harmless.

const { Client } = require("pg");
const { prisma } = require("@lifeweb/db");
const {
  postAsCharacter,
  ensureChannelWebhook,
  editWebhookMessage,
  deleteWebhookMessage,
} = require("@lifeweb/db/lib/discordRest");
const { conversationMemberIds } = require("@lifeweb/db/lib/conversations");
const { witnessIdsAt } = require("@lifeweb/db/lib/archiveWitnesses");
const { sendDm } = require("@lifeweb/db/lib/dm"); // by path, never the barrel — three exports share the name (CLAUDE.md)
const { MENTION_SOURCE } = require("@lifeweb/db/lib/dmKinds");
const { loadForcedName, loadConcealment, presentedIdentity } = require("@lifeweb/db/lib/presentedIdentity");
const { pushToUser } = require("@lifeweb/db/lib/webPush");
const { FEED_CHANNEL } = require("@lifeweb/db/lib/feedNotify");
const {
  discordTargetForPlaceKey,
  discordTargetForThread,
  archiveContextForPlaceKey,
  parsePlaceKey,
} = require("@lifeweb/db/lib/placeKey");
const { relayRow, crossRoomPlaceKeys } = require("./roomRelay");
const {
  tokensToRoles,
  earshotForPlaceKey,
  inEarshot,
  charactersNamedNearby,
} = require("@lifeweb/db/lib/characterMentions");
const { currentGameId } = require("@lifeweb/db/lib/archive");
const { discordTextFor, relayWordsToSkinless, isSkinless } = require("@lifeweb/db/lib/skinless");

const DRAIN_WINDOW_MS = 24 * 60 * 60 * 1000; // older rows aren't worth posting into a scene long moved on
const DRAIN_LIMIT = 200;

const BACKOFF_MIN_MS = 1000; // doubling reconnect backoff to a cap
const BACKOFF_MAX_MS = 60_000;

let listener = null;
let backoffMs = BACKOFF_MIN_MS;
let stopped = false;
let queue = Promise.resolve(); // one row at a time, in arrival order

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

// Which Discord channel/thread a place key names (db/lib/placeKey.js#discordTargetForPlaceKey).
async function targetFor(placeKey) {
  const target = await discordTargetForPlaceKey(prisma, placeKey);
  if (!target) console.log(`Feed outbox: no Discord target for place key ${placeKey} — skipping.`);
  return target;
}

// Same identity load messageCreate.js does: forced name beats concealment beats own.
async function identityPiecesFor(characterId) {
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  return { forcedName, concealment };
}

// Caps how many people one web-sent line can notify; bot/src/events/messageCreate.js caps the Discord path the same way.
const MAX_MENTION_RELAYS = 10;

function messageLink(channelId, messageId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// The mention relay for a WEB-origin row — same shape as a Discord-origin mention
// (bot/src/lib/mentions.js#notifyMentioned): a browser push saying where, never the
// words. Concealed sends relay nothing.
//
// Two lists, and only the first can DM. `characters` are the `{char:…}` tokens —
// somebody picked out of the @ menu on purpose — and one of those DMs its target
// on Discord when they witness the place it was said in
// (db/lib/archiveWitnesses.js#witnessIdsAt). `named` are bare names, a title
// or a name said in passing, and those only ever get the push.
//
// A mention never lets anybody IN: only /add does that (COMMANDS.md §2b). So in a
// Conversation the ping reaches its members and nobody else, since nobody else
// can open it.
async function relayWebMentions({ row, characters, named = [], concealed, channelId, messageId }) {
  if (concealed || (characters.length === 0 && named.length === 0)) return;

  // Token targets first, so a name that is both picked and typed keeps its DM.
  const wanted = [];
  const seen = new Set();
  for (const entry of [
    ...characters.map((target) => ({ target, tagged: true })),
    ...named.map((target) => ({ target, tagged: false })),
  ]) {
    if (!entry.target?.id || seen.has(entry.target.id)) continue;
    seen.add(entry.target.id);
    wanted.push(entry);
  }

  const parsed = parsePlaceKey(row.placeKey);
  const [earshot, context, memberIds, witnessIds] = await Promise.all([
    earshotForPlaceKey(prisma, row.placeKey),
    archiveContextForPlaceKey(prisma, row.placeKey), // same zone/thread names /archive uses
    parsed?.kind === "conv" ? conversationMemberIds(prisma, parsed.id) : null,
    wanted.some((entry) => entry.tagged) ? witnessIdsAt(prisma, row.placeKey, row.characterId) : null,
  ]);
  const place = context.zoneName ?? "somewhere";
  const where = context.threadName ? `${place} · ${context.threadName}` : place;
  const link = messageLink(channelId, messageId);

  for (const { target, tagged } of wanted.slice(0, MAX_MENTION_RELAYS)) {
    if (!target.discordUserId) continue;
    // A bare-name target came out of the earshot query itself, so it has already
    // passed this; a token target has not, and a ping must not carry further
    // than a voice would (PROXYING.md §6).
    if (!inEarshot(target, earshot)) continue;
    if (memberIds && !memberIds.includes(target.id)) continue;
    if (tagged && link && witnessIds?.has(target.id)) {
      await sendDm(prisma, target.discordUserId, `*You were mentioned in ${where}.*\n${link}`, {
        source: MENTION_SOURCE,
        meta: { placeKey: row.placeKey, where },
      }).catch((err) => console.error(`Feed outbox couldn't DM a mention to ${target.name}:`, err?.message ?? err));
    }
    // Browser notification for a closed /chat tab; wrapped so a failed push never costs the DM.
    await pushToUser(prisma, target.discordUserId, {
      title: `${target.name} was named`,
      body: `in ${where}`,
      url: `/chat#${encodeURIComponent(row.placeKey)}`,
    }).catch(() => { });
  }
}

const ROW_SELECT = {
  id: true,
  seq: true,
  placeKey: true,
  characterId: true,
  // The frozen name. Only a Deadchat row needs it, but it is one column on a select that already
  // runs for every row, and a conditional select would be two shapes to keep in step.
  characterName: true,
  content: true,
  source: true,
  // Scopes the concealed discriminator so two hooded speakers stop grouping in Discord
  // (db/lib/concealedDiscriminator.js). Frozen on the row at write time, so an edited
  // hooded line keeps its original suffix and stays in the same block as siblings.
  turnNumber: true,
  discordMessageId: true,
  editedAt: true,
  deletedAt: true,
  discordSyncedAt: true,
  // What the room relay (./roomRelay.js) decides on: which thread a line was
  // said in, what kind of row it is, and whether it was meant for one reader.
  kind: true,
  channelKind: true,
  discordChannelId: true,
  onlyCharacterId: true,
  exceptCharacterId: true,
};

// Is Discord behind on this row? `discordSyncedAt` is the watermark.
function behind(stamp, syncedAt) {
  if (!stamp) return false;
  if (!syncedAt) return true;
  return new Date(stamp).getTime() > new Date(syncedAt).getTime();
}

// One row, posted. Returns true when Discord took it.
async function pushRow(row) {
  if (!row || row.source !== "WEB" || row.discordMessageId || row.deletedAt) return false;
  if (!row.characterId) return false;

  // Re-read right before posting: drain and a notification can both pick this row up at
  // startup, and the updateMany guard below only stops the second CLAIM, not the second post.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { discordMessageId: true, deletedAt: true },
  });
  if (!fresh || fresh.discordMessageId || fresh.deletedAt) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    // Exactly what presentedIdentity reads (concealed, age/gender for the alias, updatedAt for the avatar cache-bust).
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return false;

  const { forcedName, concealment } = await identityPiecesFor(character.id);

  // Row stores `{char:<id>}`; Discord reads `<@&roleId>` (db/lib/characterMentions.js).
  // Rewritten here, not at write time, so /chat and /archive keep the face-neutral text.
  const { content: said, characters } = await tokensToRoles(prisma, row.content);
  const deadchat = parsePlaceKey(row.placeKey)?.kind === "dead";
  // A Skinless's line goes out as grunts: Discord shows everybody one text
  // (db/lib/skinless.js). Never in Deadchat, which is out of character.
  const skinless = !deadchat && (await isSkinless(prisma, row.characterId));
  const content = skinless ? await discordTextFor(prisma, { characterId: row.characterId, content: said, seq: row.seq }) : said;

  // Resolved here too, since the mention relay below reads `alias` (set for both a hood and a forced name).
  const identity = presentedIdentity(character, { forcedName, concealment });

  // A Deadchat row carries a name composed and frozen at send time (db/lib/say.js): the character's
  // name plus the player's account handle. Re-deriving it from the live character here would drop
  // the account half and re-apply a hood the corpse is still wearing.
  const posted = await postAsCharacter(target.channelId, character, content, {
    forcedName,
    concealment,
    threadId: target.threadId,
    displayName: deadchat ? row.characterName : null,
    // Same (turn, place) scope as the gateway proxy — a web-typed hooded line
    // groups with the same speaker's other lines and reads as one speaker,
    // separate from a second hood in the room.
    turnNumber: row.turnNumber ?? null,
    placeKey: row.placeKey,
  });
  if (!posted?.id) return false;

  // updateMany, not update: the row may have been claimed by the other path since it was read.
  const claimed = await prisma.archiveEntry.updateMany({
    where: { id: row.id, discordMessageId: null },
    data: {
      discordMessageId: posted.id,
      discordChannelId: target.threadId ?? target.channelId,
      discordSyncedAt: new Date(),
    },
  });
  if (claimed.count === 0) return false;

  // After the claim, so a row that lost the race never DMs twice. Best-effort: a failed relay never costs the post.
  //
  // Never from Deadchat. A mention typed there would DM a living player about something said in a
  // room they cannot reach — the dead reaching into the world, which this seat must not do. Refused
  // by name rather than left to earshot returning nothing for an unknown kind.
  // A Skinless's grunts name nobody, so they ping nobody; the other Skinless
  // here who play on Discord get the words instead.
  if (skinless) {
    await relayWordsToSkinless(prisma, { seq: row.seq }).catch((err) =>
      console.error("Skinless words relay failed:", err?.message ?? err),
    );
  } else if (!deadchat) {
    // And a BARE NAME is a mention too, on both faces (REDESIGN.md §2, §6): the
    // nine lines out of ten that just say "Marrow, get down" rather than picking
    // her out of the @ menu. Notify-only — see relayWebMentions — and the TEXT is
    // left exactly as written, so Discord reads the words the room read.
    // Best-effort: a mention relay has never been allowed to cost the post.
    const named = identity.alias
      ? [] // a hooded send relays nothing at all, so there is nothing to look up
      : await charactersNamedNearby(prisma, {
          placeKey: row.placeKey,
          content: row.content,
          speakerId: row.characterId,
        }).catch((err) => {
          console.error("Bare-name mention lookup failed:", err?.message ?? err);
          return [];
        });
    await relayWebMentions({
      row,
      characters,
      named,
      concealed: Boolean(identity.alias),
      channelId: target.threadId ?? target.channelId,
      messageId: posted.id,
    }).catch((err) => console.error("Feed outbox mention relay failed:", err));
  }

  return true;
}

// One row, edited on Discord — runs for a ✏️ in Discord exactly as for a ✎ on /chat.
async function editRow(row) {
  if (!row?.discordMessageId || row.deletedAt) return false;

  // Re-read right before acting — same guard as pushRow, against two edits racing.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { content: true, editedAt: true, deletedAt: true, discordSyncedAt: true, discordMessageId: true },
  });
  if (!fresh || fresh.deletedAt || !fresh.discordMessageId) return false;
  if (!behind(fresh.editedAt, fresh.discordSyncedAt)) return false;

  // The thread the line is actually in: a room with more than one (db/lib/roomSides.js)
  // keeps each line where it was said, and the relay edits the copies.
  const target = await discordTargetForThread(prisma, row.placeKey, row.discordChannelId);
  if (!target) return false;

  const webhook = await ensureChannelWebhook(target.channelId);
  const { content: said } = await tokensToRoles(prisma, fresh.content); // same rewrite pushRow does
  // An edited Skinless line is still grunts on Discord (db/lib/skinless.js).
  const content =
    parsePlaceKey(row.placeKey)?.kind === "dead"
      ? said
      : await discordTextFor(prisma, { characterId: row.characterId, content: said, seq: row.seq });
  await editWebhookMessage(webhook, fresh.discordMessageId, content, target.threadId);

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// One row, deleted on Discord. The row stays (soft delete) with its discordMessageId, so nothing reposts it.
async function deleteRow(row) {
  if (!row?.discordMessageId || !row.deletedAt) return false;

  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { deletedAt: true, discordSyncedAt: true, discordMessageId: true },
  });
  if (!fresh?.deletedAt || !fresh.discordMessageId) return false;
  if (!behind(fresh.deletedAt, fresh.discordSyncedAt)) return false;

  const target = await discordTargetForThread(prisma, row.placeKey, row.discordChannelId);
  if (!target) return false;

  const webhook = await ensureChannelWebhook(target.channelId);
  await deleteWebhookMessage(webhook, fresh.discordMessageId, target.threadId); // allow404: already-removed is fine

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// Chosen off the ROW, not the notification's `op` — the row is the truth, and the drain has no op at all.
//
// Then, for a room with a thread under more than one Location, every other
// thread gets its copy (./roomRelay.js) — for web, Discord and scenery rows
// alike, since all three reach this function.
async function syncRow(row) {
  if (!row) return false;
  let done = false;
  if (row.deletedAt) done = await deleteRow(row);
  else if (!row.discordMessageId) done = await pushRow(row);
  else if (row.editedAt) done = await editRow(row);
  const relayed = await relayRow(row).catch((err) => {
    console.error(`Room relay failed for archive row ${row.id}:`, err);
    return 0;
  });
  return done || relayed > 0;
}

async function syncBySeq(seq) {
  const row = await prisma.archiveEntry.findUnique({ where: { seq }, select: ROW_SELECT });
  await syncRow(row);
}

// Every row of the last day Discord is behind on. Called on ready, so a message sent, edited or deleted while
// the bot was down still lands.
async function drainFeedOutbox() {
  try {
    // Scoped to the current game too: sentAt alone can't tell a live row from one an
    // archive re-import brought back inside the window, which would narrate a dead game.
    const gameId = await currentGameId(prisma);
    const rows = await prisma.archiveEntry.findMany({
      where: {
        ...(gameId ? { gameId } : {}),
        sentAt: { gte: new Date(Date.now() - DRAIN_WINDOW_MS) },
        OR: [
          { source: "WEB", discordMessageId: null, deletedAt: null }, // never posted
          // Edited or deleted while down. Prisma can't compare two columns in a filter, so this is a
          // coarse "has one of the two stamps" test; syncRow's re-read settles it exactly.
          { discordMessageId: { not: null }, deletedAt: { not: null } },
          { discordMessageId: { not: null }, editedAt: { not: null } },
        ],
      },
      orderBy: { seq: "asc" },
      take: DRAIN_LIMIT,
      select: ROW_SELECT,
    });
    let sent = 0;
    for (const row of rows) {
      try {
        if (await syncRow(row)) sent += 1;
      } catch (err) {
        console.error(`Feed outbox couldn't sync archive row ${row.id}:`, err);
      }
    }
    if (sent) console.log(`Feed outbox: ${sent} archive row(s) carried across to Discord.`);
    await drainRoomRelays(gameId);
    return sent;
  } catch (err) {
    console.error("Feed outbox drain failed:", err);
    return 0;
  }
}

// The newest lines in every room with more than one thread, looked at again so
// a copy the relay missed while the bot was down still goes out. A query of its
// own, newest first, so a busy counter can never crowd the drain above out of
// the web lines it exists to post.
async function drainRoomRelays(gameId) {
  const crossRooms = await crossRoomPlaceKeys().catch(() => []);
  if (crossRooms.length === 0) return 0;
  const rows = await prisma.archiveEntry.findMany({
    where: {
      ...(gameId ? { gameId } : {}),
      placeKey: { in: crossRooms },
      kind: "MESSAGE",
      sentAt: { gte: new Date(Date.now() - DRAIN_WINDOW_MS) },
    },
    orderBy: { seq: "desc" },
    take: DRAIN_LIMIT,
    select: ROW_SELECT,
  });
  let moved = 0;
  for (const row of rows.reverse()) {
    moved += await relayRow(row).catch((err) => {
      console.error(`Room relay drain failed for archive row ${row.id}:`, err);
      return 0;
    });
  }
  if (moved) console.log(`Feed outbox: ${moved} room line(s) relayed between threads.`);
  return moved;
}

function scheduleReconnect() {
  if (stopped) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  setTimeout(guarded("Feed outbox reconnect", openListener), wait).unref?.();
}

// One pg client, not a Pool: LISTEN is a property of a single session.
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
    client.end().catch(() => { });
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
      const seq = BigInt(parsed.seq); // payload carries seq as a string on purpose; Number would lose precision
      enqueue(() => syncBySeq(seq));
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
      client.end().catch(() => { });
    }
    scheduleReconnect();
  }
}

// Called from ready. Never throws: a bot that can't start the outbox still comes up, just one-way.
async function startFeedOutbox() {
  stopped = false;
  await openListener().catch((err) => console.error("Feed outbox failed to start:", err));
  await enqueue(drainFeedOutbox); // same queue as notifications, so the drain never races a live row
}

module.exports = { startFeedOutbox, drainFeedOutbox };
