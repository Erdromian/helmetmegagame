// Writes the game transcript (ArchiveEntry), the store behind /archive.
//
// Rows are recorded at SEND time rather than reconstructed at Dawn. The old
// db/lib/dawnWipe.js archived by reading every message back out of Discord and
// re-posting it into a single #archive channel — hundreds of sequential posts
// down one ~1 msg/sec lane, the most expensive thing the bot did, and it grew
// with player count. It also had to guess at two fields it can now be told
// outright: the character (matched by *current* name, so a rename
// mis-attributed everything they had ever said) and the turn (inferred by
// comparing timestamps against Turn.gameDate).
//
// Takes `prisma` as a parameter rather than require("../index"), same reason
// as dm.js and turnAnnouncement.js: db/index.js imports this module, so
// requiring it back would resolve to a partial (prisma-less) exports object.
// Deliberately NOT spread into the @lifeweb/db barrel — require it by path.

const { notifyFeed } = require("./feedNotify");

// The columns the live feed needs off a row, and nothing else. Kept beside
// feedRowShape below so the two never drift.
const FEED_ROW_SELECT = {
  seq: true,
  placeKey: true,
  characterId: true,
  characterName: true,
  concealedAlias: true,
  content: true,
  sentAt: true,
  source: true,
  editedAt: true,
  deletedAt: true,
};

// One archived row as the wire shape /play and /api/feed speak.
//
// `name` is the PRESENTED name: a concealed or forced send was written under
// its alias, and that is the only name the room ever heard. `discordUserId`
// is never sent — the whole point of the proxy is that the web page has no
// more idea who is behind a character than a Discord channel does.
//
// `seq` is a BigInt on the row and a STRING here. JSON.stringify throws on a
// BigInt, and a Number would lose precision at the far end of the range.
function feedRowShape(row, extra = {}) {
  if (!row) return null;
  return {
    seq: String(row.seq),
    placeKey: row.placeKey ?? null,
    characterId: row.characterId ?? null,
    name: row.concealedAlias ?? row.characterName ?? null,
    alias: row.concealedAlias ?? null,
    avatarVersion: row.avatarVersion ?? (row.sentAt ? new Date(row.sentAt).getTime() : null),
    content: row.content ?? "",
    sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
    source: row.source ?? "DISCORD",
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    ...extra,
  };
}

// Every write here is best-effort and swallows its own failure. A transcript
// row is never worth breaking a player's message over, and the proxy path
// calls this inline with the send. Failures are logged, not thrown.
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Archive ${label} failed:`, err);
    return null;
  }
}

// Which game a row belongs to: GameState.gameId, memoised for half a minute
// so a message costs no extra round trip. The wipe swaps the id; a stale memo
// for up to thirty seconds after a wipe stamps a row nobody will read, which
// is fine — the wipe also drops every character who could have written one.
const GAME_ID_TTL_MS = 30 * 1000;
let gameIdMemo = { id: null, at: 0 };

async function currentGameId(prisma) {
  const now = Date.now();
  if (gameIdMemo.id && now - gameIdMemo.at < GAME_ID_TTL_MS) return gameIdMemo.id;
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  if (state?.gameId) gameIdMemo = { id: state.gameId, at: now };
  return state?.gameId ?? gameIdMemo.id;
}

// The wipe calls this so the next row lands in the new game at once.
function forgetGameId() {
  gameIdMemo = { id: null, at: 0 };
}

// The open turn, so a row can be stamped with when it happened in the fiction.
// Callers that already hold the turn (advanceTurn, the auto-labor pass) pass
// it in to skip the lookup.
async function resolveTurn(prisma, turn) {
  if (turn) return turn;
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
}

// One proxied character message. `concealedAlias` is non-null only for a
// /conceal send — both halves are kept, since the panel renders
// "Young Man (Sir Alder)": the alias is what the room saw, characterName is
// who it actually was.
async function recordArchiveMessage(prisma, entry) {
  return safely("message write", async () => {
    const [turn, gameId] = await Promise.all([resolveTurn(prisma, entry.turn), currentGameId(prisma)]);
    const row = await prisma.archiveEntry.create({
      data: {
        kind: "MESSAGE",
        gameId,
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        zoneId: entry.zoneId ?? null,
        zoneName: entry.zoneName ?? null,
        characterId: entry.character?.id ?? null,
        characterName: entry.character?.name ?? null,
        concealedAlias: entry.concealedAlias ?? null,
        content: entry.content ?? "",
        discordMessageId: entry.discordMessageId ?? null,
        channelKind: entry.channelKind ?? null,
        threadName: entry.threadName ?? null,
        discordChannelId: entry.discordChannelId ?? null,
        placeKey: entry.placeKey ?? null,
        source: entry.source ?? "DISCORD",
        // A row the bot itself just posted is already on Discord, so the
        // outbox has nothing to do with it. A WEB row leaves this null, which
        // is exactly what the outbox looks for.
        discordSyncedAt: entry.discordMessageId ? new Date() : null,
      },
    });

    // After the insert, never inside it: a listener woken before the row is
    // committed would look it up and find nothing.
    if (row.placeKey) await notifyFeed(prisma, { seq: row.seq, placeKey: row.placeKey });
    return row;
  });
}

// A system event — a turn opening, a death, a fulfilled Desire. Same table as
// messages so the two interleave chronologically and the transcript reads as a
// diary rather than a chat log with no context.
async function recordArchiveEvent(prisma, entry) {
  return safely(`${entry.kind} write`, async () => {
    const [turn, gameId] = await Promise.all([resolveTurn(prisma, entry.turn), currentGameId(prisma)]);
    const row = await prisma.archiveEntry.create({
      data: {
        kind: entry.kind,
        gameId,
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        zoneId: entry.zoneId ?? null,
        zoneName: entry.zoneName ?? null,
        characterId: entry.character?.id ?? entry.characterId ?? null,
        characterName: entry.character?.name ?? entry.characterName ?? null,
        content: entry.content ?? "",
        placeKey: entry.placeKey ?? null,
        source: entry.source ?? "SYSTEM",
      },
    });

    if (row.placeKey) await notifyFeed(prisma, { seq: row.seq, placeKey: row.placeKey });
    return row;
  });
}

// The row that a Discord message id belongs to. Since phase 1 this is what
// the reactions look themselves up with, in place of the in-memory
// recentProxies map that a restart emptied.
async function archiveRowForMessage(prisma, discordMessageId) {
  if (!discordMessageId) return null;
  return prisma.archiveEntry.findUnique({
    where: { discordMessageId },
    select: {
      id: true,
      seq: true,
      placeKey: true,
      characterId: true,
      characterName: true,
      concealedAlias: true,
      content: true,
      sentAt: true,
      deletedAt: true,
      kind: true,
    },
  });
}

// ✏️ and ❌, keyed on the Discord message id. Both are thin now: db/lib/say.js
// owns the owner check, the five-minute window, the transforms and the notify,
// and bot/src/lib/feedOutbox.js is the only thing that touches Discord.
//
// `require` inside the function, not at the top: say.js requires this module,
// and a cycle at load time would hand it a half-built exports object.
async function updateArchiveMessage(prisma, discordMessageId, content, options = {}) {
  return safely("message edit", async () => {
    const row = await archiveRowForMessage(prisma, discordMessageId);
    if (!row) return { ok: false, refusal: "That message is gone. ‡" };
    const { editSpeech } = require("./say");
    return editSpeech(prisma, { characterId: row.characterId, seq: row.seq, content, ...options });
  });
}

// Soft since phase 1. A client holding the row has to be able to reconcile,
// and the outbox needs something to read when it goes to remove the Discord
// message — so the row stays and /archive and /play filter it out.
async function deleteArchiveMessage(prisma, discordMessageId, options = {}) {
  return safely("message delete", async () => {
    const row = await archiveRowForMessage(prisma, discordMessageId);
    if (!row) return { ok: false, refusal: "That message is gone. ‡" };
    const { deleteSpeech } = require("./say");
    return deleteSpeech(prisma, { characterId: row.characterId, seq: row.seq, ...options });
  });
}

module.exports = {
  FEED_ROW_SELECT,
  feedRowShape,
  currentGameId,
  forgetGameId,
  recordArchiveMessage,
  recordArchiveEvent,
  archiveRowForMessage,
  updateArchiveMessage,
  deleteArchiveMessage,
};
