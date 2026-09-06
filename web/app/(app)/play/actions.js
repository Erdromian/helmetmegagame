"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { affordancesFor } from "@lifeweb/db/lib/placeAffordances";
import { toggleGate, holdKeyedOpen, GATE_CHARACTER_SELECT } from "@lifeweb/db/lib/gates";
import { fileMove } from "@lifeweb/db/lib/moves";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { examineLines } from "@lifeweb/db/lib/examineLocation";
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
import { sendDm } from "@/lib/discordGuild";

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
// db/lib/whosHere.js, db/lib/examineLocation.js, db/lib/locationTravel.js.
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

export async function examineHere() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  if (!me.character.locationId) return { ok: false, error: "You are nowhere yet. ‡" };
  const result = await examineLines(prisma, me.character.locationId);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, name: result.name, lines: result.lines };
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

export async function openConversation({ roomId, name } = {}) {
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
    if (me.character.discordUserId) await addThreadMember(thread.id, me.character.discordUserId);
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
  return {
    ok: true,
    line: result.laborRate
      ? `Filed. You work the day at ${result.laborRate.expression}. ‡`
      : "Filed. The GMs have it. ‡",
  };
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
