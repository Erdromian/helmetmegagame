"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { affordancesFor } from "@lifeweb/db/lib/placeAffordances";
import { toggleGate, holdKeyedOpen, GATE_CHARACTER_SELECT } from "@lifeweb/db/lib/gates";
import { fileMove, editMove, filedByPlayer, kindChangeUsed } from "@lifeweb/db/lib/moves";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { confirmMove } from "@lifeweb/db/lib/moveConfirm";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { loadDesireView } from "@/lib/selfPools";
import { whosHere, resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { travelOptions } from "@lifeweb/db/lib/locationGraph";
import {
  performLocationMove,
  turnBack,
  dragCandidates,
  freeMovesLeft,
  freeZoneMovesReason,
  CHARACTER_SELECT as MOVER_SELECT,
} from "@lifeweb/db/lib/locationTravel";
import { accessibleRooms, roomAccessKeys, syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { formatStashLine } from "@lifeweb/db/lib/roomStash";
import { BOARD_OPTION_LIMIT, boardText, hasNoticeboard, pinnedLine, tornLine } from "@lifeweb/db/lib/noticeboard";
import { paperDescription } from "@lifeweb/db/lib/paper";
import { readBlock } from "@lifeweb/db/lib/reading";
import { addToStack, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { expiryFrom } from "@lifeweb/db/lib/turnFormat";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { sceneLineAt } from "@lifeweb/db/lib/scene";
import { postMessage, startPrivateThread, addThreadMember } from "@lifeweb/db/lib/discordRest";
import { addConversationMember } from "@lifeweb/db/lib/conversations";
import { BELL_ROOM_SLUG, RING_WORD, bellWordMatches, bellCooldown, broadcastBell } from "@lifeweb/db/lib/bell";
import {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  gatehouseTurretArmed,
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
} from "@lifeweb/db/lib/gatehouseTurret";
import { INTERCOM_ROOM_SLUG, broadcastIntercom } from "@lifeweb/db/lib/intercom";
import { loadVoiceState } from "@lifeweb/db/lib/say";
import { recordArchiveMessage } from "@lifeweb/db/lib/archive";
import { acceptLesson, declineOffer } from "@lifeweb/db/lib/lessons";
import { acceptBind } from "@lifeweb/db/lib/bind";
import { acceptConfession } from "@lifeweb/db/lib/confession";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { acceptThreatSpawn, declineThreatSpawn, applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { declineAssignment } from "@lifeweb/db/lib/lobby";
import { mayReadPlace } from "@lifeweb/db/lib/feedAccess";
import { EXAMINE_SUBJECT_SELECT, examineReadout } from "@lifeweb/db/lib/examine";
import { BLIND_SLUG } from "@lifeweb/db/lib/examineVision";
import { getMyFactionRole } from "@lifeweb/db/lib/factionPermissions";
import { photoCaption } from "@lifeweb/db/lib/photo";
import { CAMERA_SLUG, mintPhoto } from "@lifeweb/db/lib/photoMint";
import { sendDm } from "@/lib/discordGuild";
import { examineCharacter } from "@/app/(app)/character/examineActions";

// Every button in the Hall's right column, as a server action.
//
// THE CONTRACT, and it is the same one for all of them: the acting character
// is resolved from the session, never from anything posted; every gate the
// panel drew is re-checked here, because a disabled button is a hint and not
// a lock; the answer is `{ ok: true, … }` or `{ ok: false, error }`, and
// nothing throws out to the client (web/app/components/useActionRunner.js
// turns a transport failure into a sentence, and a thrown one into the wrong
// sentence).
//
// The GAME logic lives in db/lib, so the Discord button and the web dialog
// run one implementation: db/lib/gates.js, db/lib/moves.js,
// db/lib/whosHere.js, db/lib/examine.js, db/lib/locationTravel.js.
// What is written out below is the sequencing each face needs and nothing
// else.

// The acting character, from the session. `select` widens it for whichever
// action needs more; the default is what almost all of them need.
async function actor(select) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in. ‡" };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: select ?? {
      id: true,
      name: true,
      zoneId: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // "Play from the web" — nothing here may touch Discord for them
      // (docs/systemdocs/HALL.md §6).
      webOnly: true,
      // `role` and the tag slugs are what canToggleGate reads, and
      // affordancesFor asks it for every gate this character is standing at.
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!character) return { error: "You have no living character. ‡" };
  return { character, discordUserId: session.discordUserId };
}

// Standing in the room is the whole permission model for everything a Room
// button does — you cannot pull a bell rope from three zones away.
async function roomHere(character, roomId, slug, missing) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || (slug && room.slug !== slug)) return { error: missing };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more. ‡` };
  }
  return { room };
}

// ---------------------------------------------------------------- the place

// The whole place panel, re-read. The page renders the first copy; this is
// what a dialog calls after it changed something a button's label depends on
// (a gate that is now shut, a door now being held).
export async function loadAffordances() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, affordances: await affordancesFor(prisma, me.character) };
}

export async function loadPeopleHere() {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const rows = await whosHere(prisma, me.character);
  return { ok: true, ...rows };
}

// Looking at somebody whose face you cannot see. The token is what
// db/lib/whosHere.js handed the page for a hood — an HMAC of the character id,
// so the browser is never told who is under it — and it is resolved here
// against the people actually standing at the looker's own Location. The
// readout itself is the sheet's own examineCharacter(), which re-resolves the
// looker from the session and re-checks co-presence a second time.
export async function examineHooded(token) {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const targetId = await resolveHoodToken(prisma, me.character, token);
  if (!targetId) return { ok: false, error: "They aren't here any more. ‡" };
  return examineCharacter(targetId);
}

// Photographing what somebody said — the web twin of the 📸 reaction
// (bot/src/events/messageReactionAdd.js#handleCameraReaction). The row is the
// only thing the browser sends; who spoke, whether they were hooded and
// whether this reader may see the place are all resolved here.
//
// The camera is NOT spent: holding one is the whole gate, and film is not a
// system anybody asked for. What bounds it instead is one shot per line per
// photographer — otherwise a reader could mint unbounded Tag rows off one
// message, and every one of those is a permanent catalog row. The bot keeps
// that bound in memory, which a restart empties and which the web process
// could never share, so this one is a row in AuditLog. It is the same shot
// either way, so the two faces refusing separately costs a player nothing.
//
// No `turnId`: that column is for the per-turn rations that count these rows
// (REQUESTS.md §1a), and this ration is per LINE rather than per turn.
const PHOTO_ACTION = "photo_taken";

export async function photographRow(seq) {
  const me = await actor({
    id: true,
    factionId: true,
    locationId: true,
    discordUserId: true,
    tags: { select: { quantity: true, tag: { select: { slug: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const holds = (slug) => character.tags.some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 0) > 0);

  // Framing a shot is something you do by eye. Gated exactly as 🔍 and 📸
  // are, and with the bot's own sentence.
  if (holds(BLIND_SLUG)) {
    return { ok: false, error: "You can't see. ‡" };
  }
  if (!holds(CAMERA_SLUG)) return { ok: false, error: "You have no camera. ‡" };

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone. ‡" };
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: { seq: true, kind: true, placeKey: true, characterId: true, concealedAlias: true, deletedAt: true },
  });
  if (!row || row.kind !== "MESSAGE" || row.deletedAt || !row.characterId) {
    return { ok: false, error: "That line is gone. ‡" };
  }
  if (row.characterId === character.id) return { ok: false, error: "Point it at somebody else. ‡" };

  // The same gate the feed itself reads by (db/lib/feedAccess.js). A seq is a
  // guessable number, so this is what stops one being pointed at a room the
  // reader is standing outside of.
  const allowed =
    Boolean(row.placeKey) &&
    (await mayReadPlace(prisma, character, row.placeKey, { gm: false, discordUserId: me.discordUserId }));
  if (!allowed) return { ok: false, error: "That line is gone. ‡" };

  // One shot per line per photographer, read off the INDEXED columns.
  // AuditLog has (actorDiscordUserId, actionType, turnId) and (actionType);
  // it has no index over `details`, so a `path: ["seq"]` filter was a scan of
  // the whole table on a button anybody can press. The seq is checked in JS
  // over this photographer's own prints, which is a handful of rows.
  const mine = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: me.discordUserId, actionType: PHOTO_ACTION },
    select: { details: true },
  });
  const wanted = String(row.seq);
  if (mine.some((entry) => String(entry.details?.seq ?? "") === wanted)) {
    return { ok: false, error: "You already have that shot. ‡" };
  }

  const subject = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: EXAMINE_SUBJECT_SELECT,
  });
  if (!subject) return { ok: false, error: "That line is gone. ‡" };

  // The hood the ROOM SAW, which outlives the hood they are wearing now: a
  // print filed under a real name nobody present ever heard would be a
  // permanent unmasking of somebody who spoke masked.
  const hooded = row.concealedAlias != null;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  // A Leader/Treasurer of the subject's own faction reads their ⬢, the same
  // seat the readout gives 🔍. Nothing else of the viewer's sight survives —
  // `viewerTags: []` and an empty `satisfied` are what "a lens has no medical
  // training" means, and without them a surgeon's photograph would launder
  // their diagnosis into whoever they handed the print to.
  const officer =
    !hooded && subject.factionId
      ? (await getMyFactionRole(prisma, me.discordUserId, subject.factionId)).isOfficer
      : false;

  const readout = examineReadout({
    subject: hooded ? { ...subject, concealed: true } : subject,
    viewerTags: [],
    satisfied: new Set(),
    openTurnNumber: openTurn?.number,
    lastDesire: null,
    viewerFactionId: character.factionId ?? null,
    viewerIsOfficer: officer,
    wasConcealedAs: hooded ? row.concealedAlias : null,
  });

  // No transaction: nothing is spent, so there is nothing that has to be
  // atomic with the print — and mintPhoto's collision retry cannot run inside
  // one (db/lib/photoMint.js#createWithRetry).
  const photo = await mintPhoto(prisma, character.id, {
    subject: readout.name,
    caption: photoCaption(readout),
  });

  // Written only once the print exists, so a failed mint leaves the shot
  // there to try again rather than burning it.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: me.discordUserId,
      actionType: PHOTO_ACTION,
      targetCharacterId: row.characterId,
      details: { seq: String(row.seq), placeKey: row.placeKey, hooded, photoTagId: photo.id, photoName: photo.name },
    },
  });

  return {
    ok: true,
    readout,
    photoName: photo.name,
    line: `You take a photograph of ${readout.name}. ‡`,
  };
}

// What is lying in a room's stash, in Bascinet's own format. The Transfer
// dialog is what MOVES any of it; this only reads.
export async function readStash(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const rooms = await prisma.room.findMany({
    where: { locationId: me.character.locationId ?? "" },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      resources: true,
      tags: { where: { quantity: { gt: 0 } }, select: { quantity: true, tag: { select: { name: true } } } },
    },
  });
  const keys = await roomAccessKeys(prisma, me.character.id);
  // A room you cannot get into is a locked door, not an empty one.
  const room = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds).find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "You can't get in there. ‡" };
  return { ok: true, name: room.name, line: formatStashLine(room) };
}

// ---------------------------------------------------------------- travelling

export async function loadTravel() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;
  if (!character.locationId) return { ok: false, error: "You are nowhere yet. ‡" };

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const heading = character.travelToLocationId
    ? await prisma.location.findUnique({ where: { id: character.travelToLocationId }, select: { name: true } })
    : null;

  const [options, drag] = await Promise.all([
    travelOptions(prisma, character, character.locationId),
    dragCandidates(prisma, character),
  ]);

  return {
    ok: true,
    // Already walking? A paid crossing is a day on the road, and the only
    // thing on offer is turning round.
    heading: heading?.name ?? null,
    freeLeft: freeMovesLeft(character, config, openTurn),
    freeReason: freeZoneMovesReason(character),
    options: options.map((row) => ({
      id: row.location.id,
      name: row.location.name,
      zoneName: row.location.zone?.name ?? null,
      crossesZone: row.crossesZone,
      passable: row.passable,
      reason: row.reason ?? null,
    })),
    drag: drag.map((t) => ({ id: t.id, name: t.name, reason: t.reason ?? null })),
  };
}

export async function travelTo({ locationId, draggedIds = [] } = {}) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };

  const target = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!target) return { ok: false, error: "That place no longer exists. ‡" };

  // Re-resolved from the DB rather than trusted off the form: the picker's
  // list is a hint, and canDrag is the lock.
  const candidates = await dragCandidates(prisma, me.character);
  const dragged = candidates.filter((c) => draggedIds.includes(c.id));

  const result = await performLocationMove(prisma, me.character, target, { dragged });
  if (!result.ok) return { ok: false, error: result.reason };

  // A paid crossing is a day on the road: nobody has moved yet, so there are
  // no roles to swap — db/lib/travelArrivalPass.js does all of it at the next
  // turn advance (MAP.md §3). The one thing owed now is a word to the
  // passengers, who did not press anything.
  if (result.deferred) {
    for (const entry of result.travelers) {
      if (entry.character.id === me.character.id) continue;
      if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
      await sendDm(
        entry.character.discordUserId,
        `*${me.character.name} is taking you to ${target.name}. You'll get there next turn.* ‡`,
      ).catch(() => {});
    }
    return { ok: true, line: `You set out for ${target.name}. You arrive next turn, and your Move is spent. ‡` };
  }

  // Sequential on purpose: each entry is a handful of REST calls, and firing
  // a whole dragged party's worth at once is the shape that trips the
  // invalid-response breaker (db/lib/discordRest.js).
  for (const entry of result.moved) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: entry.character.id,
      fromLocationId: entry.fromLocationId,
      toLocationId: entry.toLocationId,
    }).catch(() => {});
  }
  // The Caving Die's "on arrival" trigger (CAVING.md), and the word owed to
  // anybody who was carried off without pressing anything.
  for (const entry of result.moved) {
    if (entry.cavingDm) await sendDm(entry.cavingDm.discordUserId, entry.cavingDm.content).catch(() => {});
  }
  const brought = [];
  for (const entry of result.moved) {
    if (entry.character.id === me.character.id) continue;
    brought.push(entry.character.name);
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      entry.character.discordUserId,
      `*${me.character.name} brought you along to ${target.name}.* ‡`,
    ).catch(() => {});
  }

  const parts = [`Moved to ${target.name}.`];
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (brought.length > 0) parts.push(`Bringing ${brought.join(", ")}.`);
  return { ok: true, line: `${parts.join(" ")} ‡` };
}

export async function turnBackTravel() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const result = await turnBack(prisma, me.character);
  return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.error };
}

// ------------------------------------------------------------------- gates

export async function flipGate(linkId) {
  const me = await actor(GATE_CHARACTER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const result = await toggleGate(prisma, {
    character: me.character,
    linkId,
    actorDiscordUserId: me.discordUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  // Redrawing the Discord anchor and the watchtower's starter is a
  // Discord-only follow-up and stays with the bot, which owns those messages
  // — the gate itself is already flipped either way, so nothing here waits
  // on it. The bot redraws on its own click and on the next channel doctor
  // pass.
  return { ok: true, line: result.line };
}

export async function holdKeyed(linkId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await holdKeyedOpen(prisma, { discordUserId: me.discordUserId, linkId, hold: true });
  return result.ok ? { ok: true, line: result.line, note: result.note } : { ok: false, error: result.error };
}

// ------------------------------------------------------------- noticeboard

// A paper's whole Tag row, because paperDescription and readBlock both need
// it — a `select` beside a nested `include` is not a shape Prisma accepts.
const BOARD_ACTOR_SELECT = {
  id: true,
  name: true,
  locationId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: true } },
};

async function boardHere(character) {
  const location = await prisma.location.findUnique({
    where: { id: character.locationId ?? "" },
    select: { id: true, name: true, indoors: true, attributes: true, discordChannelId: true },
  });
  if (!location) return { error: "That place is gone. ‡" };
  if (!hasNoticeboard(location)) return { error: "There's no board here. ‡" };
  const [openTurn, posts] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
    prisma.noticePost.findMany({
      where: { locationId: location.id },
      orderBy: { expiresTurn: "asc" },
      take: BOARD_OPTION_LIMIT,
      include: { tag: true },
    }),
  ]);
  return { location, openTurn, posts };
}

export async function readBoard() {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };

  // Written or sealed, and never gated on whether they can read it: pinning
  // up a letter you cannot read yourself is a perfectly good thing to do.
  const holding = me.character.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .slice(0, BOARD_OPTION_LIMIT)
    .map((ct) => ({ tagId: ct.tagId, name: ct.tag.name, sealed: ct.tag.paperKind === "SEALED" }));

  return {
    ok: true,
    heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
    notices: ctx.posts.map((p) => ({ id: p.id, name: p.tag.name })),
    holding,
  };
}

export async function readNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone. ‡" };

  const where = { phase: ctx.openTurn?.phase ?? null, indoors: ctx.location.indoors ?? true };
  // The same predicate the tag chip uses, and the same sentence — a blind
  // reader and an illiterate one get identical refusals, so neither the
  // reader nor anyone watching learns which it was.
  const text = paperDescription(post.tag, { tags: me.character.tags, ...where });
  const blocked = Boolean(readBlock(me.character.tags, where)) || post.tag.paperKind === "SEALED";
  // Nobody is told it was read.
  return { ok: true, name: post.tag.name, text, plain: blocked };
}

export async function tearNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone. ‡" };

  // The delete IS the claim, so two people tearing at the same paper cannot
  // both walk away with it.
  const claimed = await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) return { ok: false, error: "Somebody got there first. ‡" };
  await addToStack(prisma, me.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    // Catch-logged: an unreachable channel must never undo a tear that has
    // already committed (ARCHITECTURE.md §5).
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  // The same row the bot's board writes (db/lib/scene.js) — a tear on the web
  // and a tear on Discord are one event, and the Hall shows both.
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) });
  return { ok: true, line: `You take ${post.tag.name} down. ‡` };
}

export async function pinNotice(tagId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!ctx.openTurn) return { ok: false, error: "Nothing is happening yet. ‡" };

  const held = me.character.tags.find((ct) => ct.tagId === tagId);
  // "Has a paperKind" is not the check: a spent envelope and a bound book
  // both have one, and neither goes up on a wall.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return { ok: false, error: "You aren't holding that. ‡" };
  }

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { noticeExpiryTurns: true } });
  // N turns means N turns, counting the one it went up in.
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: a paper is on a board or in somebody's
      // hands, never both. Creating first means a paper already pinned
      // somewhere else fails here rather than being silently taken off a
      // sheet and lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: me.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, me.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere. ‡" };
    return { ok: false, error: "That didn't go up. ‡" };
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name) });
  return { ok: true, line: `You nail ${held.tag.name} up. Anyone here can read it, or take it down. ‡` };
}

// ------------------------------------------------------------- conversation

export async function converseRooms() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: me.character.locationId ?? "", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, me.character.id),
  ]);
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);
  return { ok: true, rooms: open.map((r) => ({ id: r.id, name: r.name, private: r.kind === "PRIVATE" })) };
}

export async function openConversation({ roomId, name, inviteIds = [] } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };

  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name. ‡" };

  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { location: true } });
  if (!room) return { ok: false, error: "That room no longer exists. ‡" };
  if (me.character.locationId !== room.locationId) {
    return { ok: false, error: `You're not in ${room.location.name} any more. ‡` };
  }
  if (!room.location.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM. ‡" };
  }
  // The same locked-door rule the Discord picker applies.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there. ‡" };
  }

  // The thread hangs off the LOCATION channel, not the room thread: Discord
  // has no threads inside threads. The room is the link the whisper poll
  // reads, nothing more.
  let thread;
  try {
    thread = await startPrivateThread(room.location.discordChannelId, trimmed);
    // A "web only" creator stays out of their own thread's member list
    // (docs/systemdocs/HALL.md §6); the membership row below is the truth.
    if (me.character.discordUserId && !me.character.webOnly) {
      await addThreadMember(thread.id, me.character.discordUserId);
    }
  } catch {
    return { ok: false, error: "Couldn't open that — try again, or tell a GM. ‡" };
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const conversation = await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name: trimmed,
      locationId: room.locationId,
      roomId: room.id,
      creatorCharacterId: me.character.id,
      creatorDiscordUserId: me.character.discordUserId,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  // The creator is a member like anybody else — the thread add above is only
  // Discord's copy of that fact (db/lib/conversations.js).
  await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: me.character.id });

  // Anybody the dialog was opened ON. Converse hangs off a person's row, so
  // the person whose row it was is ticked when it opens — and this is where
  // that tick becomes a membership row. The ids the browser sent are never
  // trusted: only somebody ALIVE and standing at this same Location is added,
  // which is the same co-presence rule every other people action here uses.
  const wanted = [...new Set((Array.isArray(inviteIds) ? inviteIds : []).map(String))].filter(
    (id) => id && id !== me.character.id,
  );
  if (wanted.length > 0) {
    const guests = await prisma.character.findMany({
      where: { id: { in: wanted }, status: "ALIVE", locationId: room.locationId },
      select: { id: true, discordUserId: true, webOnly: true },
    });
    for (const guest of guests) {
      // The ROW first, then the account: membership is a database fact and
      // Discord is its projection, so a failed thread add never decides
      // whether the conversation is in somebody's places.
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: guest.id });
      if (guest.discordUserId && !guest.webOnly) {
        await addThreadMember(thread.id, guest.discordUserId).catch(() => {});
      }
    }
  }
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: me.character.id,
        details: { threadId: thread.id, name: trimmed, room: room.name, location: room.location.name },
      },
    })
    .catch(() => {});

  return { ok: true, line: "Opened. It is in your places now. ‡" };
}

// ------------------------------------------------------- bell, PA, the gun

export async function ringBell({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BELL_ROOM_SLUG, "There's no bell here. ‡");
  if (found.error) return { ok: false, error: found.error };
  if (!bellWordMatches(word)) return { ok: false, error: `Type ${RING_WORD} to pull the rope. ‡` };

  // Read AFTER the word, so an abandoned dialog never reports a wait it was
  // not going to trigger anyway.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    // Minutes, not raw seconds: at a half-hour cooldown "1487s" is arithmetic
    // homework rather than an answer.
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    return {
      ok: false,
      error: `The bell is still humming from the last pull. About ${minutes} more minute${minutes === 1 ? "" : "s"}. ‡`,
    };
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });
  const { sent, failed } = await broadcastBell(prisma);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "bell_rung",
        targetCharacterId: me.character.id,
        details: { characterName: me.character.name, sent, failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: failed.length
      ? `You haul on the rope. It carries to ${sent} place${sent === 1 ? "" : "s"}, and not to ${failed.join(", ")}. ‡`
      : "You haul on the rope, and the whole barony hears it. ‡",
  };
}

export async function turretState(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There's no button here. ‡");
  if (found.error) return { ok: false, error: found.error };
  const armed = await gatehouseTurretArmed(prisma);
  return { ok: true, armed, word: armed ? DISARM_WORD : ARM_WORD };
}

export async function toggleTurret({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There's no button here. ‡");
  if (found.error) return { ok: false, error: found.error };

  // Re-read rather than trusting what the dialog was drawn against — two
  // people in the office can open it in the same moment, and the word they
  // were asked to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(word, armed)) {
    return { ok: false, error: `Type ${armed ? DISARM_WORD : ARM_WORD} to confirm. ‡` };
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  // The yard hears it, and that is the only warning anybody in it gets. Best
  // effort — the switch is thrown either way.
  const gatehouse = await prisma.location
    .findUnique({ where: { slug: GATEHOUSE_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(() => {});
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: me.character.id, characterName: me.character.name },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: next
      ? "The button clicks down. Somewhere below, the rotor comes alive. ‡"
      : "The button clicks up, and the yard goes quiet. ‡",
  };
}

export async function speakOnIntercom({ roomId, body } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, INTERCOM_ROOM_SLUG, "There's no intercom here. ‡");
  if (found.error) return { ok: false, error: found.error };

  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "Say something first. ‡" };

  const voice = await loadVoiceState(prisma, me.character.id);
  if (voice.block) return { ok: false, error: `You can't get the words out — you're ${voice.block.name}. ‡` };

  const { sent, failed } = await broadcastIntercom(prisma, text);

  // The transcript. One row for the broadcast, not one per zone — it was one
  // thing said, heard in several places. The speaker IS recorded even though
  // the channel line names nobody.
  await recordArchiveMessage(prisma, { character: me.character, content: text, channelKind: "intercom" }).catch(
    () => {},
  );
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "intercom_broadcast",
        targetCharacterId: me.character.id,
        details: { body: text, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: "Your voice goes out across Ravenheart. ‡",
    note: failed.length > 0 ? `Nothing came through in ${failed.join(", ")}. ‡` : null,
  };
}

// --------------------------------------------------------------------- you

export async function submitMove({ moveKind, description } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await fileMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    moveKind,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Filing is only half of it. The bot's modal
  // (bot/src/events/interactionCreate.js#handleMoveSubmit) confirms straight
  // after, and a Move that is never confirmed stays PENDING_TYPE: the staged
  // push (db/lib/stagedPush.js) skips it, the GM desk never lists it, and
  // re-filing is blocked — the player loses the turn and is told nothing.
  // Same call, same order, same arguments.
  const loaded = await prisma.action.findUnique({
    where: { id: result.action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  const { roll } = await confirmMove(prisma, loaded, me.discordUserId, { laborRate: result.laborRate });

  // The bot answers in Discord markdown; this panel prints plain text, so the
  // same facts are said in words. The Gambit roll itself stays hidden until
  // the turn-end reveal, exactly as it does in Discord.
  const parts = ["Filed and locked in. ‡"];
  if (roll.gambit) parts.push("The die is cast — you'll see how it fell when the turn ends. ‡");
  if (roll.resourceValue != null) {
    parts.push(`Your day's work (${roll.expression}) came to ${roll.resourceValue > 0 ? "+" : ""}${roll.resourceValue} ⬢. ‡`);
    if (roll.bonusNote) parts.push(roll.bonusNote);
  }
  return { ok: true, line: parts.join(" ") };
}

// The turn card's own state, re-read: which turn is open, whether the Move
// window has shut, and the Move this character has already filed into it.
// Polled beside waitingOnYou, so a Move filed from Discord shows up here
// without a reload.
//
// `editable` is the same predicate db/lib/moves.js#editMove re-checks — a
// hint for whether to draw the button, never the lock.
export async function myMove() {
  const me = await actor({
    id: true,
    discordUserId: true,
    tags: { select: { tag: { select: { slug: true, name: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true, startedAt: true },
  });
  if (!openTurn) return { ok: true, turn: null, move: null };

  const [frozen, action] = await Promise.all([
    clockFrozen(prisma),
    prisma.action.findFirst({
      where: { characterId: me.character.id, turnId: openTurn.id },
      select: {
        id: true,
        moveKind: true,
        description: true,
        status: true,
        moveReviewStatus: true,
        lockExpiresAt: true,
        appliedEffects: true,
        // The `auto:` marker that says a lesson, a confession, the auto-labor
        // pass or a travel stub wrote this row rather than the player
        // (db/lib/moves.js#filedByPlayer). Without it the Edit button is
        // offered on a Move nobody filed.
        gmNotes: true,
      },
    }),
  ]);
  const { cutoffAt, locked, hasLock } = moveWindow(openTurn, { clockFrozen: frozen });

  // The same gate editMove runs (db/lib/incapacitation.js): a Bound or Dying
  // character cannot change a Move any more than they could file one, so the
  // button is not drawn rather than drawn and refused.
  const stuck = blockerFor(me.character.tags ?? [], ACT);

  // Whether the one kind change a turn has already been spent. The dialog
  // disables the chips with it; db/lib/moves.js#editMove is the lock.
  const kindLocked = action && !stuck ? await kindChangeUsed(prisma, me.character.id, openTurn.id) : false;

  return {
    ok: true,
    turn: {
      number: openTurn.number,
      phase: openTurn.phase,
      // ISO, because a Date does not survive the trip to a client component
      // intact and the countdown ticks in the browser anyway. It is the
      // CUTOFF, not the turn's end — Moves stop three hours early
      // (db/lib/turnClock.js), and counting to the end named a time nothing
      // happens at.
      closesAt: hasLock && cutoffAt ? cutoffAt.toISOString() : null,
      locked,
      hasLock,
    },
    move: action
      ? {
          id: action.id,
          kind: action.moveKind,
          description: action.description,
          editable: !stuck && moveIsEditable(action, locked),
          // Said in the dialog and in place of the button, so a refusal is
          // never the first the player hears of it.
          blockedReason: stuck ? `You can't act right now — you're ${stuck.name}. ‡` : null,
          kindLocked,
        }
      : null,
  };
}

// Kept beside myMove rather than exported: the page's first paint runs the
// same test on the row it loaded itself (web/app/(app)/play/page.js).
function moveIsEditable(action, locked) {
  if (locked) return false;
  // A row the game wrote for them — a lesson, a confession, an auto-Labor, a
  // walk — is not theirs to change (db/lib/moves.js#filedByPlayer).
  if (!filedByPlayer(action)) return false;
  if (!["PENDING_TYPE", "CONFIRMED"].includes(action.status)) return false;
  if (!["OPEN", "PASSED"].includes(action.moveReviewStatus)) return false;
  if (action.lockExpiresAt && new Date(action.lockExpiresAt).getTime() > Date.now()) return false;
  return action.appliedEffects == null;
}

// Changing a Move already filed. The one-Move-a-turn row IS the turn, so
// there is nothing to cancel and re-file — db/lib/moves.js#editMove edits it
// in place, and re-rolls only when the KIND changed (never a second die for
// a Gambit that already has one).
export async function updateMove({ actionId, moveKind, description } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await editMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    actionId,
    moveKind,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const parts = ["Changed. The GMs have it. ‡"];
  const roll = result.roll;
  if (roll?.gambit) parts.push("The die is cast — you'll see how it fell when the turn ends. ‡");
  if (roll?.resourceValue != null) {
    parts.push(`Your day's work (${roll.expression}) came to ${roll.resourceValue > 0 ? "+" : ""}${roll.resourceValue} ⬢. ‡`);
    if (roll.bonusNote) parts.push(roll.bonusNote);
  }
  return { ok: true, line: parts.join(" ") };
}

// Yesterday: what the last closed turn said to this player. Every line of it
// is already in DirectMessage — the GM's staged messages (source
// "staged_push") and the bot's own Routine result and Gambit reveal (which
// go out with no source and default to "bot_auto", db/lib/dm.js). Both
// halves are needed, and both are narrowed to the window the close ran in so
// an ordinary GM reply from the middle of the day is not swept in.
//
// It reads and sends nothing.
const YESTERDAY_ROWS = 20;
// An hour, not ten minutes. A close with a hundred players in it sends its
// DMs at Discord's pace, and the tail of a long push landed outside a
// ten-minute window — so the last lines of the day were the ones a player
// could not read back.
const CLOSE_WINDOW_MS = 60 * 60 * 1000;

export async function yesterday() {
  const me = await actor({ id: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  const turn = await prisma.turn.findFirst({
    where: { status: "RESOLVED", resolvedAt: { not: null } },
    orderBy: { number: "desc" },
    select: { number: true, phase: true, resolvedAt: true, needsResolvedAt: true },
  });
  if (!turn) return { ok: true, turn: null, entries: [] };

  const from = turn.resolvedAt;
  const until = new Date(
    Math.max(new Date(turn.needsResolvedAt ?? turn.resolvedAt).getTime(), new Date(from).getTime()) + CLOSE_WINDOW_MS,
  );
  const rows = await prisma.directMessage.findMany({
    where: {
      discordUserId: me.discordUserId,
      direction: "OUTBOUND",
      source: { in: ["staged_push", "bot_auto"] },
      createdAt: { gte: from, lte: until },
    },
    // Newest first so the cap keeps the END of the close, not the start —
    // taking 20 ascending off a busy turn threw away the adjudication and
    // kept the boilerplate. Reversed below, because the block reads in order.
    orderBy: { createdAt: "desc" },
    take: YESTERDAY_ROWS,
    select: { id: true, content: true, createdAt: true },
  });

  return {
    ok: true,
    turn: { number: turn.number, phase: turn.phase },
    entries: rows
      .reverse()
      .map((row) => ({ id: row.id, content: row.content, at: row.createdAt.toISOString() })),
  };
}

// The Desire picker's catalog, ~271 templates evaluated against this
// character's gates. Fetched the first time the picker opens rather than on
// every page load — the slot half the column draws costs one query and comes
// down with the page (web/lib/selfPools.js).
export async function desireCatalogView() {
  const me = await actor({
    id: true,
    tags: { select: { tagId: true, tag: true } },
    role: { select: { slug: true } },
  });
  if (me.error) return { ok: false, error: me.error };
  const [openTurn, gameConfig] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { desiresEnabled: true, desireSlots: true, desireSlotLockTurns: true },
    }),
  ]);
  return { ok: true, view: await loadDesireView(me.character, { openTurn, gameConfig }) };
}

// "Report to the GMs" — the OOC ticket a web-only player loses with the
// report channel. It writes the same INBOUND DirectMessage row an actual DM
// to the bot writes (bot/src/events/messageCreate.js), so it lands in
// /gm/players' conversation like every other word from this player. It sends
// NOTHING to Discord: this is a message TO the GMs, and the reply comes back
// down the ordinary DM path.
export async function reportToGms(text) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Write something first. ‡" };
  if (body.length > 1800) return { ok: false, error: "That's too long to send. ‡" };

  await prisma.directMessage.create({
    data: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      content: `[Play] ${body}`,
    },
  });
  return { ok: true, line: "Sent. A GM will see it on their desk. ‡" };
}

// ------------------------------------------------------------ waiting on you

// Everything that is holding still until this player answers it: a lesson,
// a binding or a confession somebody offered; a threat seat; a letter the
// bird is still waiting on; a lobby assignment. Each row's Accept/Decline
// calls the SAME db/lib function the DM's buttons call, so an answer given
// here and an answer given in Discord are the same answer.
export async function waitingOnYou() {
  const me = await actor({ id: true, name: true, discordUserId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });

  const [offers, spawns, letters, lobbyEntry] = await Promise.all([
    openTurn
      ? prisma.offer.findMany({
          // Only what is MINE to answer. An offer I made is waiting on
          // somebody else, and listing it here would be a to-do I cannot do.
          where: { turnId: openTurn.id, status: "PENDING", responderId: me.character.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, kind: true, initiatorId: true, tag: { select: { name: true } } },
        })
      : [],
    prisma.threatSpawn.findMany({
      where: { discordUserId: me.discordUserId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, threatSlug: true },
    }),
    prisma.birdMessage.findMany({
      where: { recipientId: me.character.id, delivered: true, repliedAt: null, replyDeadlineTurn: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderName: true, replyDeadlineTurn: true },
    }),
    prisma.lobbyEntry.findFirst({
      where: { discordUserId: me.discordUserId, status: "ASSIGNED" },
      select: { id: true, assignedRoleId: true },
    }),
  ]);

  const initiators = offers.length
    ? await prisma.character.findMany({
        where: { id: { in: offers.map((o) => o.initiatorId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(initiators.map((c) => [c.id, c.name]));

  const rows = [
    ...offers.map((o) => ({
      key: `offer:${o.id}`,
      id: o.id,
      kind: "offer",
      // A chaplain waiting on a confession is never told what it is about,
      // here or anywhere else.
      label:
        o.kind === "CONFESSION"
          ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks you to hear a confession. ‡`
          : o.kind === "BIND"
            ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks to bind you. ‡`
            : `${nameOf.get(o.initiatorId) ?? "Somebody"} offers ${o.tag?.name ?? "a lesson"}. ‡`,
      decline: true,
    })),
    ...spawns.map((s) => ({
      key: `spawn:${s.id}`,
      id: s.id,
      kind: "spawn",
      label: "A seat is open to you. ‡",
      decline: true,
    })),
    ...letters.map((l) => ({
      key: `bird:${l.id}`,
      id: l.id,
      kind: "bird",
      // No Accept here: answering a letter means choosing which paper goes
      // back, which is the Bird dialog on the sheet. This row is the
      // reminder that the bird has not left yet.
      label: `The bird still waits on an answer to ${l.senderName}. ‡`,
      accept: false,
      decline: false,
      href: "/character",
    })),
    ...(lobbyEntry
      ? [
          {
            key: `lobby:${lobbyEntry.id}`,
            id: lobbyEntry.id,
            kind: "lobby",
            label: "You have a seat waiting to be taken up. ‡",
            accept: false,
            decline: true,
            href: "/character",
          },
        ]
      : []),
  ];

  return { ok: true, rows };
}

export async function answerWaiting({ kind, id, accept } = {}) {
  const me = await actor({ id: true, name: true, discordUserId: true, status: true });
  if (me.error) return { ok: false, error: me.error };

  if (kind === "offer") {
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return { ok: false, error: "That offer's gone. ‡" };
    // Matched to the OFFER's responder, never to a posted id.
    if (offer.responderId !== me.character.id) return { ok: false, error: "That's not yours to answer. ‡" };
    const responder = { id: me.character.id, name: me.character.name, discordUserId: me.discordUserId };

    const result = accept
      ? offer.kind === "BIND"
        ? await acceptBind(prisma, offer, responder)
        : offer.kind === "CONFESSION"
          ? await acceptConfession(prisma, offer, responder)
          : await acceptLesson(prisma, offer, responder)
      : await declineOffer(prisma, offer, responder);
    if (!result.ok) return { ok: false, error: result.reason };

    // The same post-commit sync the DM handler runs: a fresh Bound tag
    // changes what rooms the target may stand in, and what they can carry.
    if (result.boundId) {
      try {
        const drop = await settleCarry(prisma, result.boundId);
        const row = await prisma.character.findUnique({ where: { id: result.boundId } });
        if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
        if (drop) await deliverCarryDrop(prisma, drop).catch(() => {});
      } catch {
        // The bind stands either way; a failed sync is the doctor's problem.
      }
    }
    for (const dm of result.dms ?? []) {
      await sendDm(dm.discordUserId, dm.content).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "spawn") {
    const result = accept
      ? await acceptThreatSpawn(prisma, id, me.discordUserId)
      : await declineThreatSpawn(prisma, id, me.discordUserId);
    if (!result.ok) return { ok: false, error: result.reason };
    if (accept) {
      await applySpawnSideEffects(prisma, result.sideEffects).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "lobby") {
    const result = await declineAssignment(prisma, id, me.discordUserId);
    return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
  }

  return { ok: false, error: "There's nothing to answer there. ‡" };
}
