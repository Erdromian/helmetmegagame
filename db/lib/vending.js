// The Merchant's vending machine (docs/systemdocs/VENDING.md).
//
// The shop that sells while he is asleep. One turn is one real day, so nobody
// can stand behind a counter for all of it, and DEPOT.md §6 left player-to-player
// retail needing both parties in the same room at the same moment. This is the
// asynchronous shelf: goods behind glass at a price the merchant set, a slot for
// coin, and a till he empties later.
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/depotCounter.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter and stays off the @lifeweb/db barrel (db/lib/dm.js); require by path.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
// 1. THE FLOAT IS NEVER MOVED BY THE CLOCK. Coin left in the slot when somebody's
//    five minutes run out stays in the slot, loose, for whoever opens the machine
//    next. It does not sweep to the till and it is not posted back. Every sweep
//    and every hook below is written to not break that.
// 2. THE HOLD IS DERIVED, NEVER STORED AS A DEADLINE. `heldBy` computes it from
//    `holderSince` on every read, so the machine frees itself the instant five
//    minutes pass whether or not the bot is running — db/lib/phone.js#ringsDueBy
//    is the same bargain for the same reason.

const { blockerFor, ACT } = require("./incapacitation");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { loadPresentedIdentity } = require("./presentedIdentity");
const { postMessage } = require("./discordRest");
const { sceneLineAt } = require("./scene");
const { placeKeyForRoom } = require("./placeKey");
const { isTradeable } = require("./tradeable");
const { carryAdmits } = require("./carry");
const { holdLimitRefusal } = require("./mounts");
const { rowWeight } = require("./tagWeight");
const { MERCHANT_LICENSE_SLUG } = require("./depot");
const { OBOL_SLUG } = require("./depotState");
const { RESOURCES_SLUG } = require("./resourceStack");
const { addToStack, dropCharacterTag, lockRoom } = require("./tagWrites");
const { drawPoisonedUnits } = require("./poison");
// No `record` here on purpose: every coin and goods movement in this file is
// booked by the tagWrites hook off the `econ` option, and calling record()
// beside one books it twice (see insertCoins).
const { characterParty, machineParty, turnStamp } = require("./economyLedger");
// Takes `prisma` as a parameter, so it is safe at the top here — the three
// sendDm twins and why they differ are in CLAUDE.md.
const { sendDm } = require("./dm");
const { SFX } = require("./sfx");
// The words and the numbers live in their own zero-require file so Chat's dialog
// can import them without dragging PrismaClient into the browser (slotText.js
// says the same about itself). Re-exported below, so a server caller keeps its
// one import.
const {
  VENDING_HOLD_MS,
  VENDING_MAX_PRICE,
  VENDING_SHELF_CAP,
  VENDING_TEXT: T,
  heldBy,
  secondsLeftOn,
  unlockedNow,
  timeLeftLine,
} = require("./vendingText");

function fail(error) {
  return { ok: false, error, sfx: SFX.REFUSE };
}

// ---------------------------------------------------------------- pure half
// The clock lives in ./vendingText.js, because Chat's dialog counts down too and
// cannot import this file without dragging Prisma into the browser. Imported
// above and re-exported below, so ONE implementation serves both faces and the
// seconds on screen can never disagree with the refusal on the server.
// db/test/vending.test.js covers it.

/**
 * A price, or null if it isn't one. 0 is a price: it means free.
 *
 * The empty cases are rejected BY HAND rather than left to Number(), which
 * answers 0 for null, "" and false alike. That would read an empty Discord
 * modal field as "free" and hand the merchant's stock away, so a missing price
 * has to be a refusal here. A caller that means free says so — stockMachine
 * passes `priceObols ?? 0` for a new line, deliberately.
 */
function validPrice(n) {
  if (n === null || n === undefined || typeof n === "boolean") return null;
  if (typeof n === "string" && n.trim() === "") return null;
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > VENDING_MAX_PRICE) return null;
  return v;
}

// ------------------------------------------------------------- the machine

/**
 * The machine on this room's wall, created on first touch so a GM ticking the
 * box on a second room needs no script. Upsert on `roomId`, which is unique.
 */
async function ensureMachine(db, roomId) {
  return db.vendingMachine.upsert({
    where: { roomId },
    update: {},
    create: { roomId },
    include: { slots: { include: { tag: true } } },
  });
}

const MACHINE_INCLUDE = { slots: { include: { tag: true } } };

/**
 * Alive, able to act, standing at the machine's Location with the door open.
 * Re-resolved on EVERY press — a web dialog and a Discord button both outlive
 * somebody walking out of the room (db/lib/slotMachine.js#slotActor).
 */
async function vendingActor(prisma, discordUserId, roomId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { quantity: true, equipped: true, tag: true } },
    },
  });
  if (!character) return fail(T.noCharacter);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      slug: true,
      locationId: true,
      accessTagSlugs: true,
      kind: true,
      discordThreadId: true,
      vendingMachine: true,
      location: { select: { zoneId: true } },
    },
  });
  if (!room?.vendingMachine) return fail(T.noMachine);
  if (character.locationId !== room.locationId) return fail(T.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(T.cantAct(blocker.name));

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail(T.noDoor);
  }

  const machine = await ensureMachine(prisma, room.id);
  const held = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  return {
    ok: true,
    character,
    room,
    machine,
    held,
    // The gate is the TRADEABLE licence, never the Merchant role. DEPOT.md
    // §132-134: "the licence is tradeable and a role check would quietly break
    // that." Steal the licence and the machine is yours — that is the feature,
    // not a hole in it, and it is also what keeps the till reachable after the
    // Merchant dies.
    licensed: held.has(MERCHANT_LICENSE_SLUG),
  };
}

/** The presser must be the one holding it, and the hold must still be live. */
function requireHold(machine, characterId) {
  const holder = heldBy(machine);
  if (!holder) return fail(T.holdLost);
  if (holder !== characterId) return fail(T.busy);
  return { ok: true };
}

// ------------------------------------------------------------------- reads

/**
 * What the dialog draws. `mode` is "closed" (nobody has it), "customer",
 * "merchant" (unlocked), or "busy" (somebody else has it).
 */
async function machineView(prisma, discordUserId, roomId) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, machine, licensed } = actor;

  const holder = heldBy(machine);
  const mine = holder === character.id;
  let holderName = null;
  if (holder && !mine) {
    // The identity the ROOM would see, never the row — a hooded customer reads
    // as "A young man" here exactly as anywhere else.
    const { identity } = await loadPresentedIdentity(prisma, holder);
    holderName = identity?.name ?? "Somebody";
  }

  const unlocked = mine && unlockedNow(machine);
  return {
    ok: true,
    mode: !mine ? (holder ? "busy" : "closed") : unlocked ? "merchant" : "customer",
    holderName,
    secondsLeft: mine ? secondsLeftOn(machine) : 0,
    // BOTH halves, or the client's clock reads zero. Chat counts down by
    // calling heldBy/secondsLeftOn on this very object, and heldBy needs a
    // holder AND a timestamp — sending only the timestamp had a freshly taken
    // machine announce "0 seconds left." and re-read itself every tick.
    // Only ever the viewer's own id, and only while the hold is theirs.
    holderId: mine ? character.id : null,
    holderSince: mine ? machine.holderSince : null,
    floatObols: machine.floatObols,
    // The till is the merchant's business and nobody else's. A customer is not
    // told how much is in the box they are standing in front of.
    tillObols: unlocked ? machine.tillObols : null,
    licensed,
    unlocked,
    slots: (machine.slots ?? [])
      .filter((s) => s.quantity > 0)
      .map((s) => ({
        tagId: s.tagId,
        name: s.tag?.name ?? "Something",
        quantity: s.quantity,
        priceObols: s.priceObols,
        weightLbs: s.tag?.weightLbs ?? 0,
        stackable: Boolean(s.tag?.stackable),
      })),
  };
}

// ------------------------------------------------------------------- verbs
// Every one takes `turn` for the ledger stamp and the AuditLog row
// (REQUESTS.md §1a), and returns { ok, line, text, sfx } or { ok: false, error }.
// `line` is what the presser is told; `text` is what the room reads.

/**
 * Announce into the room. Best-effort on both faces, never inside a transaction.
 *
 * REFUSES TO REPEAT ITSELF. A merchant stocking three wares called
 * stockMachine three times and the Storefront read "moves things around inside
 * the machine." three times in a row — which is the same noise the silence on
 * Insert and Withdraw exists to avoid, arriving by a different door. So a line
 * identical to the room's most recent one is dropped rather than posted twice.
 * Cheap enough: these are scenery posts that already swallow their own errors.
 */
async function sayInRoom(prisma, room, text, sfx = null) {
  if (!text) return;
  try {
    const placeKey = placeKeyForRoom(room.id);
    const last = await prisma.archiveEntry.findFirst({
      where: { placeKey },
      orderBy: { seq: "desc" },
      select: { content: true },
    });
    if (last?.content === text) return;
  } catch {
    // Never let the de-duplication stop the line going out.
  }
  await sceneLineAt(prisma, { roomId: room.id, text, sfx }).catch(() => {});
  if (room.discordThreadId) {
    await postMessage(room.discordThreadId, text, undefined, { parse: [] }).catch(() => {});
  }
}

async function presentedName(prisma, characterId, fallback = "Somebody") {
  const { identity } = await loadPresentedIdentity(prisma, characterId).catch(() => ({ identity: null }));
  return identity?.name ?? fallback;
}

/**
 * Take the machine. The hold is taken on OPENING, not on the first purchase:
 * the design doc's "prevent other characters from stealing the obols inserted"
 * means the view itself is exclusive, so a second person cannot even read the
 * float.
 */
async function takeMachine(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room, machine } = actor;

  if (heldBy(machine) === character.id) {
    return { ok: true, line: T.youHold(secondsLeftOn(machine)), sfx: SFX.OK_QUIET };
  }

  const cutoff = new Date(Date.now() - VENDING_HOLD_MS);
  let took = false;
  await prisma.$transaction(async (tx) => {
    // MY OWN stale holds first, anywhere. Without this the unique index on
    // holderId refuses a legitimate claim on a second machine on behalf of a
    // hold that is already dead.
    await tx.vendingMachine.updateMany({
      where: { holderId: character.id, holderSince: { lt: cutoff } },
      data: { holderId: null, holderSince: null, unlocked: false },
    });
    // The claim. `count === 0` IS the busy signal — there is no read to race,
    // the shape db/lib/tagWrites.js#dropRoomTag calls "the decrement IS the
    // check".
    const { count } = await tx.vendingMachine.updateMany({
      where: {
        id: machine.id,
        OR: [{ holderId: null }, { holderSince: { lt: cutoff } }],
      },
      data: { holderId: character.id, holderSince: new Date(), unlocked: false },
    });
    took = count === 1;
    if (took) {
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_open",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id },
        },
      });
    }
  });
  if (!took) return fail(T.busy);

  const who = await presentedName(prisma, character.id);
  const text = T.roomOpened(who);
  await sayInRoom(prisma, room, text);
  // OK_QUIET, not a coin drop. Stepping up to the machine moves no money, and
  // COIN_INSERT is the payphone's "your obol went in" — playing it here had the
  // vendor chime like a purchase before anything had been paid for.
  return { ok: true, line: T.youHold(Math.round(VENDING_HOLD_MS / 1000)), text, sfx: SFX.OK_QUIET };
}

/**
 * Step away. The polite exit, and the one that hands the float back — walking
 * off deliberately is not the same as running out of time, which is the whole
 * point of having a button for it.
 */
async function releaseMachine(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room, machine } = actor;

  const gate = requireHold(machine, character.id);
  if (!gate.ok) return gate;

  // The amount comes back off the withdrawal rather than the read above: only
  // the holder can move the float, but the withdrawal is the statement that
  // actually settled, so it is the one that knows what left.
  let taken = 0;
  if (machine.floatObols > 0) {
    const out = await withdrawCoins(prisma, discordUserId, { roomId, turn });
    if (!out.ok) return out;
    taken = out.amount ?? 0;
  }

  await prisma.vendingMachine.updateMany({
    where: { id: machine.id, holderId: character.id },
    data: { holderId: null, holderSince: null, unlocked: false },
  });

  const who = await presentedName(prisma, character.id);
  const text = T.roomLeft(who);
  await sayInRoom(prisma, room, text);
  return {
    ok: true,
    amount: taken,
    line: taken > 0 ? T.youLeft : T.youLeftEmpty,
    text,
    sfx: taken > 0 ? SFX.COIN : null,
  };
}

/** The obol tag, or null if the catalog has not been synced. */
async function coinTag(db) {
  return db.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true, name: true } });
}

/** Coins out of a hand and into the slot. */
async function insertCoins(prisma, discordUserId, { roomId, amount, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room, machine } = actor;

  const gate = requireHold(machine, character.id);
  if (!gate.ok) return gate;

  const coin = await coinTag(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");

  const holding = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: coin.id } },
    select: { quantity: true },
  });
  const carried = holding?.quantity ?? 0;
  if (carried <= 0) return fail(T.noCoins);

  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n <= 0 || n > carried) return fail(T.insertAmount(carried));

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_INSERT", ...turnStamp(turn) };

  let total = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Room lock first, always (db/lib/tagWrites.js) — the machine hangs off a
      // Room, and taking the character lock first deadlocks against the stash.
      await lockRoom(tx, room.id);
      // ONE call books the WHOLE movement. dropCharacterTag's hook calls
      // recordTagMoney, which writes a single from -> to COIN row off the
      // `econ` below — it is not booking only the character's end. A second
      // hand-written record() here booked the same coins twice and left the
      // machine's ledger reading double its live balance, which is the exact
      // double-count economyLedger.js#bankParty exists to warn about.
      await dropCharacterTag(tx, character.id, coin.id, n, { econ: { from: me, to: box, ...econ } });
      const updated = await tx.vendingMachine.update({
        where: { id: machine.id },
        data: { floatObols: { increment: n } },
        select: { floatObols: true },
      });
      total = updated.floatObols;
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_insert",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id, amount: n, floatAfter: total },
        },
      });
    });
  } catch {
    return fail("The slot jammed. Try again.");
  }

  // No room line. A coin-by-coin announcement is noise at 100+ players, and
  // roomOpened already told the room somebody is at the machine.
  return { ok: true, amount: n, line: T.youInserted(n, total), sfx: SFX.COIN_INSERT };
}

/** Everything loose in the slot, back into a hand. */
async function withdrawCoins(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room, machine } = actor;

  const gate = requireHold(machine, character.id);
  if (!gate.ok) return gate;
  if (machine.floatObols <= 0) return fail(T.nothingToWithdraw);

  const coin = await coinTag(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_WITHDRAW", ...turnStamp(turn) };

  let taken = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      // The decrement IS the check: a conditional update against the amount we
      // read, so two presses cannot both empty the same slot.
      const { count } = await tx.vendingMachine.updateMany({
        where: { id: machine.id, floatObols: { gte: machine.floatObols } },
        data: { floatObols: { decrement: machine.floatObols } },
      });
      if (count !== 1) {
        const err = new Error(T.nothingToWithdraw);
        err.userMessage = err.message;
        throw err;
      }
      taken = machine.floatObols;
      // addToStack's hook books the whole machine -> character COIN row; see
      // insertCoins for why there is no second record() call beside it.
      await addToStack(tx, character.id, coin.id, taken, {
        source: "EVENT",
        stackable: true,
        econ: { from: box, to: me, ...econ },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_withdraw",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id, amount: taken },
        },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The slot jammed. Try again.");
  }

  return { ok: true, amount: taken, line: T.youWithdrew(taken), sfx: SFX.COIN };
}

/**
 * Buy one unit off the shelf. The coin does not move house — it goes from the
 * slot to the till, two trays in one box — so there is no COIN leg, only the
 * GOODS one the tag hook writes.
 */
async function buySlot(prisma, discordUserId, { roomId, tagId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const { character, room, machine } = actor;

  const gate = requireHold(machine, character.id);
  if (!gate.ok) return gate;

  const slot = (machine.slots ?? []).find((s) => s.tagId === tagId && s.quantity > 0);
  if (!slot) return fail(T.gone);
  const price = slot.priceObols;
  if (price > machine.floatObols) return fail(T.notEnough(price, machine.floatObols));

  const tag = slot.tag;
  // THE TRAP. db/lib/tagWrites.js#addToStack leaves an already-held
  // NON-stackable tag entirely alone and records nothing, returning the existing
  // row — so without this check the machine would take the coin and hand over
  // nothing at all. Refused BEFORE anything is charged.
  if (!tag?.stackable) {
    const already = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId } },
      select: { id: true },
    });
    if (already) return fail(T.alreadyHave(tag?.name ?? "one"));
  }

  // The ceiling, exactly as a Transfer applies it: goods land in a hand.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { carryWeightLbs: true },
  });
  const verdict = carryAdmits(character, config, { weightLbs: rowWeight({ tag, quantity: 1 }) });
  if (!verdict.ok) return fail(T.noRoom(verdict.reason));
  // One mount, up to 3 unruly or young arelitz (db/lib/mounts.js).
  const tooMany = holdLimitRefusal(character.tags, [{ slug: tag?.slug, quantity: 1 }]);
  if (tooMany) return fail(tooMany);

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_SALE", ...turnStamp(turn) };

  let leftInSlot = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      // The decrement IS the check, on both the shelf line and the float.
      const sold = await tx.vendingSlot.updateMany({
        where: { id: slot.id, quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      if (sold.count !== 1) {
        const err = new Error(T.gone);
        err.userMessage = err.message;
        throw err;
      }
      const paid = await tx.vendingMachine.updateMany({
        where: { id: machine.id, floatObols: { gte: price } },
        // Slot to till in one statement. Within one account, so nothing books.
        data: { floatObols: { decrement: price }, tillObols: { increment: price } },
      });
      if (paid.count !== 1) {
        const err = new Error(T.notEnough(price, machine.floatObols));
        err.userMessage = err.message;
        throw err;
      }
      // Poison rides with the goods. Drawn against the shelf row the same way
      // dropCharacterTag draws against a hand, and never surfaced to the buyer —
      // a warning is itself the tell (docs/systemdocs/MEDICAL.md).
      const poisoned = slot.poisonedCount
        ? drawPoisonedUnits(slot.quantity, slot.poisonedCount, 1)
        : 0;
      if (poisoned > 0) {
        await tx.vendingSlot.updateMany({
          where: { id: slot.id, poisonedCount: { gte: poisoned } },
          data: { poisonedCount: { decrement: poisoned } },
        });
      }
      await tx.vendingSlot.deleteMany({ where: { id: slot.id, quantity: { lte: 0 } } });

      await addToStack(tx, character.id, tagId, 1, {
        source: "EVENT",
        stackable: Boolean(tag?.stackable),
        expiresTurn: slot.expiresTurn ?? null,
        poisonedCount: poisoned,
        poisonPayload: poisoned > 0 ? slot.poisonPayload : null,
        // The GOODS leg, booked by the hook off this one option.
        econ: { from: box, to: me, ...econ },
      });

      const after = await tx.vendingMachine.findUnique({
        where: { id: machine.id },
        select: { floatObols: true },
      });
      leftInSlot = after?.floatObols ?? 0;

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_buy",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          // No poison in the details: an audit row a GM reads is fine, but this
          // one is also what auditNarrative renders, and that is read widely.
          details: { machineId: machine.id, tagId, name: tag?.name ?? null, price },
        },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The machine jammed. Try again.");
  }

  const who = await presentedName(prisma, character.id);
  // The room is told WHAT was bought — Bascinet's call, over a default that
  // named nobody's purchase. It makes the shelf worth watching and the buyer
  // worth following, which is the trade. T.roomBought is the anonymous
  // alternative, kept for if that is ever reversed.
  const text = T.roomBoughtNamed(who, tag?.name ?? "thing");
  await sayInRoom(prisma, room, text);

  return {
    ok: true,
    line: price > 0 ? T.youBought(tag?.name ?? "thing", price, leftInSlot) : T.youBoughtFree(tag?.name ?? "thing", leftInSlot),
    text,
    sfx: SFX.COIN,
  };
}

// ---------------------------------------------------------- the merchant's side

/** Both merchant gates at once: the licence, and a live hold of your own. */
function requireMerchant(actor, { needUnlocked = true } = {}) {
  const { character, machine, licensed } = actor;
  const gate = requireHold(machine, character.id);
  if (!gate.ok) return gate;
  if (!licensed) return fail(T.notYours);
  if (needUnlocked && !unlockedNow(machine)) return fail(T.lockedFirst);
  return { ok: true };
}

async function unlockMachine(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor, { needUnlocked: false });
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  await prisma.vendingMachine.updateMany({
    where: { id: machine.id, holderId: character.id },
    data: { unlocked: true },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "vending_unlock",
      targetCharacterId: character.id,
      roomId: room.id,
      turnId: turn?.id ?? null,
      details: { machineId: machine.id },
    },
  });

  const who = await presentedName(prisma, character.id);
  const text = T.roomUnlocked(who);
  await sayInRoom(prisma, room, text);
  return { ok: true, line: T.youUnlocked, text, sfx: SFX.EQUIP_LOCK };
}

async function lockMachine(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor);
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  await prisma.vendingMachine.updateMany({
    where: { id: machine.id, holderId: character.id },
    data: { unlocked: false },
  });

  const who = await presentedName(prisma, character.id);
  const text = T.roomLocked(who);
  await sayInRoom(prisma, room, text);
  return { ok: true, line: T.youLocked, text, sfx: SFX.EQUIP_LOCK };
}

/** The till into a hand. The float is not touched — it is not the merchant's. */
async function collectTill(prisma, discordUserId, { roomId, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor);
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  if (machine.tillObols <= 0) return fail(T.tillEmpty);

  const coin = await coinTag(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_TILL", ...turnStamp(turn) };

  let taken = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      const { count } = await tx.vendingMachine.updateMany({
        where: { id: machine.id, tillObols: { gte: machine.tillObols } },
        data: { tillObols: { decrement: machine.tillObols } },
      });
      if (count !== 1) {
        const err = new Error(T.tillEmpty);
        err.userMessage = err.message;
        throw err;
      }
      taken = machine.tillObols;
      // One booking, not two — see insertCoins.
      await addToStack(tx, character.id, coin.id, taken, {
        source: "EVENT",
        stackable: true,
        econ: { from: box, to: me, ...econ },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_collect",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id, amount: taken },
        },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The till jammed. Try again.");
  }

  const who = await presentedName(prisma, character.id);
  const text = T.roomTill(who);
  await sayInRoom(prisma, room, text);
  return { ok: true, amount: taken, line: T.youCollected(taken), text, sfx: SFX.COIN };
}

/** A stack out of a hand and onto the shelf. */
async function stockMachine(
  prisma,
  discordUserId,
  { roomId, tagId, quantity, priceObols = null, turn = null } = {},
) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor);
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  const holding = (character.tags ?? []).find((ct) => ct.tag?.id === tagId);
  const carried = holding?.quantity ?? 0;
  const n = Math.trunc(Number(quantity));
  const tag = holding?.tag;
  if (!tag) return fail(T.notInMachine);
  if (!Number.isFinite(n) || n <= 0 || n > carried) return fail(T.dontHave(tag.name, carried));
  if (!isTradeable(tag)) return fail(T.untradeable(tag.name));
  // Coin goes in the slot, not on the shelf. This is also what keeps the
  // machine off form BALANCE entirely — ⬢ is the one tag whose movement the
  // reconciliation actually covers (docs/systemdocs/ECONOMY.md §3).
  if (tag.slug === OBOL_SLUG || tag.slug === RESOURCES_SLUG) return fail(T.noMoneyOnShelf);

  const existing = (machine.slots ?? []).find((s) => s.tagId === tagId);
  if (!existing && (machine.slots ?? []).length >= VENDING_SHELF_CAP) {
    return fail(T.shelfFull(VENDING_SHELF_CAP));
  }
  // A price is only read for a NEW line, so topping up does not silently
  // re-price what is already in there.
  const price = existing ? existing.priceObols : validPrice(priceObols ?? 0);
  if (price === null) return fail(T.priceRange(VENDING_MAX_PRICE));

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_STOCK", ...turnStamp(turn) };

  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, character.id, tagId, n, {
        econ: { from: me, to: box, ...econ },
      });
      if (existing) {
        // "Poisons don't mix, they dilute" — db/lib/tagWrites.js's merge rule,
        // reused rather than reinvented: a differing payload is dropped and the
        // counts add.
        const same = !existing.poisonPayload || !poisonPayload || existing.poisonPayload === poisonPayload;
        await tx.vendingSlot.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: n },
            poisonedCount: existing.poisonedCount + poisonedTaken,
            poisonPayload: same ? (existing.poisonPayload ?? poisonPayload) : null,
          },
        });
      } else {
        await tx.vendingSlot.create({
          data: {
            machineId: machine.id,
            tagId,
            quantity: n,
            priceObols: price,
            poisonedCount: poisonedTaken,
            poisonPayload: poisonedTaken > 0 ? poisonPayload : null,
            expiresTurn: holding?.expiresTurn ?? null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_stock",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id, tagId, name: tag.name, quantity: n, price },
        },
      });
    });
  } catch {
    return fail("The shelf wouldn't take it. Try again.");
  }

  const who = await presentedName(prisma, character.id);
  const text = T.roomRestocked(who);
  await sayInRoom(prisma, room, text);
  return {
    ok: true,
    line: price > 0 ? T.youStockedIn(n, tag.name, price) : T.youStockedInFree(n, tag.name),
    text,
    // Goods onto a shelf, not coin into a slot.
    sfx: SFX.OK_QUIET,
  };
}

/** A shelf line back into a hand. Carry-checked: goods land in a hand. */
async function unstockMachine(prisma, discordUserId, { roomId, tagId, quantity, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor);
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  const slot = (machine.slots ?? []).find((s) => s.tagId === tagId && s.quantity > 0);
  if (!slot) return fail(T.notInMachine);
  const tag = slot.tag;
  const n = Math.trunc(Number(quantity));
  if (!Number.isFinite(n) || n <= 0 || n > slot.quantity) return fail(T.gone);

  // The same trap buySlot guards, for the same reason: addToStack pins a
  // non-stackable at 1 and no-ops entirely on one already held.
  const take = tag?.stackable ? n : 1;
  if (!tag?.stackable) {
    const already = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId } },
      select: { id: true },
    });
    if (already) return fail(T.alreadyHave(tag?.name ?? "one"));
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { carryWeightLbs: true },
  });
  const verdict = carryAdmits(character, config, { weightLbs: rowWeight({ tag, quantity: take }) });
  if (!verdict.ok) return fail(T.noRoom(verdict.reason));
  const tooMany = holdLimitRefusal(character.tags, [{ slug: tag?.slug, quantity: take }]);
  if (tooMany) return fail(tooMany);

  const me = characterParty(character);
  const box = machineParty({ id: machine.id, zoneId: room.location?.zoneId ?? null });
  const econ = { reason: "VENDING_STOCK", ...turnStamp(turn) };

  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      const poisoned = slot.poisonedCount
        ? drawPoisonedUnits(slot.quantity, slot.poisonedCount, take)
        : 0;
      const { count } = await tx.vendingSlot.updateMany({
        where: { id: slot.id, quantity: { gte: take }, poisonedCount: { gte: poisoned } },
        data: { quantity: { decrement: take }, poisonedCount: { decrement: poisoned } },
      });
      if (count !== 1) {
        const err = new Error(T.gone);
        err.userMessage = err.message;
        throw err;
      }
      await tx.vendingSlot.updateMany({
        where: { id: slot.id, poisonedCount: { lte: 0 }, poisonPayload: { not: null } },
        data: { poisonPayload: null },
      });
      await tx.vendingSlot.deleteMany({ where: { id: slot.id, quantity: { lte: 0 } } });
      await addToStack(tx, character.id, tagId, take, {
        source: "EVENT",
        stackable: Boolean(tag?.stackable),
        expiresTurn: slot.expiresTurn ?? null,
        poisonedCount: poisoned,
        poisonPayload: poisoned > 0 ? slot.poisonPayload : null,
        econ: { from: box, to: me, ...econ },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "vending_unstock",
          targetCharacterId: character.id,
          roomId: room.id,
          turnId: turn?.id ?? null,
          details: { machineId: machine.id, tagId, name: tag?.name ?? null, quantity: take },
        },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The shelf wouldn't give it up. Try again.");
  }

  const who = await presentedName(prisma, character.id);
  const text = T.roomRestocked(who);
  await sayInRoom(prisma, room, text);
  // Goods off a shelf. SFX.COIN here said a sale had happened when none had.
  return { ok: true, line: T.youStockedOut(take, tag?.name ?? "thing"), text, sfx: SFX.OK_QUIET };
}

/** Re-price a line that is already on the shelf. */
async function setSlotPrice(prisma, discordUserId, { roomId, tagId, priceObols, turn = null } = {}) {
  const actor = await vendingActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  const gate = requireMerchant(actor);
  if (!gate.ok) return gate;
  const { character, room, machine } = actor;

  const slot = (machine.slots ?? []).find((s) => s.tagId === tagId);
  if (!slot) return fail(T.notInMachine);
  const price = validPrice(priceObols);
  if (price === null) return fail(T.priceRange(VENDING_MAX_PRICE));

  await prisma.vendingSlot.update({ where: { id: slot.id }, data: { priceObols: price } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "vending_price",
      targetCharacterId: character.id,
      roomId: room.id,
      turnId: turn?.id ?? null,
      details: { machineId: machine.id, tagId, name: slot.tag?.name ?? null, price },
    },
  });

  const name = slot.tag?.name ?? "It";
  return {
    ok: true,
    line: price > 0 ? T.youPriced(name, price) : T.youPricedFree(name),
    // Writing a number on a label. Nothing moved at all.
    sfx: SFX.OK_QUIET,
  };
}

// --------------------------------------------------------- hooks and the sweep

/**
 * Let go of whatever this character was holding. Called when they move
 * (db/lib/locationMove.js), the way a phone call is hung up on relocation.
 *
 * THE FLOAT IS NOT TOUCHED. Walking out is not the same as pressing Step away:
 * the coin stays in the slot for the next customer, which is the rule.
 */
async function releaseHoldsForCharacter(prisma, characterId, reason = "left") {
  if (!characterId) return { freed: 0 };
  const { count } = await prisma.vendingMachine.updateMany({
    where: { holderId: characterId },
    data: { holderId: null, holderSince: null, unlocked: false },
  });
  if (count) console.log(`Vending: released ${count} hold(s) for ${characterId} (${reason}).`);
  return { freed: count };
}

/**
 * Frees a machine whose holder's five minutes have run out, who has died, or who
 * is no longer standing at the machine's Location — db/lib/phone.js#clearStaleCalls
 * in shape and for its stated reason: the hook list is never finished, and a
 * wedged machine should heal itself inside a minute whatever put it there.
 *
 * THE FLOAT IS NOT TOUCHED. A customer whose time ran out with coins still in
 * the slot leaves them there, loose, for the next customer to spend or take. It
 * does not sweep to the till and it is not posted back. That is the rule, and
 * this function's one job is to not break it.
 *
 * It is also only COSMETIC: `heldBy` has already let the next customer in by the
 * time this runs. What it adds is the room line, the DM and the audit row — so
 * the bot being down costs a line of scenery, not the feature.
 */
async function clearStaleHolds(prisma) {
  const cutoff = new Date(Date.now() - VENDING_HOLD_MS);
  const held = await prisma.vendingMachine.findMany({
    where: { holderId: { not: null } },
    select: {
      id: true,
      floatObols: true,
      holderSince: true,
      holder: { select: { id: true, status: true, locationId: true, discordUserId: true } },
      room: { select: { id: true, name: true, locationId: true, discordThreadId: true } },
    },
  });

  let freed = 0;
  for (const m of held) {
    const expired = !m.holderSince || m.holderSince < cutoff;
    const gone = !m.holder || m.holder.status !== "ALIVE";
    const walked = m.holder && m.room && m.holder.locationId !== m.room.locationId;
    if (!expired && !gone && !walked) continue;

    const { count } = await prisma.vendingMachine.updateMany({
      // Re-checked in the WHERE so a customer who claimed it between the read
      // and here is not thrown out of a hold they legitimately just took.
      where: { id: m.id, holderId: m.holder?.id ?? undefined },
      data: { holderId: null, holderSince: null, unlocked: false },
    });
    if (!count) continue;
    freed += 1;

    await prisma.auditLog
      .create({
        data: {
          // "system", not the holder: the sweep did this, not them. The column
          // is non-nullable, so a null here would throw on every expiry.
          actorDiscordUserId: "system",
          actionType: "vending_hold_expired",
          targetCharacterId: m.holder?.id ?? null,
          roomId: m.room?.id ?? null,
          details: { machineId: m.id, floatLeft: m.floatObols, why: expired ? "time" : gone ? "gone" : "left" },
        },
      })
      .catch(() => {});

    // ONLY on a real expiry, and it NAMES the holder — Bascinet's call, over a
    // default that said the lights went out and signed nobody. The line says
    // "their time is up", which is true of the clock running out and of nothing
    // else: a holder who died or walked off gets no line at all rather than one
    // that lies about why the machine is free.
    if (expired && m.room) {
      const who = m.holder?.id ? await presentedName(prisma, m.holder.id) : "Somebody";
      await sayInRoom(prisma, m.room, T.roomExpired(who));
    }

    // Only when there was something to lose. Being told you walked away from
    // nothing is worse than silence — the line no longer names the amount, so
    // this gate is the whole of what makes it worth sending.
    if (expired && m.floatObols > 0 && m.holder?.discordUserId) {
      await sendDm(prisma, m.holder.discordUserId, T.kicked).catch(() => {});
    }
  }
  return { freed };
}

/** The minute cron's entry point (bot/src/events/ready.js). */
async function tickVending(prisma) {
  return clearStaleHolds(prisma);
}

module.exports = {
  VENDING_HOLD_MS,
  VENDING_MAX_PRICE,
  VENDING_SHELF_CAP,
  VENDING_TEXT: T,
  heldBy,
  secondsLeftOn,
  unlockedNow,
  validPrice,
  timeLeftLine,
  ensureMachine,
  vendingActor,
  machineView,
  takeMachine,
  releaseMachine,
  insertCoins,
  withdrawCoins,
  buySlot,
  unlockMachine,
  lockMachine,
  collectTill,
  stockMachine,
  unstockMachine,
  setSlotPrice,
  releaseHoldsForCharacter,
  clearStaleHolds,
  tickVending,
};
