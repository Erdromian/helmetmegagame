// The telephone network. See docs/systemdocs/PHONES.md.
//
// A phone is a fixture on a Room's wall (Room.phone, authored in
// docs/zones.yaml). You lift the receiver, pick another phone off a list, and
// it rings there; somebody standing in that room answers, and for as long as
// both of you hold a receiver, what each of you says reaches the other room.
//
// THREE RULES DO MOST OF THE WORK HERE, and each is load-bearing:
//
//   1. One person holds a phone. Not "one call per character" — one call per
//      ROOM, enforced by the two partial unique indexes in the migration, not
//      by a read-then-write. That is what "The line is busy." actually means.
//   2. The call is a ROW, never a timer. Four rings over 60 seconds, and the
//      bot restarting inside that window is ordinary rather than fatal: the
//      sweep reads `ringsSent` and `startedAt` off the row and picks the call
//      back up mid-ring. Nothing here schedules anything.
//   3. A phone carries a VOICE, never a NAME. Every line the far room reads is
//      a SYSTEM row, so db/lib/presentedIdentity.js never comes into it and a
//      concealed caller stays concealed for free. See db/lib/phoneVoice.js.
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/depotCounter.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter and stays off the @lifeweb/db barrel (db/lib/dm.js); require by path.

const { sceneLineAt } = require("./scene");
const { postMessage } = require("./discordRest");
const { blockerFor, ACT } = require("./incapacitation");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { addToRoomStack, dropCharacterTag } = require("./tagWrites");
const { vaultAndCoin } = require("./bankAccounts");
const { characterParty, roomParty, turnStamp } = require("./economyLedger");
const { SFX } = require("./sfx");
const {
  PHONE_COST,
  PHONE_RINGS,
  PHONE_RING_INTERVAL_MS,
  PHONE_PAID_GRACE_MS,
  PHONE_TEXT,
} = require("./phoneText");

// The two statuses that mean a receiver is off its cradle somewhere. One list,
// because "busy" and "the sweep should look at this" are nearly the same
// question and answering them off two different lists is how they drift.
const LIVE = ["RINGING", "CONNECTED"];

// The columns any caller needs off a phone's Room. `phone` is the name, and
// the affordance's `when` reads it, so every query feeding a dial list or a
// starter post has to carry it.
const PHONE_ROOM = {
  id: true,
  slug: true,
  name: true,
  kind: true,
  phone: true,
  payphone: true,
  locationId: true,
  accessTagSlugs: true,
  discordThreadId: true,
};

function fail(error) {
  return { ok: false, error };
}

/**
 * Every phone that can be DIALLED, in authoring order. Payphones are absent on
 * purpose: a payphone calls out and never rings, because there is nobody whose
 * job is to stand next to it. This is the dropdown, and the whole of it.
 */
async function dialablePhones(prisma) {
  return prisma.room.findMany({
    where: { phone: { not: null }, payphone: false, retiredAt: null },
    select: PHONE_ROOM,
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }],
  });
}

/** The live call this room is on, at either end, or null. */
async function callInRoom(prisma, roomId) {
  if (!roomId) return null;
  return prisma.phoneCall.findFirst({
    where: { status: { in: LIVE }, OR: [{ fromRoomId: roomId }, { toRoomId: roomId }] },
    orderBy: { startedAt: "desc" },
  });
}

/** The live call this character is holding a receiver for, at either end, or null. */
async function callHeldBy(prisma, characterId) {
  if (!characterId) return null;
  return prisma.phoneCall.findFirst({
    where: { status: { in: LIVE }, OR: [{ callerId: characterId }, { calleeId: characterId }] },
    orderBy: { startedAt: "desc" },
  });
}

// Alive, able to act, standing in this room's Location, and able to get in.
// The gate stack is db/lib/slotMachine.js#slotActor's, for the same reason it
// gives: a web dialog and a Discord button both outlive somebody walking out
// of the room, so it is re-run on every press rather than trusted from before.
async function phoneActor(prisma, discordUserId, roomId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true, locationId: true, tags: { include: { tag: true } } },
  });
  if (!character) return fail("You don't have a living character.");

  const room = await prisma.room.findUnique({ where: { id: roomId }, select: PHONE_ROOM });
  if (!room || !room.phone) return fail(PHONE_TEXT.noPhone);
  if (character.locationId !== room.locationId) return fail(PHONE_TEXT.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(`You can't act — you're ${blocker.name}.`);

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail("You can't get in there.");
  }
  return { ok: true, character, room };
}

/**
 * What the dialog should draw, re-read on every open. The dialog is dynamic
 * (PHONES.md): the same button is Dial, Answer or Hang up depending on what
 * this phone is doing right now, and deciding that on the client would let two
 * tabs disagree.
 *
 * Resolves to { ok, mode, room, call, phones, paid } where `mode` is one of
 * "dial" | "answer" | "hangup" | "held".
 */
async function phoneView(prisma, discordUserId, roomId) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const call = await callInRoom(prisma, room.id);
  if (call) {
    const mine = call.callerId === character.id || call.calleeId === character.id;
    if (mine) return { ok: true, mode: "hangup", room, call, phones: [], character };
    // Ringing at a phone nobody has picked up: anybody in the room may answer.
    if (call.status === "RINGING" && call.toRoomId === room.id) {
      return { ok: true, mode: "answer", room, call, phones: [], character };
    }
    return { ok: true, mode: "held", room, call, phones: [], character };
  }

  const phones = (await dialablePhones(prisma)).filter((p) => p.id !== room.id);
  return { ok: true, mode: "dial", room, phones, call: null, character, paid: await alreadyPaid(prisma, character.id) };
}

// Whether this caller's coin is still in the slot. A payphone charges for
// LIFTING THE RECEIVER, so a call nobody answered lets them try somebody else
// without paying twice — see PHONE_PAID_GRACE_MS.
async function alreadyPaid(prisma, characterId) {
  const recent = await prisma.phoneCall.findFirst({
    where: {
      callerId: characterId,
      paid: true,
      status: "ENDED",
      endedReason: { in: ["noanswer", "busy"] },
      endedAt: { gte: new Date(Date.now() - PHONE_PAID_GRACE_MS) },
    },
    orderBy: { endedAt: "desc" },
    select: { id: true },
  });
  return Boolean(recent);
}

/**
 * Lift the receiver and dial. Resolves to { ok, call, sfx } or { ok: false, error }.
 * `turn` is the open Turn row, for the REQUESTS.md 1a stamp on the audit row.
 */
async function placeCall(prisma, discordUserId, { fromRoomId, toRoomId, turn = null } = {}) {
  const actor = await phoneActor(prisma, discordUserId, fromRoomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const target = await prisma.room.findUnique({ where: { id: toRoomId }, select: PHONE_ROOM });
  if (!target || !target.phone || target.payphone) return fail("That phone isn't on the exchange.");
  if (target.id === room.id) return fail("That's the phone you're holding.");

  // Both ends have to be free, and the near end being busy is a DIFFERENT
  // refusal from the far end being busy: one is somebody else's hand on your
  // receiver, the other is a line that is already carrying a conversation.
  if (await callInRoom(prisma, room.id)) return fail(PHONE_TEXT.held);
  if (await callInRoom(prisma, target.id)) return { ok: false, error: PHONE_TEXT.busy, sfx: SFX.PHONE_BUSY };

  const charge = room.payphone && !(await alreadyPaid(prisma, character.id));
  let call = null;

  try {
    call = await prisma.$transaction(async (tx) => {
      if (charge) await takePhoneCoin(tx, character, room, turn);
      return tx.phoneCall.create({
        data: {
          fromRoomId: room.id,
          toRoomId: target.id,
          callerId: character.id,
          status: "RINGING",
          // `charge`, not `room.payphone`: only the call that actually took a
          // coin carries the mark. Marking every payphone call paid would let a
          // chain of unanswered ones renew the grace window forever, and one
          // obol would buy unlimited dialling. This way the window is measured
          // from the call that really paid, so it expires.
          paid: charge,
          turnId: turn?.id ?? null,
        },
      });
    });
  } catch (err) {
    // The partial unique index is the real arbiter of "busy" — two people
    // dialling the same office in the same second both pass the check above
    // and exactly one of them writes. P2002 here is not an error, it is the
    // busy signal arriving by the only route that cannot race.
    if (err?.code === "P2002") return { ok: false, error: PHONE_TEXT.busy, sfx: SFX.PHONE_BUSY };
    return fail(err?.userMessage ?? "The line went dead. Try again.");
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "phone_call",
      targetCharacterId: character.id,
      roomId: room.id,
      turnId: turn?.id ?? null,
      details: { from: room.phone, to: target.phone, paid: charge, cost: charge ? PHONE_COST : 0 },
    },
  }).catch((err) => console.error("Phone audit failed:", err.message ?? err));

  await ringOnce(prisma, call, target);
  return { ok: true, call, sfx: charge ? SFX.COIN_INSERT : SFX.PHONE_CALLING };
}

// One obol out of a hand and into the Keep's Vault, which is what "the
// treasury" means here — db/lib/bankAccounts.js#takeFromVault calls it that in
// so many words. No bank account is credited: the Keep owns a payphone's take,
// and there is no seat whose claim it should swell. The coin is REAL and stays
// real, which is why the reason is a TRANSFER and not a SINK.
async function takePhoneCoin(tx, character, room, turn) {
  const { room: vault, coin } = await vaultAndCoin(tx);
  if (!coin) {
    const err = new Error("The obol isn't in the catalog yet. A GM needs to run the tag sync.");
    err.userMessage = err.message;
    throw err;
  }
  const holding = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: coin.id } },
    select: { quantity: true },
  });
  if ((holding?.quantity ?? 0) < PHONE_COST) {
    const err = new Error(`The phone costs ${PHONE_COST} ¢ and you're carrying ${holding?.quantity ?? 0} ¢.`);
    err.userMessage = err.message;
    throw err;
  }

  const econ = { reason: "PAYPHONE", ...turnStamp(turn) };
  const me = characterParty(character);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;

  // ROOM LOCK FIRST, ALWAYS — db/lib/tagWrites.js takes the room lock first,
  // and the other order deadlocks against the ATM and the slot machine.
  if (vault) await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${vault.id} FOR UPDATE`;
  await dropCharacterTag(tx, character.id, coin.id, PHONE_COST, {
    econ: { from: me, to: vaultParty, ...econ },
  });
  if (vault) await addToRoomStack(tx, vault.id, coin.id, PHONE_COST, { econ });
}

/**
 * One ring, in the room being called. The dual write every other bit of
 * scenery makes (db/lib/soundBroadcast.js): the Discord post and the archive
 * row are two halves of one event, and neither is the other's fallback.
 *
 * ONLY THE FIRST RING PINGS. Four @here in sixty seconds is not a phone, it is
 * a fire drill — so ring one is the notification and the other three are the
 * sound of it still going.
 */
async function ringOnce(prisma, call, target = null) {
  const room =
    target ?? (await prisma.room.findUnique({ where: { id: call.toRoomId }, select: PHONE_ROOM }));
  if (!room) return call;

  const first = (call.ringsSent ?? 0) === 0;
  const text = PHONE_TEXT.ringing;

  if (room.discordThreadId) {
    // `parse: ["everyone"]` is what lets OUR @here through, the same permission
    // db/lib/intercom.js takes. Nothing player-typed goes into this string, so
    // there is nothing here to defang — the phone says one fixed sentence.
    //
    // The ping reaches exactly the right people for free: a Room is a thread
    // under its Location's channel, and Location visibility is a per-member
    // overwrite (db/lib/locationMove.js). So @here here is everybody standing
    // in that Location and nobody who merely knows the place exists.
    await postMessage(
      room.discordThreadId,
      first ? `@here ${text}` : `-# ${text}`,
      undefined,
      first ? { parse: ["everyone"] } : { parse: [] },
    ).catch((err) => console.error("Phone ring failed:", err.message ?? err));
  }

  await sceneLineAt(prisma, { roomId: room.id, text, signed: false, sfx: SFX.PHONE_RING });

  return prisma.phoneCall.update({
    where: { id: call.id },
    data: { ringsSent: { increment: 1 } },
  });
}

/** Pick up. Anybody standing in the called room may. */
async function answerCall(prisma, discordUserId, roomId) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const call = await prisma.phoneCall.findFirst({
    where: { status: "RINGING", toRoomId: room.id },
    orderBy: { startedAt: "desc" },
  });
  if (!call) {
    // "Nothing is ringing here" is the WRONG answer when somebody in this room
    // already picked up a second ago: the phone is very much in use, and being
    // told it is silent sends the second person looking for a fault. Which of
    // the two refusals you get is which of the two things is true.
    const live = await callInRoom(prisma, room.id);
    return fail(live ? PHONE_TEXT.held : "Nothing is ringing here.");
  }

  // A conditional update, not a read-then-write: two people in the Ward both
  // reaching for the receiver is ordinary, and exactly one of them gets it.
  const { count } = await prisma.phoneCall.updateMany({
    where: { id: call.id, status: "RINGING", calleeId: null },
    data: { status: "CONNECTED", calleeId: character.id, answeredAt: new Date() },
  });
  if (!count) return fail(PHONE_TEXT.held);

  await bothEnds(prisma, call, PHONE_TEXT.pickedUp, SFX.PHONE_PICKUP, { except: room.id });
  return { ok: true, call, sfx: SFX.PHONE_PICKUP };
}

/**
 * Put the receiver down. `reason` is why, for a GM reading a stuck row:
 * "hungup" (somebody clicked), "left" (walked out), "noanswer" (the sweep gave
 * up), "gm".
 *
 * `silentSide` is the room that should hear NOTHING — walking out of a room is
 * not a sound the room you left makes, which is the one asymmetry here.
 */
async function endCall(prisma, call, reason, { silentSide = null } = {}) {
  if (!call) return null;
  const { count } = await prisma.phoneCall.updateMany({
    where: { id: call.id, status: { in: LIVE } },
    data: { status: "ENDED", endedAt: new Date(), endedReason: reason },
  });
  if (!count) return null;

  if (reason === "noanswer") {
    // Nobody ever picked up, so there is no far end to tell. The room that has
    // been ringing hears it stop.
    await roomLine(prisma, call.toRoomId, PHONE_TEXT.noAnswer, SFX.PHONE_DROP);
    await roomLine(prisma, call.fromRoomId, PHONE_TEXT.noAnswer, SFX.PHONE_DROP);
    return call;
  }

  // "The person hung up" also plays the busy tone, because being hung up on
  // and running into a dead line are the same experience from this end.
  await bothEnds(prisma, call, PHONE_TEXT.hungUp, SFX.PHONE_BUSY, { except: silentSide });
  return call;
}

/** Hang up whatever this character is holding. */
async function hangUp(prisma, discordUserId, roomId) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const call = await callHeldBy(prisma, character.id);
  if (!call) return fail("You aren't holding a phone.");

  // The hang-up click is heard at BOTH ends: you hear your own receiver go
  // down, and they hear the line die. Only the far end gets the busy tone.
  await endCall(prisma, call, "hungup", { silentSide: room.id });
  // Their own room gets a different line: "The person hung up" is what you
  // read when somebody did it TO you, and printing it to the person who just
  // did it reads as though they had been cut off.
  await roomLine(prisma, room.id, PHONE_TEXT.putDown, SFX.PHONE_DROP);
  return { ok: true, call, sfx: SFX.PHONE_DROP };
}

/**
 * Everything this character is holding, dropped — because they left the room.
 * Called from db/lib/locationMove.js. No sound on the side they walked out of:
 * they are not there to hear it, and the room they left did not make a noise.
 */
async function dropCallsForCharacter(prisma, characterId) {
  const calls = await prisma.phoneCall.findMany({
    where: { status: { in: LIVE }, OR: [{ callerId: characterId }, { calleeId: characterId }] },
  });
  for (const call of calls) {
    const mine = call.callerId === characterId ? call.fromRoomId : call.toRoomId;
    await endCall(prisma, call, "left", { silentSide: mine }).catch((err) =>
      console.error("Phone drop failed:", err.message ?? err),
    );
  }
  return calls.length;
}

// One line into both rooms on a call, skipping `except`. Sequential and
// individually caught: never Promise.all a Discord fan-out (TURN-ENGINE.md).
async function bothEnds(prisma, call, text, sfx, { except = null } = {}) {
  for (const roomId of [call.fromRoomId, call.toRoomId]) {
    if (roomId === except) continue;
    await roomLine(prisma, roomId, text, sfx);
  }
}

// The dual write, once. Subtext on Discord because a phone clicking is
// scenery — the one line that is NOT is the ring, which is a bell.
async function roomLine(prisma, roomId, text, sfx) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, discordThreadId: true },
  });
  if (!room) return;
  if (room.discordThreadId) {
    await postMessage(room.discordThreadId, `-# ${text}`, undefined, { parse: [] }).catch((err) =>
      console.error("Phone line failed:", err.message ?? err),
    );
  }
  await sceneLineAt(prisma, { roomId, text, signed: false, sfx });
}

// How many rings SHOULD have gone out by now, derived from when the call
// started rather than from a "last rang at" column. Pure, and separated out so
// the cadence is testable without a database (db/test/phone.test.js).
//
// Derived rather than counted because a sweep that missed a pass must CATCH UP
// rather than stretch the call: a phone that rang at 0s and then not again
// until the bot came back at 40s has still been ringing for 40 seconds, and it
// should be on its third ring, not its second. Four rings is the cap whatever
// the arithmetic says.
function ringsDueBy(elapsedMs) {
  if (!(elapsedMs >= 0)) return 1;
  return Math.min(PHONE_RINGS, Math.floor(elapsedMs / PHONE_RING_INTERVAL_MS) + 1);
}

/** Whether a call that has rung its full count has also run out its window. */
function ringingOver(call, elapsedMs) {
  return (call?.ringsSent ?? 0) >= PHONE_RINGS && elapsedMs >= PHONE_RINGS * PHONE_RING_INTERVAL_MS;
}

// A CONNECTED call whose holder is dead, or no longer standing by the phone,
// is a receiver hanging on its cord in an empty room — and because a live call
// is what makes a line busy, it wedges that phone for good.
//
// db/lib/locationMove.js hangs up on every relocation, which covers walking
// out. This covers everything that is NOT a relocation: dying, a GM deleting a
// character, a row written by something that never ran the mover. It is a
// SWEEP rather than another hook for exactly that reason — the hook list is
// never finished, and a stuck phone should heal itself within fifteen seconds
// whatever put it there.
async function clearStaleCalls(prisma) {
  const live = await prisma.phoneCall.findMany({
    where: { status: "CONNECTED" },
    select: {
      id: true,
      fromRoomId: true,
      toRoomId: true,
      caller: { select: { id: true, status: true, locationId: true } },
      callee: { select: { id: true, status: true, locationId: true } },
      fromRoom: { select: { locationId: true } },
      toRoom: { select: { locationId: true } },
    },
  });

  let cleared = 0;
  for (const call of live) {
    const gone =
      !call.caller ||
      !call.callee ||
      call.caller.status !== "ALIVE" ||
      call.callee.status !== "ALIVE" ||
      call.caller.locationId !== call.fromRoom?.locationId ||
      call.callee.locationId !== call.toRoom?.locationId;
    if (!gone) continue;
    await endCall(prisma, { id: call.id, fromRoomId: call.fromRoomId, toRoomId: call.toRoomId }, "left").catch(
      (err) => console.error("Phone cleanup failed:", err.message ?? err),
    );
    cleared += 1;
  }
  return cleared;
}

/**
 * The sweep's whole job: ring what is due, give up on what has run out of
 * rings, and hang up a receiver nobody is holding any more. Called every
 * PHONE_RING_INTERVAL_MS from bot/src/events/ready.js. Returns
 * { rang, expired, cleared } for the log line.
 */
async function tickPhones(prisma) {
  const ringing = await prisma.phoneCall.findMany({
    where: { status: "RINGING" },
    orderBy: { startedAt: "asc" },
  });

  let rang = 0;
  let expired = 0;
  for (const call of ringing) {
    const elapsed = Date.now() - new Date(call.startedAt).getTime();

    if (call.ringsSent >= PHONE_RINGS) {
      if (ringingOver(call, elapsed)) {
        await endCall(prisma, call, "noanswer").catch((err) =>
          console.error("Phone expiry failed:", err.message ?? err),
        );
        expired += 1;
      }
      continue;
    }
    if (call.ringsSent >= ringsDueBy(elapsed)) continue;
    await ringOnce(prisma, call).catch((err) => console.error("Phone ring failed:", err.message ?? err));
    rang += 1;
  }
  const cleared = await clearStaleCalls(prisma).catch((err) => {
    console.error("Phone cleanup failed:", err.message ?? err);
    return 0;
  });
  return { rang, expired, cleared };
}

module.exports = {
  LIVE,
  PHONE_ROOM,
  dialablePhones,
  callInRoom,
  callHeldBy,
  phoneActor,
  phoneView,
  placeCall,
  answerCall,
  hangUp,
  endCall,
  dropCallsForCharacter,
  ringOnce,
  ringsDueBy,
  ringingOver,
  clearStaleCalls,
  tickPhones,
};
