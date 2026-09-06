// The one write path: everything a character says, on either face, goes
// through here.
//
// Before phase 1 there were three of them. bot/src/lib/proxy.js ran the
// speech gate, the babble pass and the autocorrect pass inside the webhook
// poster; the Speak modal ran a second copy of the gate and then leaned on
// that one; and the web's say route ran neither, so {tag:stupid} garbled a
// Discord message and left a web one perfectly articulate. Three answers to
// one question is two too many.
//
// The split is between DECIDING and WRITING, because the two faces need the
// same decision in a different order:
//
//   Discord — prepareSpeech, post the webhook, recordSpeech with the id.
//   Web     — sayInPlace (prepare + record), and the outbox posts it after.
//
// Takes `prisma` as a parameter rather than requiring db/index.js, same
// reason as archive.js and dm.js: db/index.js imports this module, so
// requiring it back would resolve to a partial exports object.

const { recordArchiveMessage } = require("./archive");
const { notifyFeed } = require("./feedNotify");
const { babble, STUPID_SLUG } = require("./babble");
const { blockerFor, slugsBlocking, SPEAK } = require("./incapacitation");
const { capitalizeSentences, fixContractions } = require("./textCorrection");
const {
  loadForcedName,
  loadConcealment,
  presentedIdentity,
} = require("./presentedIdentity");
const { mayWritePlace, slowmodeMsFor } = require("./feedAccess");

// Discord's own ceiling for a message. Kept on the web side too, because the
// outbox has to be able to repost whatever lands in a row.
const MESSAGE_LIMIT = 2000;

// How long a message stays yours to change. Bascinet's call, and the same
// number on both faces: past it, ✏️ and ❌ refuse and so do the web's ✎ and ✕.
const EDIT_WINDOW_MS = 5 * 60_000;

// Everything about a character's voice, read off the DATABASE in one query
// rather than off a passed-in tag list.
//
// This was bot/src/lib/proxy.js#loadVoiceState, and the reason it reads the
// sheet is worth keeping: every caller reaches speech through a different
// include. messageCreate.js loads a FILTERED tag list for identity and does
// not even select `slug`, and the Speak modal's findAliveCharacter loads no
// tags at all — so a gate that trusted the caller's include read undefined
// and passed everybody.
const VOICE_SLUGS = [...slugsBlocking(SPEAK), STUPID_SLUG];

async function loadVoiceState(prisma, characterId) {
  if (!characterId) return { block: null, babbling: false };
  const rows = await prisma.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: VOICE_SLUGS } } },
    select: { tag: { select: { slug: true, name: true } } },
  });
  return {
    // Blocked beats garbled: a Stupid Mute is silent, not babbling.
    block: blockerFor(rows, SPEAK),
    babbling: rows.some((ct) => ct.tag.slug === STUPID_SLUG),
  };
}

// What a silenced character is told. One sentence, naming the state, because
// a player refused without a reason files a GM ticket about it.
function speechRefusal(block) {
  return `You can't get the words out — you're ${block.name}. Here it is back: ‡`;
}

function lengthRefusal(length) {
  return (
    `That was ${length} characters, and a reposted message has to fit Discord's ${MESSAGE_LIMIT}. ` +
    "Nitro's higher limit is yours, not the bot's. Here it is back: ‡"
  );
}

// The two transforms a proxied message has always had. Stupid reads off the
// SPEAKER rather than off GameConfig and it wins over the autocorrect below —
// there is nothing left to capitalise once it has been through babble.
function transformSpeech(text, { babbling, autocorrect }) {
  const content = text ?? "";
  if (babbling) return babble(content);
  return autocorrect ? capitalizeSentences(fixContractions(content)) : content;
}

// Slowmode, for the web only. Discord enforces its own channel slowmode on a
// Discord-origin send, and running a second one here would refuse a message
// Discord had already let through.
async function slowmodeWaitSeconds(prisma, { characterId, placeKey }) {
  if (!characterId || !placeKey) return 0;
  const newest = await prisma.archiveEntry.findFirst({
    where: { placeKey, characterId, kind: "MESSAGE", deletedAt: null },
    orderBy: { seq: "desc" },
    select: { sentAt: true },
  });
  if (!newest?.sentAt) return 0;
  const waitMs = slowmodeMsFor(placeKey) - (Date.now() - newest.sentAt.getTime());
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
}

// Everything that decides whether these words are said, and in what form.
//
// Returns `{ ok: true, content, identity, placeKey, source, voice }` or
// `{ ok: false, refusal, retryAfter? }`. The refusal is a finished sentence:
// the Discord path DMs it back with the player's text, the web path returns
// it as `{ error }`.
//
// Gate order matters. The voice block comes before the length check so a
// silenced player is told they are silenced rather than told their essay was
// long, and both come before the transforms so nothing is spent on text that
// is not going anywhere.
async function prepareSpeech(prisma, { character, placeKey, content, source = "WEB" } = {}) {
  if (!character?.id) return { ok: false, refusal: "You have no living character. ‡" };

  const web = source !== "DISCORD";

  // Where. Discord's own channel permissions are the gate for a Discord-origin
  // send — the player could not have typed it otherwise — and re-deciding that
  // here would only mean refusing a message Discord already accepted. A web
  // send has no such gate in front of it, so this is the one it gets.
  // placesFor() is what decides, so the composer a player is looking at and
  // the gate behind it can never disagree. It also decides that a Location
  // channel is scenery rather than speech (CHANNELS.md §2), which is why this
  // refusal now has a second wording behind it.
  if (web && !(await mayWritePlace(prisma, character, placeKey))) {
    return { ok: false, refusal: "You can't speak there. ‡" };
  }

  const voice = await loadVoiceState(prisma, character.id);
  if (voice.block) return { ok: false, refusal: speechRefusal(voice.block), blocked: voice.block };

  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There was nothing in that to say. ‡" };
  if (raw.length > MESSAGE_LIMIT) return { ok: false, refusal: lengthRefusal(raw.length) };

  if (web) {
    const wait = await slowmodeWaitSeconds(prisma, { characterId: character.id, placeKey });
    if (wait > 0) {
      return { ok: false, refusal: `Wait ${wait}s before speaking again. ‡`, retryAfter: wait };
    }
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { tupperAutocorrectEnabled: true },
  });
  const text = transformSpeech(raw, {
    babbling: voice.babbling,
    autocorrect: Boolean(config?.tupperAutocorrectEnabled),
  });

  // Which name and face this goes out under: forced > concealed > own
  // (db/lib/presentedIdentity.js). Read off the character, never off the
  // caller — concealment is standing state and a caller's opinion of it would
  // be a second answer to a settled question.
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);
  const identity = presentedIdentity(character, { forcedName, concealment });

  return { ok: true, character, content: text, identity, placeKey: placeKey ?? null, source, voice };
}

// The write half. `prepared` is what prepareSpeech returned; everything else
// is the Discord context the caller has and this module does not.
async function recordSpeech(
  prisma,
  prepared,
  { discordMessageId = null, discordChannelId = null, zoneId = null, zoneName = null, channelKind = null, threadName = null, content = null } = {},
) {
  if (!prepared?.ok) return null;
  return recordArchiveMessage(prisma, {
    // A caller that appended something to the prepared text (the proxy adds
    // its attachment placeholders) hands the finished string back here.
    content: content ?? prepared.content,
    character: prepared.character,
    concealedAlias: prepared.identity?.alias ?? null,
    placeKey: prepared.placeKey,
    source: prepared.source,
    discordMessageId,
    discordChannelId,
    zoneId,
    zoneName,
    channelKind,
    threadName,
  });
}

// The web's order: decide, then write, and let the outbox put it on Discord.
async function sayInPlace(prisma, { character, placeKey, content, source = "WEB", ...context } = {}) {
  const prepared = await prepareSpeech(prisma, { character, placeKey, content, source });
  if (!prepared.ok) return prepared;
  const row = await recordSpeech(prisma, prepared, context);
  if (!row) return { ok: false, refusal: "That didn't get written down. Try again. ‡" };
  return { ok: true, row, prepared };
}

// ---- Edits and deletes -----------------------------------------------------
//
// The ROW is the source of truth for both, on both faces. A player pressing
// ✏️ in Discord and a player pressing ✎ on /play now do the same thing: they
// change the row and notify, and bot/src/lib/feedOutbox.js is the only thing
// that touches the Discord message. That is what retires the in-memory
// recentProxies map, and with it the restart amnesia that made an hour-old
// message inert to every reaction.

// A superset of archive.js#FEED_ROW_SELECT, so what comes back out of an edit
// is already the wire row the client replaces by seq — plus the three columns
// only the checks here need.
const EDITABLE_SELECT = {
  id: true,
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
  kind: true,
  discordMessageId: true,
};

function pastWindow(row) {
  return Date.now() - new Date(row.sentAt).getTime() > EDIT_WINDOW_MS;
}

const WINDOW_REFUSAL = "That was said more than five minutes ago and stands. ‡";
const GONE_REFUSAL = "That message is gone. ‡";
const NOT_YOURS_REFUSAL = "That isn't yours to change. ‡";

// Shared by both verbs: find the row, and answer whether this caller may
// touch it. `gm: true` skips the owner and window checks — a GM taking a line
// down is moderation, not a retraction, and phase 3's desk is the surface for
// it.
async function loadEditable(prisma, { characterId, seq, gm = false }) {
  if (seq === null || seq === undefined) return { ok: false, refusal: GONE_REFUSAL };
  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, refusal: GONE_REFUSAL };
  }

  const row = await prisma.archiveEntry.findUnique({ where: { seq: key }, select: EDITABLE_SELECT });
  if (!row || row.kind !== "MESSAGE" || row.deletedAt) return { ok: false, refusal: GONE_REFUSAL };
  if (gm) return { ok: true, row };
  if (!row.characterId || row.characterId !== characterId) return { ok: false, refusal: NOT_YOURS_REFUSAL };
  if (pastWindow(row)) return { ok: false, refusal: WINDOW_REFUSAL };
  return { ok: true, row };
}

// Re-run the transforms, because an edit is a fresh piece of writing: a
// player who went Stupid between saying it and fixing it babbles now.
async function editSpeech(prisma, { characterId, seq, content, gm = false } = {}) {
  const found = await loadEditable(prisma, { characterId, seq, gm });
  if (!found.ok) return found;
  const row = found.row;

  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There was nothing in that to say. ‡" };
  if (raw.length > MESSAGE_LIMIT) return { ok: false, refusal: lengthRefusal(raw.length) };

  const [voice, config] = await Promise.all([
    loadVoiceState(prisma, row.characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { tupperAutocorrectEnabled: true } }),
  ]);
  const text = transformSpeech(raw, {
    babbling: voice.babbling,
    autocorrect: Boolean(config?.tupperAutocorrectEnabled),
  });

  const updated = await prisma.archiveEntry.update({
    where: { id: row.id },
    data: { content: text, editedAt: new Date() },
    select: EDITABLE_SELECT,
  });

  if (updated.placeKey) {
    await notifyFeed(prisma, { seq: updated.seq, placeKey: updated.placeKey, op: "edit" });
  }
  return { ok: true, row: updated };
}

// Soft, everywhere. The row stays so a client holding it can reconcile, and
// so the outbox has something to read when it goes to delete the Discord
// message; /archive and /play both filter on deletedAt.
async function deleteSpeech(prisma, { characterId, seq, gm = false } = {}) {
  const found = await loadEditable(prisma, { characterId, seq, gm });
  if (!found.ok) return found;

  const updated = await prisma.archiveEntry.update({
    where: { id: found.row.id },
    data: { deletedAt: new Date() },
    select: EDITABLE_SELECT,
  });

  if (updated.placeKey) {
    await notifyFeed(prisma, { seq: updated.seq, placeKey: updated.placeKey, op: "delete" });
  }
  return { ok: true, row: updated };
}

module.exports = {
  MESSAGE_LIMIT,
  EDIT_WINDOW_MS,
  WINDOW_REFUSAL,
  loadVoiceState,
  speechRefusal,
  transformSpeech,
  prepareSpeech,
  recordSpeech,
  sayInPlace,
  editSpeech,
  deleteSpeech,
};
