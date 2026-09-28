// The relay for a room that opens onto several Locations (db/lib/roomSides.js,
// docs/systemdocs/CHAT.md "Rooms with more than one thread"). A Discord thread
// can only be read by somebody who can see its parent channel, so such a room
// has one thread under each side's Location, and every line said in the room
// has to appear in all of them. The feed is one place key; this is what keeps
// its threads in step.
//
// The outbox (feedOutbox.js) hears every archive row — web, Discord and the
// game's own scenery alike — and hands each room row here after its own work.
// One line, one ArchiveRelay row per OTHER thread: the row's own
// discordMessageId stays the copy where it was said (a web line's is the home
// thread's), and these are the rest, so an edit or a delete reaches every one.
//
// Scenery posters (roomLine, announceInRoom, whispers, shouts) post into the
// room's home thread only and leave the sides to this. That is the rule; a
// poster that wrote to every thread itself would be relayed on top.
//
// No loop: every copy goes out under a webhook or as the bot, and
// messageCreate drops both.

const { prisma } = require("@lifeweb/db");
const {
  postAsCharacter,
  postMessage,
  editMessage,
  deleteMessage,
  ensureChannelWebhook,
  editWebhookMessage,
  deleteWebhookMessage,
} = require("@lifeweb/db/lib/discordRest");
const { discordTargetsForPlaceKey, parsePlaceKey } = require("@lifeweb/db/lib/placeKey");
const { tokensToRoles } = require("@lifeweb/db/lib/characterMentions");
const { loadForcedName, loadConcealment } = require("@lifeweb/db/lib/presentedIdentity");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { discordTextFor } = require("@lifeweb/db/lib/skinless");

// A room's threads, remembered for a minute: nearly every room row is in a
// room with one thread, and this is asked for every one of them.
const TARGETS_TTL_MS = 60_000;
const targetsMemo = new Map();

async function roomTargets(placeKey) {
  const cached = targetsMemo.get(placeKey);
  if (cached && Date.now() - cached.at < TARGETS_TTL_MS) return cached.targets;
  const targets = await discordTargetsForPlaceKey(prisma, placeKey);
  targetsMemo.set(placeKey, { targets, at: Date.now() });
  return targets;
}

// Which threads a row is copied into — every thread of its room but the one it
// was said in — or [] when it is not a line to relay. Pure.
//
//   origin   a Discord line's own thread; the home thread for a web line (the
//            outbox's pushRow posts it there) and for the game's scenery (its
//            posters write to the home thread).
//   never    anything but a spoken or narrated MESSAGE, a row meant for one
//            reader or kept from one (Discord cannot show one reader a
//            different line), and a Discord line that never reached Discord
//            as a message of its own.
function relayPlan(row, targets) {
  if (!row || parsePlaceKey(row.placeKey)?.kind !== "room") return [];
  if (!Array.isArray(targets) || targets.length < 2) return [];
  if (row.kind && row.kind !== "MESSAGE") return [];
  if (row.onlyCharacterId || row.exceptCharacterId) return [];

  let origin = null;
  if (row.source === "DISCORD") {
    if (!row.characterId || !row.discordChannelId) return [];
    origin = row.discordChannelId;
  } else if (row.source === "WEB") {
    if (!row.characterId) return [];
    origin = targets.find((t) => t.home)?.threadId ?? null;
  } else if (row.source === "SYSTEM") {
    origin = targets.find((t) => t.home)?.threadId ?? null;
  } else {
    return [];
  }
  return targets.filter((t) => t.threadId && t.threadId !== origin);
}

function behind(stamp, syncedAt) {
  if (!stamp) return false;
  if (!syncedAt) return true;
  return new Date(stamp).getTime() > new Date(syncedAt).getTime();
}

// What the copy says: a character's line with its mention tokens as roles,
// the way pushRow writes it; scenery in the house subtext, the intercom full
// size (db/lib/ambientLine.js).
async function copyContent(row) {
  if (row.source === "SYSTEM") return row.channelKind === "intercom" ? row.content : ambientLine(row.content);
  const { content } = await tokensToRoles(prisma, row.content);
  // A Skinless's line is grunts in every thread (db/lib/skinless.js).
  return discordTextFor(prisma, { characterId: row.characterId, content, seq: row.seq });
}

async function postCopy(row, target, content) {
  if (row.source === "SYSTEM") {
    const posted = await postMessage(target.threadId, content);
    return posted?.id ?? null;
  }
  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return null;
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);
  const posted = await postAsCharacter(target.channelId, character, content, {
    forcedName,
    concealment,
    threadId: target.threadId,
    turnNumber: row.turnNumber ?? null,
    placeKey: row.placeKey,
  });
  return posted?.id ?? null;
}

async function editCopy(row, target, messageId, content) {
  if (row.source === "SYSTEM") return editMessage(target.threadId, messageId, content);
  const webhook = await ensureChannelWebhook(target.channelId);
  return editWebhookMessage(webhook, messageId, content, target.threadId);
}

async function deleteCopy(row, target, messageId) {
  if (row.source === "SYSTEM") return deleteMessage(target.threadId, messageId);
  const webhook = await ensureChannelWebhook(target.channelId);
  return deleteWebhookMessage(webhook, messageId, target.threadId);
}

// One row into every other thread of its room: posted once, then kept in step
// with the row's edits and its delete. Returns how many copies moved.
async function relayRow(row) {
  if (parsePlaceKey(row?.placeKey)?.kind !== "room") return 0;
  const plan = relayPlan(row, await roomTargets(row.placeKey));
  if (plan.length === 0) return 0;

  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { content: true, editedAt: true, deletedAt: true, relays: true },
  });
  if (!fresh) return 0;
  const current = { ...row, content: fresh.content };
  const byThread = new Map(fresh.relays.map((r) => [r.threadId, r]));

  let moved = 0;
  for (const target of plan) {
    const relay = byThread.get(target.threadId);
    try {
      if (fresh.deletedAt) {
        if (!relay?.discordMessageId || !behind(fresh.deletedAt, relay.syncedAt)) continue;
        await deleteCopy(current, target, relay.discordMessageId);
        await prisma.archiveRelay.update({ where: { id: relay.id }, data: { syncedAt: new Date() } });
        moved += 1;
        continue;
      }
      if (relay) {
        if (!relay.discordMessageId || !behind(fresh.editedAt, relay.syncedAt)) continue;
        await editCopy(current, target, relay.discordMessageId, await copyContent(current));
        await prisma.archiveRelay.update({ where: { id: relay.id }, data: { syncedAt: new Date() } });
        moved += 1;
        continue;
      }

      // Claim before posting, so a notification and the drain never post twice.
      let claim;
      try {
        claim = await prisma.archiveRelay.create({ data: { archiveEntryId: row.id, threadId: target.threadId } });
      } catch (err) {
        if (err?.code === "P2002") continue; // the other path has it
        throw err;
      }
      const messageId = await postCopy(current, target, await copyContent(current)).catch((err) => {
        console.error(`Room relay post failed (${row.id} -> ${target.threadId}):`, err.message ?? err);
        return null;
      });
      if (!messageId) {
        // Give the claim back so the next drain tries again.
        await prisma.archiveRelay.delete({ where: { id: claim.id } }).catch(() => {});
        continue;
      }
      await prisma.archiveRelay.update({
        where: { id: claim.id },
        data: { discordMessageId: messageId, syncedAt: new Date() },
      });
      moved += 1;
    } catch (err) {
      console.error(`Room relay failed (${row.id} -> ${target.threadId}):`, err.message ?? err);
    }
  }
  return moved;
}

// The place keys of every room that has more than one thread, for the drain.
async function crossRoomPlaceKeys() {
  const sides = await prisma.roomSide.findMany({
    where: { discordThreadId: { not: null } },
    distinct: ["roomId"],
    select: { roomId: true },
  });
  return sides.map((s) => `room:${s.roomId}`);
}

module.exports = { relayRow, relayPlan, crossRoomPlaceKeys };
