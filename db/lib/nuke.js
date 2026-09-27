// The bomb (docs/systemdocs/NUKE.md, from Bascinet's "Nuclear bomb" design
// document). A fixture in one public room of the Town or the Fortress, like a
// phone on a wall, worked ONLY from its eight-digit keypad: key in the arming
// sequence and the button under the pad turns green; press it and the bomb is
// armed; key it in again and press again and it is disarmed.
//
// THREE THINGS ARE ROLLED EVERY GAME AND KEPT ON GameState: which room it is in
// (`nukeRoomId`), its code (`nukeCode`) and — once somebody arms it — the turn
// it goes off on (`nukeArmedTurn`). Start Game rolls the first two
// (db/lib/lobby.js#commitAssignment); a game already running when this landed
// rolls them for its first reader (ensureNuke). Restart Game recreates the row,
// so a new game can never inherit last game's bomb.
//
// WHAT HAPPENS WHEN IT GOES OFF is not here: db/lib/nukeExplosionPass.js reads
// `nukeArmedTurn` at turn close and ends the game.
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/phone.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter; require by path.

const { randomInt } = require("node:crypto");
const { blockerFor, ACT } = require("./incapacitation");
const { inFight } = require("./intercept");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { hasAttribute } = require("./locationAttributes");
const { logAudit } = require("./auditLog");
const { SFX } = require("./sfx");
const { NUKE_CODE_DIGITS, NUKE_MAX_STRIKES, NUKE_TEXT } = require("./nukeText");

// Turns between arming and the fireball (TAGS.md §5 duration counting): armed while turn T is open, fires as turn T+1 closes.
const NUKE_FUSE_TURNS = 2;

// "Any public locations within the town or the keep" — Bascinet settled "the
// keep" as the whole Fortress zone, less the Undercroft beneath it (and its
// Vault), the Charon (which leaves the map) and the Tower (every room in it is
// private anyway, which the PUBLIC filter already says).
const NUKE_ZONE_SLUGS = ["town", "fortress"];
const NUKE_EXCLUDED_LOCATION_PREFIXES = ["undertown-"];

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

/** Every room the bomb may be rolled into. */
async function nukeRooms(db) {
  const rooms = await db.room.findMany({
    where: {
      kind: "PUBLIC",
      questId: null,
      retiredAt: null,
      location: { retiredAt: null, zone: { slug: { in: NUKE_ZONE_SLUGS } } },
    },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, name: true, location: { select: { slug: true, name: true, attributes: true } } },
  });
  return rooms.filter(
    (room) =>
      !NUKE_EXCLUDED_LOCATION_PREFIXES.some((prefix) => room.location.slug.startsWith(prefix)) &&
      !hasAttribute(room.location, "offMap"),
  );
}

/** A fresh eight-digit sequence. Leading zeros are fine; it is a string. */
function rollCode(random = randomInt) {
  return Array.from({ length: NUKE_CODE_DIGITS }, () => String(random(0, 10))).join("");
}

/**
 * A new room and a new code, and the bomb unarmed. Called inside Start Game's
 * transaction, beside the phone numbers, so the bomb and the roles change
 * together. `random(min, maxExclusive)` is injectable for a test; the default
 * is crypto's, because a guessable code is no code.
 */
async function rollNuke(tx, random = randomInt) {
  const rooms = await nukeRooms(tx);
  const room = rooms.length ? rooms[random(0, rooms.length)] : null;
  const code = rollCode(random);
  await tx.gameState.update({
    where: { id: 1 },
    data: { nukeRoomId: room?.id ?? null, nukeCode: room ? code : null, nukeArmedTurn: null },
  });
  return { roomId: room?.id ?? null, code: room ? code : null };
}

/**
 * This game's bomb, rolling it first if nobody has — a game that was already
 * running when the bomb became a fixture. Usually one read and no write.
 * `rolled` is true only for the one caller whose write landed; that caller
 * also hands every living leader their note (db/lib/nukeBriefing.js).
 */
async function ensureNuke(db) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, select: { nukeRoomId: true, nukeCode: true } });
  if (!state) return null;
  if (state.nukeRoomId && state.nukeCode) return { roomId: state.nukeRoomId, code: state.nukeCode, rolled: false };

  const rooms = await nukeRooms(db);
  if (!rooms.length) return null;
  const room = rooms[randomInt(0, rooms.length)];
  // Guarded write: two first readers racing here both roll, and only the one
  // that finds the column still empty lands.
  const { count } = await db.gameState.updateMany({
    where: { id: 1, nukeRoomId: null },
    data: { nukeRoomId: room.id, nukeCode: rollCode() },
  });
  const after = await db.gameState.findUnique({ where: { id: 1 }, select: { nukeRoomId: true, nukeCode: true } });
  if (count) {
    // Lazily, because nukeBriefing requires this file back.
    await require("./nukeBriefing")
      .afterLazyRoll(db, after.nukeRoomId)
      .catch((err) => console.error("Bomb briefing backfill failed:", err));
  }
  return { roomId: after.nukeRoomId, code: after.nukeCode, rolled: count > 0 };
}

/** `rooms` with `nuke: true` on the one the bomb is in, for db/lib/placeAffordances.js. */
function markNukeRoom(rooms, nukeRoomId) {
  return rooms.map((room) => ({ ...room, nuke: Boolean(nukeRoomId) && room.id === nukeRoomId }));
}

/** Where the bomb is, as a room and its location's name, or null. */
async function nukePlace(db) {
  const bomb = await ensureNuke(db);
  if (!bomb?.roomId) return null;
  const room = await db.room.findUnique({
    where: { id: bomb.roomId },
    select: { id: true, name: true, location: { select: { id: true, name: true } } },
  });
  return room ? { ...bomb, room } : null;
}

const STATE_SELECT = {
  gameId: true,
  nukeRoomId: true,
  nukeCode: true,
  nukeArmedTurn: true,
  game: { select: { nukeDetonatedTurn: true } },
};

// Alive, able to act, standing in the bomb's Location, and able to get into
// its room — the gate stack db/lib/phone.js#phoneActor uses, re-run on every
// press because a dialog and a Discord keypad both outlive somebody walking off.
// And NOT IN A FIGHT (Bascinet, 2026-09-27): somebody who attacked or was
// attacked this turn cannot touch the keypad — the same running-fight hold
// Pickpocket reads (db/lib/intercept.js#inFight). Being on guard in combat mode
// is not a fight, and does not stop anybody.
async function keypadActor(prisma, discordUserId, roomId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      discordUserId: true,
      heldUntil: true,
      heldReason: true,
      tags: { include: { tag: true } },
    },
  });
  if (!character) return fail("You don't have a living character.");

  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: STATE_SELECT });
  if (!state?.nukeRoomId || !roomId || state.nukeRoomId !== roomId) return fail(NUKE_TEXT.noBomb);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, slug: true, name: true, kind: true, locationId: true, accessTagSlugs: true, retiredAt: true },
  });
  if (!room || room.retiredAt) return fail(NUKE_TEXT.noBomb);
  if (character.locationId !== room.locationId) return fail(NUKE_TEXT.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(`You can't act — you're ${blocker.name}.`);
  if (inFight(character)) return fail(NUKE_TEXT.inFight, { inFight: true });

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail("You can't get in there.");
  }
  const lockout = await prisma.nukeLockout.findUnique({ where: { characterId: character.id } });
  return { ok: true, character, room, state, lockout };
}

// What the dialog and the Discord keypad draw from. Never the code.
function viewOf(actor, extra = {}) {
  const { state, lockout } = actor;
  const strikes = lockout?.lockedAt ? NUKE_MAX_STRIKES : (lockout?.streak ?? 0);
  return {
    ok: true,
    roomId: actor.room.id,
    armed: state.nukeArmedTurn != null,
    firesOn: state.nukeArmedTurn ?? null,
    gone: state.game?.nukeDetonatedTurn != null,
    lockedOut: Boolean(lockout?.lockedAt),
    triesLeft: Math.max(0, NUKE_MAX_STRIKES - strikes),
    ...extra,
  };
}

/** The keypad as this character finds it. */
async function nukeView(prisma, discordUserId, roomId) {
  const actor = await keypadActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  return viewOf(actor);
}

const isSequence = (digits) => typeof digits === "string" && new RegExp(`^[0-9]{${NUKE_CODE_DIGITS}}$`).test(digits);

// One try at the code, counted. Locks the character's lockout row so two tabs
// keying at once cannot both get a third try in. Returns the row as it now is.
async function countTry(prisma, characterId, correct) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "NukeLockout" ("characterId", "streak", "updatedAt") VALUES (${characterId}, 0, now()) ON CONFLICT ("characterId") DO NOTHING`;
    const [row] = await tx.$queryRaw`SELECT "streak", "lockedAt" FROM "NukeLockout" WHERE "characterId" = ${characterId} FOR UPDATE`;
    if (row?.lockedAt) return { streak: NUKE_MAX_STRIKES, lockedAt: row.lockedAt, refused: true };
    const streak = correct ? 0 : (row?.streak ?? 0) + 1;
    const lockedAt = streak >= NUKE_MAX_STRIKES ? new Date() : null;
    return tx.nukeLockout.update({ where: { characterId }, data: { streak, lockedAt } });
  });
}

// The refusal a wrong sequence earns, with the tries left or the lockout.
function wrongAnswer(actor, row) {
  const lockedOut = Boolean(row.lockedAt);
  const left = Math.max(0, NUKE_MAX_STRIKES - row.streak);
  const error = lockedOut ? `${NUKE_TEXT.wrong} ${NUKE_TEXT.lockedOut}` : `${NUKE_TEXT.wrong} ${NUKE_TEXT.triesLeft(left)}`;
  return fail(error, {
    ...viewOf(actor, { lockedOut, triesLeft: lockedOut ? 0 : left }),
    ok: false,
    correct: false,
    // The terminal's warble, not the ordinary refusal: the machine is answering.
    sfx: SFX.CONSOLE_REFUSE,
  });
}

/**
 * The eighth digit went in. A right sequence turns the button green (and
 * clears the run of wrong ones); a wrong one is a strike, and the third in a
 * row locks this character out of the keypad for the rest of the game.
 */
async function nukeCheck(prisma, discordUserId, roomId, digits) {
  const actor = await keypadActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  if (actor.state.game?.nukeDetonatedTurn != null) return fail(NUKE_TEXT.gone);
  if (actor.lockout?.lockedAt) return fail(NUKE_TEXT.lockedOut, { lockedOut: true });
  if (!isSequence(digits)) return fail(NUKE_TEXT.notDigits);

  const correct = digits === actor.state.nukeCode;
  const row = await countTry(prisma, actor.character.id, correct);
  if (row.refused) return fail(NUKE_TEXT.lockedOut, { lockedOut: true });
  if (!correct) return wrongAnswer(actor, row);
  return viewOf({ ...actor, lockout: row }, { correct: true, sfx: SFX.NUKE_PING });
}

/**
 * The green button. Arms the bomb if it is safe, disarms it if it is armed —
 * and only for somebody holding the right sequence, checked again here, since
 * the button's colour is a hint and a server action is a public endpoint. A
 * wrong sequence arriving here counts as a strike like any other.
 */
async function nukePress(prisma, discordUserId, roomId, digits, { turn = null } = {}) {
  const actor = await keypadActor(prisma, discordUserId, roomId);
  if (!actor.ok) return actor;
  if (actor.lockout?.lockedAt) return fail(NUKE_TEXT.lockedOut, { lockedOut: true });
  if (!isSequence(digits)) return fail(NUKE_TEXT.notDigits);
  if (digits !== actor.state.nukeCode) {
    const row = await countTry(prisma, actor.character.id, false);
    if (row.refused) return fail(NUKE_TEXT.lockedOut, { lockedOut: true });
    return wrongAnswer(actor, row);
  }
  if (!turn) return fail(NUKE_TEXT.noTurn);

  const outcome = await prisma.$transaction(async (tx) => {
    // Serialise every press: two people at the keypad (or one on two faces)
    // must not both arm, or arm and disarm past each other.
    await tx.$queryRaw`SELECT id FROM "GameState" WHERE id = 1 FOR UPDATE`;
    const state = await tx.gameState.findUnique({ where: { id: 1 }, select: STATE_SELECT });
    if (state?.game?.nukeDetonatedTurn != null) return { error: NUKE_TEXT.gone };
    if (state?.nukeRoomId !== roomId) return { error: NUKE_TEXT.noBomb };
    const arming = state.nukeArmedTurn == null;
    // Armed while turn T is open, it goes at the close of T+1.
    const firesOn = arming ? turn.number + NUKE_FUSE_TURNS - 1 : null;
    await tx.gameState.update({ where: { id: 1 }, data: { nukeArmedTurn: firesOn } });
    await tx.nukeLockout.updateMany({ where: { characterId: actor.character.id }, data: { streak: 0 } });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: arming ? "nuke_armed" : "nuke_disarmed",
      targetCharacterId: actor.character.id,
      turnId: turn.id ?? null,
      details: arming
        ? { firesOn, armedOnTurn: turn.number, gameId: state.gameId ?? null, roomId }
        : { wasFiringOn: state.nukeArmedTurn, disarmedOnTurn: turn.number, gameId: state.gameId ?? null, roomId },
      place: { locationId: actor.room.locationId, roomId },
    });
    return { arming, firesOn, state: { ...state, nukeArmedTurn: firesOn } };
  });
  if (outcome.error) return fail(outcome.error);
  return viewOf(
    { ...actor, state: outcome.state, lockout: actor.lockout ? { ...actor.lockout, streak: 0 } : null },
    {
      correct: true,
      line: outcome.arming ? NUKE_TEXT.armed(outcome.firesOn) : NUKE_TEXT.disarmed,
      sfx: outcome.arming ? SFX.NUKE_ARM : SFX.NUKE_DISARM,
    },
  );
}

module.exports = {
  NUKE_FUSE_TURNS,
  NUKE_ZONE_SLUGS,
  nukeRooms,
  rollCode,
  rollNuke,
  ensureNuke,
  markNukeRoom,
  nukePlace,
  nukeView,
  nukeCheck,
  nukePress,
};
