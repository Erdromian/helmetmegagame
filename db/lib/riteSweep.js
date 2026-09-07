// The minute sweep behind the rites (docs/systemdocs/THANATI.md): expires
// attempts nobody finished in twelve hours, fires the READY ones once their
// two-minute grace has run, and cancels any whose room has gone. The bot runs
// it every minute (bot/src/events/ready.js); firing is therefore within a
// minute of the mark, not on the second.
//
// Firing re-checks the floor — somebody may have pocketed the heart — and a
// missing ingredient sends the attempt back to OPEN with its clock cleared,
// so more chanting can arm it again inside the window. Takes `db` as a
// parameter, the db/lib/dm.js convention.
const { WINDOW_MS, riteByKey, floorIngredients } = require("./rites");
const { floorHas, distinctChanters } = require("./riteChant");
const { dropRoomTag } = require("./tagWrites");

async function consumeFloor(tx, rite, roomId) {
  for (const need of floorIngredients(rite)) {
    if (need.resources) {
      const { count } = await tx.room.updateMany({
        where: { id: roomId, resources: { gte: need.resources } },
        data: { resources: { decrement: need.resources } },
      });
      if (count === 0) return false;
    }
    if (need.tag) {
      const tag = await tx.tag.findUnique({ where: { slug: need.tag }, select: { id: true } });
      if (!tag) return false;
      if (!(await dropRoomTag(tx, roomId, tag.id, need.count ?? 1))) return false;
    }
  }
  return true;
}

async function fireAttempt(db, attempt) {
  const rite = riteByKey(attempt.riteKey);
  if (!rite) {
    await db.riteAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED" } });
    return { fired: false };
  }
  const room = await db.room.findUnique({
    where: { id: attempt.roomId },
    select: { id: true, name: true, locationId: true, discordThreadId: true },
  });
  if (!room) {
    await db.riteAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED" } });
    return { fired: false };
  }

  // Gone off the floor since READY: back to OPEN, clock cleared.
  if (!(await floorHas(db, rite, room.id))) {
    await db.riteAttempt.update({
      where: { id: attempt.id },
      data: { status: "OPEN", readyAt: null, firesAt: null },
    });
    return { fired: false, rearmed: true };
  }

  const chanters = await distinctChanters(db, attempt.id);
  const alive = await db.character.findMany({
    where: { id: { in: chanters.map((c) => c.characterId) }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  const participants = alive.map((c) => ({ characterId: c.id, name: c.name, discordUserId: c.discordUserId }));

  let result = null;
  await db.$transaction(async (tx) => {
    // Claim it first: a second sweep racing this one finds nothing to fire.
    const { count } = await tx.riteAttempt.updateMany({
      where: { id: attempt.id, status: "READY" },
      data: { status: "FIRED", firedAt: new Date() },
    });
    if (count === 0) return;
    if (!(await consumeFloor(tx, rite, room.id))) {
      throw new Error("floor changed under the rite");
    }
    result = rite.run
      ? await rite.run({ tx, rite, attempt, room, participants })
      : { unscripted: true };
    await tx.riteAttempt.update({
      where: { id: attempt.id },
      data: { participants, result },
    });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: participants[0]?.discordUserId ?? "system",
        actionType: "rite_fired",
        details: { rite: rite.name, riteKey: rite.key, room: room.name, roomId: room.id, participants, result },
      },
    });
  }).catch(async (err) => {
    // The claim rolled back with everything else, so the attempt is READY
    // again and the next tick retries or re-arms it.
    console.error(`Rite ${rite.key} in ${room.name} did not fire:`, err.message ?? err);
    result = null;
  });

  return { fired: result != null, rite, room, participants, result };
}

async function runRiteSweep(db) {
  const now = new Date();
  const expired = await db.riteAttempt.updateMany({
    where: { status: "OPEN", openedAt: { lt: new Date(now.getTime() - WINDOW_MS) } },
    data: { status: "EXPIRED" },
  });

  const due = await db.riteAttempt.findMany({
    where: { status: "READY", firesAt: { lte: now } },
    orderBy: { firesAt: "asc" },
  });
  let fired = 0;
  for (const attempt of due) {
    const outcome = await fireAttempt(db, attempt);
    if (outcome.fired) fired += 1;
  }
  return { expired: expired.count, fired };
}

module.exports = { runRiteSweep, fireAttempt };
