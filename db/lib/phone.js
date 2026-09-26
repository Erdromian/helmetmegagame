// The telephone network. See docs/systemdocs/PHONES.md, which follows
// Bascinet's Phones design document.
//
// A phone is a fixture on a Room's wall (Room.phone, authored in
// docs/zones.yaml) with a four-digit number rolled every game
// (db/lib/phoneNumbers.js). You pick up the receiver, dial a number on the
// keypad, and the phone with that number rings until somebody answers it.
//
// FOUR RULES DO MOST OF THE WORK HERE, and each is load-bearing:
//
//   1. HOLDING A PHONE IS NOT BEING ON A CALL. One person holds a phone at a
//      time (Room.phoneHolderId, a unique index — so one phone per person too).
//      You pick it up, then dial; hanging up ends the call and leaves it in
//      your hand; walking away leaves it hanging, call and all, for whoever
//      picks it up next.
//   2. BUSY IS A FACT ABOUT THE FAR PHONE, decided under a row lock. A phone is
//      busy when it is on a live call, is a dead line, or is in somebody's
//      hand. The two partial unique indexes on PhoneCall's rooms are the last
//      word: a P2002 there is the busy signal arriving by the one route that
//      cannot race.
//   3. EVERYTHING IS A ROW OR A TIMESTAMP, NEVER A TIMER. Rings are derived
//      from PhoneCall.startedAt, the payphone's time from Room.phonePaidUntil,
//      a named phone's patience from Room.phoneIdleSince. The 15-second sweep
//      (tickPhones, from bot/src/events/ready.js) reads them, so a bot restart
//      picks everything back up where it was.
//   4. A PHONE CARRIES A VOICE, NEVER A NAME. Every line the far room reads is
//      a SYSTEM row, so db/lib/presentedIdentity.js never comes into it. See
//      db/lib/phoneVoice.js. And a phone never records where a call came from.
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
const { ensurePhoneNumbers } = require("./phoneNumbers");
const { notifyPhones, handsetState, handsetTimers, handsetFrame } = require("./phoneFrame");
const {
  PHONE_COST,
  PHONE_PAID_MS,
  PHONE_OBOL_PROMPT_MS,
  PHONE_HOLD_IDLE_MS,
  PHONE_RING_INTERVAL_MS,
  PHONE_MISDIAL_MS,
  PHONE_TEXT,
  normalizeDigits,
} = require("./phoneText");

// The two statuses that mean a line is open somewhere. One list, because
// "busy" and "the sweep should look at this" are nearly the same question.
const LIVE = ["RINGING", "CONNECTED"];

// A phone rings until somebody answers — but not past the point its caller
// would have been dropped for standing there with no call connected. So the
// same ten minutes caps the ring, and a receiver left hanging mid-dial does
// not ring an office forever.
const PHONE_RING_CAP_MS = PHONE_HOLD_IDLE_MS;

// The columns any caller needs off a phone's Room.
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
  retiredAt: true,
  phoneNumber: true,
  phoneHolderId: true,
  phoneHeldAt: true,
  phoneHeldVia: true,
  phoneIdleSince: true,
  phonePaidUntil: true,
  phoneObolPrompted: true,
  phoneDeadSince: true,
};

// What letting go of a phone writes. The paid time stays with the phone: a
// coin buys the line, and whoever picks it up next inherits what is left.
const RELEASED = {
  phoneHolderId: null,
  phoneHeldAt: null,
  phoneHeldVia: null,
  phoneIdleSince: null,
};

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The live call this room is on, at either end, or null. */
async function callInRoom(prisma, roomId) {
  if (!roomId) return null;
  return prisma.phoneCall.findFirst({
    where: { status: { in: LIVE }, OR: [{ fromRoomId: roomId }, { toRoomId: roomId }] },
    orderBy: { startedAt: "desc" },
  });
}

const farRoomOf = (call, roomId) => (call.fromRoomId === roomId ? call.toRoomId : call.fromRoomId);

// Alive, able to act, standing in this room's Location, and able to get in.
// The gate stack is db/lib/slotMachine.js#slotActor's, for the same reason it
// gives: a web dialog and a Discord button both outlive somebody walking out
// of the room, so it is re-run on every press rather than trusted from before.
async function phoneActor(prisma, discordUserId, roomId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true, locationId: true, discordUserId: true, tags: { include: { tag: true } } },
  });
  if (!character) return fail("You don't have a living character.");

  const room = await prisma.room.findUnique({ where: { id: roomId }, select: PHONE_ROOM });
  if (!room || !room.phone || room.retiredAt) return fail(PHONE_TEXT.noPhone);
  if (character.locationId !== room.locationId) return fail(PHONE_TEXT.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(`You can't act — you're ${blocker.name}.`);

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail("You can't get in there.");
  }
  return { ok: true, character, room };
}

// The same gates, plus: this character is the one holding this phone.
async function holderActor(prisma, discordUserId, roomId) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  if (actor.room.phoneHolderId !== actor.character.id) return fail(PHONE_TEXT.notHolding);
  return actor;
}

// The handset as the holder's dialog draws it: the frame the feed carries,
// plus the words that go with it.
async function holdingView(prisma, character, roomId, extra = {}) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: PHONE_ROOM });
  const call = await callInRoom(prisma, roomId);
  return { ok: true, mode: "holding", room, character, handset: handsetFrame(room, call), ...extra };
}

/**
 * The handset in this character's hand, read and nothing else — what the
 * Discord keypad redraws itself from on every key press. A press on a keypad
 * whose phone is no longer in your hand is refused, never a pick-up.
 */
async function handsetView(prisma, discordUserId, roomId) {
  const actor = await holderActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  return holdingView(prisma, actor.character, actor.room.id);
}

/**
 * Put a phone in this character's hand. Conditional on nobody holding it, so
 * two people reaching for one receiver is decided by the database, not by who
 * read first. A phone they were already holding somewhere else is left
 * hanging first — a person has one pair of hands.
 */
async function takePhone(prisma, character, room, via) {
  if (room.phoneHolderId === character.id) return true;
  const other = await prisma.room.findFirst({ where: { phoneHolderId: character.id }, select: { id: true } });
  if (other) await releasePhone(prisma, other.id, { reason: "walked" });

  const call = await callInRoom(prisma, room.id);
  try {
    const { count } = await prisma.room.updateMany({
      where: { id: room.id, phoneHolderId: null },
      data: {
        phoneHolderId: character.id,
        phoneHeldAt: new Date(),
        phoneHeldVia: via === "discord" ? "discord" : "web",
        phoneIdleSince: call?.status === "CONNECTED" ? null : new Date(),
      },
    });
    return count > 0;
  } catch (err) {
    if (err?.code === "P2002") return false;
    throw err;
  }
}

/**
 * Let go of a phone without hanging up — the design document's Walk away, and
 * what the sweep does to a holder whose time is up when there is no call to
 * end. A call left running with nobody at EITHER end is a line nobody is on,
 * so it ends; a dead line with nobody at it simply stops being dead.
 */
async function releasePhone(prisma, roomId, { reason = "walked" } = {}) {
  await prisma.room.update({ where: { id: roomId }, data: { ...RELEASED, phoneDeadSince: null } });
  const call = await callInRoom(prisma, roomId);
  if (call) {
    const far = await prisma.room.findUnique({ where: { id: farRoomOf(call, roomId) }, select: { phoneHolderId: true } });
    // A call still ringing out is left to ring: that is what walking away
    // from a ringing phone does. A connected call with nobody on either end
    // is over.
    if (call.status === "CONNECTED" && !far?.phoneHolderId) {
      await endCall(prisma, call, reason, { byRoomId: roomId, quiet: true });
    }
  }
  await notifyPhones(prisma, [roomId]);
}

/**
 * What the dialog should draw, and the act of picking the phone up. The same
 * button does everything (PHONES.md §3), and deciding which on the client
 * would let two tabs disagree.
 *
 *   held      somebody else has the receiver
 *   answer    a payphone is ringing: answering it takes a coin first
 *   holding   the phone is in your hand — picked up now, or already. A named
 *             phone that was ringing is answered by picking it up.
 *
 * `via` is "web" or "discord": where a far voice meant for the holder goes.
 */
async function phoneView(prisma, discordUserId, roomId, { via = "web" } = {}) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character } = actor;
  let { room } = actor;

  // A phone added since Start Game gets its number the moment anybody lifts it.
  if (room.phoneNumber == null) {
    await ensurePhoneNumbers(prisma).catch((err) => console.error("Phone numbering failed:", err.message ?? err));
    room = await prisma.room.findUnique({ where: { id: roomId }, select: PHONE_ROOM });
  }

  if (room.phoneHolderId === character.id) return holdingView(prisma, character, room.id);
  if (room.phoneHolderId) {
    // A holder who has gone (dead, walked out by some path the mover missed)
    // is not holding anything. The sweep would free it within fifteen
    // seconds; the person standing at the phone should not have to wait.
    const holder = await prisma.character.findUnique({
      where: { id: room.phoneHolderId },
      select: { status: true, locationId: true },
    });
    if (holder?.status === "ALIVE" && holder.locationId === room.locationId) {
      return { ok: true, mode: "held", room, character };
    }
    await ejectHolder(prisma, room, "left");
    room = await prisma.room.findUnique({ where: { id: roomId }, select: PHONE_ROOM });
  }

  const call = await callInRoom(prisma, room.id);
  const ringingHere = call?.status === "RINGING" && call.toRoomId === room.id;

  if (ringingHere && room.payphone && handsetTimers(room, "idle").needsCoin) {
    return { ok: true, mode: "answer", room, character, price: PHONE_COST };
  }

  if (!(await takePhone(prisma, character, room, via))) {
    return { ok: true, mode: "held", room, character };
  }

  if (ringingHere) {
    const answered = await connectCall(prisma, call, character);
    if (answered) {
      return holdingView(prisma, character, room.id, { line: PHONE_TEXT.answered, sfx: SFX.PHONE_PICKUP });
    }
  }
  await notifyPhones(prisma, [room.id]);
  return holdingView(prisma, character, room.id, { line: PHONE_TEXT.pickedUp });
}

// A RINGING call becomes CONNECTED, once: a conditional update, so two
// answers in the same second connect it once. The caller's room hears the
// pickup; the answerer hears it off their own action result.
async function connectCall(prisma, call, character) {
  const { count } = await prisma.phoneCall.updateMany({
    where: { id: call.id, status: "RINGING" },
    data: { status: "CONNECTED", calleeId: character.id, answeredAt: new Date() },
  });
  if (!count) return false;
  await prisma.room.updateMany({
    where: { id: { in: [call.fromRoomId, call.toRoomId] } },
    data: { phoneIdleSince: null },
  });
  await roomLine(prisma, call.fromRoomId, PHONE_TEXT.farPickedUp, SFX.PHONE_PICKUP);
  await notifyPhones(prisma, [call.fromRoomId, call.toRoomId]);
  return true;
}

/**
 * Pick up a ringing payphone: the coin, then the receiver, then the line.
 * A named phone never needs this — opening it answers it.
 */
async function answerPhone(prisma, discordUserId, roomId, { via = "web", turn = null } = {}) {
  const actor = await phoneActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  if (room.phoneHolderId && room.phoneHolderId !== character.id) return fail(PHONE_TEXT.held);

  const call = await callInRoom(prisma, room.id);
  if (!(call?.status === "RINGING" && call.toRoomId === room.id)) return fail(PHONE_TEXT.notRinging);

  let paid = false;
  if (room.payphone && handsetTimers(room, "idle").needsCoin) {
    try {
      await prisma.$transaction(async (tx) => {
        await takePhoneCoin(tx, character, room, turn);
        await buyTime(tx, room);
      });
      paid = true;
    } catch (err) {
      return fail(err?.userMessage ?? "The coin wouldn't go in. Try again.", { sfx: SFX.REFUSE_MONEY });
    }
  }
  if (!(await takePhone(prisma, character, room, via))) return fail(PHONE_TEXT.held);
  if (!(await connectCall(prisma, call, character))) {
    // Somebody else's hand got there between the read and the write. The
    // receiver is still yours, and so is the coin's time.
    await notifyPhones(prisma, [room.id]);
    return holdingView(prisma, character, room.id, { line: PHONE_TEXT.pickedUp, sfx: paid ? SFX.COIN_INSERT : null });
  }
  return holdingView(prisma, character, room.id, { line: PHONE_TEXT.answered, sfx: SFX.PHONE_PICKUP });
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

// PHONE_PAID_MS more on the line, from whichever is later: now, or the time
// already paid for — a coin in the last minute adds to the minute, it does
// not throw it away.
async function buyTime(tx, room) {
  const fresh = await tx.room.findUnique({ where: { id: room.id }, select: { phonePaidUntil: true } });
  const base = Math.max(Date.now(), fresh?.phonePaidUntil ? new Date(fresh.phonePaidUntil).getTime() : 0);
  await tx.room.update({
    where: { id: room.id },
    data: { phonePaidUntil: new Date(base + PHONE_PAID_MS), phoneObolPrompted: false },
  });
}

/** Another obol into a payphone in your hand — the last-minute prompt's answer. */
async function insertObol(prisma, discordUserId, roomId, { turn = null } = {}) {
  const actor = await holderActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  if (!room.payphone) return fail(PHONE_TEXT.nothingToPay);
  const call = await callInRoom(prisma, room.id);
  if (!handsetTimers(room, handsetState(room, call)).needsCoin) return fail(PHONE_TEXT.nothingToPay);
  try {
    await prisma.$transaction(async (tx) => {
      await takePhoneCoin(tx, character, room, turn);
      await buyTime(tx, room);
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The coin wouldn't go in. Try again.", { sfx: SFX.REFUSE_MONEY });
  }
  await notifyPhones(prisma, [room.id]);
  return holdingView(prisma, character, room.id, { line: PHONE_TEXT.paid, sfx: SFX.COIN_INSERT });
}

// Whether a phone can take a call right now, read off a row fetched under
// lock. Busy is ANY of: in somebody's hand, a dead line, or on a live call —
// the last is also caught by the partial unique indexes.
function takesCalls(room) {
  return Boolean(room?.phone) && !room.retiredAt && !room.phoneHolderId && !room.phoneDeadSince;
}

/**
 * Dial a number from the phone in your hand. Resolves to
 * { ok, outcome, handset, line, sfx } where `outcome` is
 *
 *   "ringing"        the far phone is ringing
 *   "notInService"   no phone has that number
 *   "busy"           the far phone is busy, or it is this phone
 *
 * The last two ring out for PHONE_MISDIAL_MS before the exchange says so,
 * into this room's chat: the design document's "calls for a few seconds,
 * before sounding an error". That is an honest wait on the server, so both
 * faces keep the caller listening to the same tone for the same time.
 */
async function dialNumber(prisma, discordUserId, roomId, rawDigits, { turn = null } = {}) {
  const actor = await holderActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const digits = normalizeDigits(rawDigits);
  if (!digits) return fail(PHONE_TEXT.badNumber);
  if (room.phoneDeadSince || (await callInRoom(prisma, room.id))) return fail(PHONE_TEXT.hangUpFirst);

  // A payphone takes its coin when you dial, whatever you dial — the coin
  // buys the line, not the person at the other end.
  let charged = false;
  if (room.payphone && handsetTimers(room, "idle").needsCoin) {
    try {
      await prisma.$transaction(async (tx) => {
        await takePhoneCoin(tx, character, room, turn);
        await buyTime(tx, room);
      });
      charged = true;
    } catch (err) {
      return fail(err?.userMessage ?? "The coin wouldn't go in. Try again.", { sfx: SFX.REFUSE_MONEY });
    }
  }
  await prisma.room.update({ where: { id: room.id }, data: { phoneIdleSince: new Date() } });

  const number = Number(digits);
  const target = await prisma.room.findFirst({
    where: { phoneNumber: number, phone: { not: null }, retiredAt: null },
    select: PHONE_ROOM,
  });

  await audit(prisma, discordUserId, character, room, turn, { dialled: digits, charged });

  if (!target) return misdial(prisma, character, room, "notInService", PHONE_TEXT.notInService);
  if (target.id === room.id || !takesCalls(target)) return misdial(prisma, character, room, "busy", PHONE_TEXT.busy);

  // Both rows locked, in id order so two people dialling each other in the
  // same second cannot deadlock, then the far phone checked again under the
  // lock: a hand that reached it between the read above and here makes it
  // busy, and so does a call the partial unique index refuses.
  let call = null;
  try {
    call = await prisma.$transaction(async (tx) => {
      const [a, b] = [room.id, target.id].sort();
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" IN (${a}, ${b}) ORDER BY "id" FOR UPDATE`;
      const far = await tx.room.findUnique({ where: { id: target.id }, select: PHONE_ROOM });
      if (!takesCalls(far)) return null;
      return tx.phoneCall.create({
        data: {
          fromRoomId: room.id,
          toRoomId: target.id,
          callerId: character.id,
          status: "RINGING",
          paid: charged,
          turnId: turn?.id ?? null,
        },
      });
    });
  } catch (err) {
    if (err?.code !== "P2002") {
      console.error("Phone dial failed:", err.message ?? err);
      return fail("The line went dead. Try again.");
    }
  }
  if (!call) return misdial(prisma, character, room, "busy", PHONE_TEXT.busy);

  await ringOnce(prisma, call, target);
  await notifyPhones(prisma, [room.id, target.id]);
  return holdingView(prisma, character, room.id, {
    outcome: "ringing",
    line: PHONE_TEXT.dialled(digits),
    sfx: charged ? SFX.COIN_INSERT : null,
  });
}

// A number that goes nowhere: ring out for a few seconds, then the error,
// said into the dialling room. The error sound is the dialler's alone — it is
// in their ear, not on the wall.
async function misdial(prisma, character, room, outcome, text) {
  await sleep(PHONE_MISDIAL_MS);
  await roomLine(prisma, room.id, text, null);
  return holdingView(prisma, character, room.id, { outcome, line: text, sfx: SFX.PHONE_ERROR });
}

// One audit row per dial, stamped with the turn (REQUESTS.md 1a). The number
// dialled and whether a coin went in — never the phone it reached, because the
// phone keeps no such record and neither should the log a GM hands round.
async function audit(prisma, discordUserId, character, room, turn, details) {
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "phone_call",
        targetCharacterId: character.id,
        roomId: room.id,
        turnId: turn?.id ?? null,
        details: { from: room.phone, ...details, cost: details.charged ? PHONE_COST : 0 },
      },
    })
    .catch((err) => console.error("Phone audit failed:", err.message ?? err));
}

/**
 * One ring, in the room being called. The dual write every other bit of
 * scenery makes (db/lib/soundBroadcast.js): the Discord post and the archive
 * row are two halves of one event, and neither is the other's fallback. The
 * bell itself is not on the row — it is a loop the browser holds for as long
 * as the call rings (db/lib/phoneFrame.js).
 *
 * ONLY THE FIRST RING PINGS. A phone that rings until it is answered would
 * otherwise be forty @here in ten minutes: ring one is the notification and
 * the rest are the sound of it still going.
 */
async function ringOnce(prisma, call, target = null) {
  const room =
    target ?? (await prisma.room.findUnique({ where: { id: call.toRoomId }, select: PHONE_ROOM }));
  if (!room) return call;

  const first = (call.ringsSent ?? 0) === 0;
  const text = PHONE_TEXT.ringing;

  if (room.discordThreadId) {
    // `parse: ["everyone"]` is what lets OUR @here through, the same permission
    // db/lib/intercom.js takes. Nothing player-typed goes into this string.
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

  await sceneLineAt(prisma, { roomId: room.id, text, signed: false });

  return prisma.phoneCall.update({
    where: { id: call.id },
    data: { ringsSent: { increment: 1 } },
  });
}

/**
 * End a call. `byRoomId` is the end that did it — hung up, walked off, was
 * ejected; the OTHER end is told, and if somebody is holding the receiver
 * there it goes dead in their hand: the busy tone, and "The call hung up.",
 * until they hang up too.
 *
 * `quiet` ends the line without telling anybody, for a call nobody is on.
 */
async function endCall(prisma, call, reason, { byRoomId = null, quiet = false } = {}) {
  if (!call) return null;
  const { count } = await prisma.phoneCall.updateMany({
    where: { id: call.id, status: { in: LIVE } },
    data: { status: "ENDED", endedAt: new Date(), endedReason: reason },
  });
  if (!count) return null;

  if (!quiet) {
    if (call.status === "RINGING") {
      // The caller gave up, or ran out of ring. The phone on the far wall just
      // stops; nobody picked it up, so there is nobody to tell.
      if (reason === "noanswer") await roomLine(prisma, call.fromRoomId, PHONE_TEXT.noAnswer, null);
    } else if (byRoomId) {
      const farId = farRoomOf(call, byRoomId);
      const { count: dead } = await prisma.room.updateMany({
        where: { id: farId, phoneHolderId: { not: null } },
        data: { phoneDeadSince: new Date(), phoneIdleSince: new Date() },
      });
      if (dead) await roomLine(prisma, farId, PHONE_TEXT.hungUp, SFX.PHONE_PICKUP);
    }
  }
  await prisma.room.updateMany({
    where: { id: { in: [call.fromRoomId, call.toRoomId] }, phoneHolderId: { not: null }, phoneIdleSince: null },
    data: { phoneIdleSince: new Date() },
  });
  await notifyPhones(prisma, [call.fromRoomId, call.toRoomId]);
  return call;
}

/** Hang up: the call ends, the phone stays in your hand. */
async function hangUp(prisma, discordUserId, roomId) {
  const actor = await holderActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  if (room.phoneDeadSince) {
    await prisma.room.update({ where: { id: room.id }, data: { phoneDeadSince: null, phoneIdleSince: new Date() } });
    await notifyPhones(prisma, [room.id]);
    return holdingView(prisma, character, room.id, { line: PHONE_TEXT.hungUpSelf, sfx: SFX.PHONE_PICKUP });
  }
  const call = await callInRoom(prisma, room.id);
  if (!call) return fail(PHONE_TEXT.noCall);
  await endCall(prisma, call, "hungup", { byRoomId: room.id });
  return holdingView(prisma, character, room.id, { line: PHONE_TEXT.hungUpSelf, sfx: SFX.PHONE_PICKUP });
}

/** Walk away: let go of the receiver and leave the line as it is. */
async function walkAway(prisma, discordUserId, roomId) {
  const actor = await holderActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  await releasePhone(prisma, actor.room.id, { reason: "walked" });
  return { ok: true, mode: "gone", line: PHONE_TEXT.walkedAway, sfx: SFX.PHONE_DROP };
}

/**
 * Take the receiver out of somebody's hand: their time is up, or they are no
 * longer standing there. Any call on the line hangs up from this end — the
 * design document's "ejected from the payphone and the call hangs up".
 */
async function ejectHolder(prisma, room, reason) {
  const call = await callInRoom(prisma, room.id);
  await prisma.room.update({ where: { id: room.id }, data: { ...RELEASED, phoneDeadSince: null } });
  if (call) await endCall(prisma, call, reason, { byRoomId: room.id });
  else await notifyPhones(prisma, [room.id]);
}

/**
 * Everything this character is holding, dropped — because they left the room.
 * Called from db/lib/locationMove.js. Leaving hangs up, as it always has: the
 * design document's Walk away is a button, not a side effect of walking.
 */
async function dropCallsForCharacter(prisma, characterId) {
  const rooms = await prisma.room.findMany({ where: { phoneHolderId: characterId }, select: PHONE_ROOM });
  for (const room of rooms) {
    await ejectHolder(prisma, room, "left").catch((err) => console.error("Phone drop failed:", err.message ?? err));
  }
  return rooms.length;
}

// The dual write, once. Subtext on Discord because a phone clicking is
// scenery. `sfx` rides the row for everybody reading the room, or null.
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
// rather than stretch the call. There is no cap: a phone rings until it is
// answered, or until PHONE_RING_CAP_MS ends the call.
function ringsDueBy(elapsedMs) {
  if (!(elapsedMs >= 0)) return 1;
  return Math.floor(elapsedMs / PHONE_RING_INTERVAL_MS) + 1;
}

/** Whether a ringing call has rung for as long as a caller could stand there. */
function ringingOver(elapsedMs) {
  return elapsedMs >= PHONE_RING_CAP_MS;
}

/**
 * What the sweep should do with one held phone, from its row and its holder.
 * Pure, so every rule is testable without a database. Returns one of
 *
 *   "left"     the holder is dead or no longer in the Location: eject
 *   "unpaid"   a payphone's paid time ran out: eject, hanging up
 *   "prompt"   a payphone in its last minute that has not asked yet
 *   "idle"     no call connected for PHONE_HOLD_IDLE_MS: let go
 *   null       leave it be
 */
function holderVerdict(room, holder, state, now = Date.now()) {
  if (!holder || holder.status !== "ALIVE" || holder.locationId !== room.locationId) return "left";
  const { paidUntil, idleEjectAt } = handsetTimers(room, state, now);
  if (room.payphone && paidUntil != null && paidUntil <= now) return "unpaid";
  if (room.payphone && paidUntil != null && paidUntil - now <= PHONE_OBOL_PROMPT_MS && !room.phoneObolPrompted) {
    return "prompt";
  }
  if (idleEjectAt != null && idleEjectAt <= now) return "idle";
  return null;
}

/**
 * The sweep's whole job, every PHONE_RING_INTERVAL_MS from
 * bot/src/events/ready.js: ring what is due, give up on what has rung too long,
 * and apply the holders' clocks. Returns { rang, expired, ejected } for the
 * log line.
 */
async function tickPhones(prisma) {
  const now = Date.now();
  let rang = 0;
  let expired = 0;
  let ejected = 0;

  const ringing = await prisma.phoneCall.findMany({ where: { status: "RINGING" }, orderBy: { startedAt: "asc" } });
  for (const call of ringing) {
    const elapsed = now - new Date(call.startedAt).getTime();
    if (ringingOver(elapsed)) {
      await endCall(prisma, call, "noanswer", { byRoomId: call.fromRoomId }).catch((err) =>
        console.error("Phone expiry failed:", err.message ?? err),
      );
      expired += 1;
      continue;
    }
    if (call.ringsSent >= ringsDueBy(elapsed)) continue;
    await ringOnce(prisma, call).catch((err) => console.error("Phone ring failed:", err.message ?? err));
    rang += 1;
  }

  const held = await prisma.room.findMany({ where: { phoneHolderId: { not: null } }, select: PHONE_ROOM });
  for (const room of held) {
    try {
      const [holder, call] = await Promise.all([
        prisma.character.findUnique({ where: { id: room.phoneHolderId }, select: { status: true, locationId: true } }),
        callInRoom(prisma, room.id),
      ]);
      const verdict = holderVerdict(room, holder, handsetState(room, call), now);
      if (verdict === "left" || verdict === "unpaid") {
        await ejectHolder(prisma, room, verdict);
        ejected += 1;
      } else if (verdict === "prompt") {
        await prisma.room.update({ where: { id: room.id }, data: { phoneObolPrompted: true } });
        await roomLine(prisma, room.id, PHONE_TEXT.insertAgain, null);
        await notifyPhones(prisma, [room.id]);
      } else if (verdict === "idle") {
        await releasePhone(prisma, room.id, { reason: "ejected" });
        ejected += 1;
      }
    } catch (err) {
      console.error("Phone holder sweep failed:", err.message ?? err);
    }
  }

  // A payphone line nobody is holding still runs on its paid time.
  const unpaid = await prisma.phoneCall.findMany({
    where: { status: "CONNECTED" },
    select: {
      id: true,
      status: true,
      fromRoomId: true,
      toRoomId: true,
      fromRoom: { select: { payphone: true, phoneHolderId: true, phonePaidUntil: true } },
      toRoom: { select: { payphone: true, phoneHolderId: true, phonePaidUntil: true } },
    },
  });
  for (const call of unpaid) {
    for (const [roomId, room] of [
      [call.fromRoomId, call.fromRoom],
      [call.toRoomId, call.toRoom],
    ]) {
      const lapsed = room?.payphone && room.phonePaidUntil && new Date(room.phonePaidUntil).getTime() <= now;
      const nobody = !call.fromRoom?.phoneHolderId && !call.toRoom?.phoneHolderId;
      if (lapsed || nobody) {
        await endCall(prisma, call, lapsed ? "unpaid" : "walked", { byRoomId: roomId, quiet: nobody }).catch((err) =>
          console.error("Phone line sweep failed:", err.message ?? err),
        );
        expired += 1;
        break;
      }
    }
  }

  // A dead line nobody is holding is just a phone on the wall again.
  await prisma.room.updateMany({ where: { phoneHolderId: null, phoneDeadSince: { not: null } }, data: { phoneDeadSince: null } });

  return { rang, expired, ejected };
}

module.exports = {
  LIVE,
  PHONE_ROOM,
  PHONE_RING_CAP_MS,
  callInRoom,
  phoneActor,
  phoneView,
  handsetView,
  answerPhone,
  insertObol,
  dialNumber,
  hangUp,
  walkAway,
  endCall,
  ejectHolder,
  releasePhone,
  dropCallsForCharacter,
  ringOnce,
  ringsDueBy,
  ringingOver,
  holderVerdict,
  takesCalls,
  tickPhones,
};
