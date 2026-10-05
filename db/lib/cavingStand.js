// Where everybody stood when the turn locked, and what that makes of the Caving lens
// (docs/systemdocs/CAVING.md §5c). Takes `prisma` as a parameter — see db/lib/dm.js for why.
//
// Until the lock, each caver's 1s are ONE result of their own (cavingPass.js#troubleGroupWhere).
// At the lock, everybody standing in one Location becomes one result: every caver there with a
// 1, and every living character standing there without one. Cave walking is shut in the lock
// (turnGate.js#travelLockReason), so where they stand at the lock is where they wait for the push.
//
// There is no lock EVENT, so the freeze is a per-minute poll beside the Gambit cutoff
// (gambitCutoff.js, scheduled in bot/src/events/ready.js), sharing turnClock.js#cutoffReached, with a
// backstop at the push for a lock the bot was down for. It only ever adds rows: a later tick stamps
// somebody who arrived after the first (a GM's Teleport in the lock), never moves anybody already
// stamped — that place is the one the desk merged them by.
const { cutoffReached, moveWindow, TURN_CLOCK_SELECT } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { loadPresentedState } = require("./examineSnapshot");
const { presentationStamp } = require("./gmPresentation");
const { inCombatMode } = require("./combatMode");
const { troubleGroupWhere } = require("./cavingPass");

// The caver as they stood at the lock — the bystander's snapshot on the desk. Never fails the freeze:
// a snapshot that cannot be taken is a null column, and the desk says so.
async function lockSnapshot(prisma, characterId) {
  try {
    return (await loadPresentedState(prisma, characterId)).state ?? undefined;
  } catch (err) {
    console.error("Caving freeze: snapshot failed:", err.message ?? err);
    return undefined;
  }
}

// Stamps everybody who belongs on a merged result and has no stand yet: every living character
// standing underground, and every character with a 1 on the turn wherever they are (a GM may have
// moved one up already, and their result still needs a place). Idempotent — `skipDuplicates` on
// the (turn, character) key, so the bot's tick and the push's backstop can both run it.
async function freezeCavingStands(prisma, turn) {
  const [underground, failers, existing] = await Promise.all([
    prisma.character.findMany({
      where: { status: "ALIVE", location: { zone: { kind: "CAVE_LEVEL" } } },
      select: { id: true },
    }),
    prisma.cavingRoll.findMany({
      where: { turnId: turn.id, kind: "TROUBLE" },
      distinct: ["characterId"],
      select: { characterId: true },
    }),
    prisma.cavingStand.findMany({ where: { turnId: turn.id }, select: { characterId: true } }),
  ]);
  const stamped = new Set(existing.map((s) => s.characterId));
  const ids = [...new Set([...underground.map((c) => c.id), ...failers.map((r) => r.characterId)])].filter(
    (id) => !stamped.has(id),
  );
  if (!ids.length) return { stamped: 0 };

  const characters = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: { id: true, locationId: true, zoneId: true, combatModeSinceTurn: true, location: { select: { zoneId: true } } },
  });
  const data = [];
  for (const c of characters) {
    data.push({
      turnId: turn.id,
      characterId: c.id,
      locationId: c.locationId ?? null,
      zoneId: c.location?.zoneId ?? c.zoneId ?? null,
      presentedState: await lockSnapshot(prisma, c.id),
      presentedAs: (await presentationStamp(prisma, c.id)) ?? undefined,
      alert: inCombatMode(c),
    });
  }
  const { count } = await prisma.cavingStand.createMany({ data, skipDuplicates: true });
  return { stamped: count };
}

// The per-minute entry point, the runGambitCutoff shape. Idle is `{ ran: false }` and costs one
// indexed query; inside the lock it is three cheap reads a tick once everybody is stamped.
async function runCavingCutoff(db, { now = new Date() } = {}) {
  const turn = await db.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, ...TURN_CLOCK_SELECT },
  });
  if (!turn) return { ran: false };

  const { at } = cutoffReached(turn, { now, clockFrozen: await clockFrozen(db) });
  if (!at) return { ran: false };

  const { stamped } = await freezeCavingStands(db, turn);
  return { ran: true, stamped, turnNumber: turn.number };
}

// The push's backstop: a turn that HAD a lock is merged even if the bot never ticked inside it. A
// turn that never locks (a frozen clock, a turn shorter than its window) stays one result per
// caver — the desk never showed it merged, so History should not either.
async function freezeCavingStandsAtPush(prisma, turn) {
  const { hasLock } = moveWindow(turn, { clockFrozen: await clockFrozen(prisma) });
  if (!hasLock) return { stamped: 0, skipped: "no lock" };
  return freezeCavingStands(prisma, turn);
}

// One Caving result, worked out on the server from any roll in it — what Save, Mark resolved, the
// snapshot panel and a deep link all act on, never ids the desk sent. The same rule as the desk's
// fold (web/lib/cavingLabels.js#foldCavingResults):
//
//   the roll's caver has a stand  -> everybody stamped at that Location on the turn; `rolls` are
//                                    their 1s, `bystanderIds` the ones with none
//   no stand (before the lock)    -> the caver's own 1s, troubleGroupWhere
//
// `rolls` is oldest first, so `rolls[0]` is the result's anchor: the id the desk keys it by, where
// the Result box and anything staged on the desk hang. A QUIET or FIND roll is its own result.
async function cavingResultMembers(prisma, roll, { include } = {}) {
  const query = (where) =>
    prisma.cavingRoll.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...(include ? { include } : {}) });
  if (roll.kind !== "TROUBLE") {
    return { merged: false, locationId: roll.locationId ?? null, rolls: await query({ id: roll.id }), bystanderIds: [], stands: [] };
  }
  const stand = await prisma.cavingStand.findUnique({
    where: { turnId_characterId: { turnId: roll.turnId, characterId: roll.characterId } },
  });
  if (!stand) {
    return { merged: false, locationId: null, rolls: await query(troubleGroupWhere(roll)), bystanderIds: [], stands: [] };
  }
  const stands = stand.locationId
    ? await prisma.cavingStand.findMany({ where: { turnId: roll.turnId, locationId: stand.locationId } })
    : [stand];
  const rolls = await query({ turnId: roll.turnId, kind: "TROUBLE", characterId: { in: stands.map((s) => s.characterId) } });
  const failed = new Set(rolls.map((r) => r.characterId));
  return {
    merged: true,
    locationId: stand.locationId,
    rolls,
    bystanderIds: stands.map((s) => s.characterId).filter((id) => !failed.has(id)),
    stands,
  };
}

module.exports = {
  freezeCavingStands,
  freezeCavingStandsAtPush,
  runCavingCutoff,
  cavingResultMembers,
};
