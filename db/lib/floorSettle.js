// What a character leaves lying on a floor does not stay in plain sight
// forever (docs/systemdocs/CARRY.md §6a, SEARCH.md §9a). A stack a player set
// down in a PUBLIC room sinks under the floor — RoomTag.quantity into
// RoomTag.hiddenQuantity — once it has lain there through one whole in-game
// day, and from then on only a Search brings it back up. A keyed room is a
// stash: what is left in one stays on the shelf.
//
// Two halves. The STAMP: every path that sets a character's things down in a
// room writes RoomTag.floorDay, the in-game day it happened, and a later drop
// onto the same stack writes it again, so the clock restarts. Nothing else
// stamps — a seed, the GM desk, the Vault's coin, a stable's foals, a
// structure's yield, a train's freight all stay where they were put. The
// SETTLE: a turn pass (db/index.js, `floorSettle`) sinks every stamped stack
// whose day is two or more behind the day the next turn opens on. Left on
// day 5, it is still there all of day 6 and gone when day 7 begins: at least
// one full day in view, never more than two.
//
// Takes `db` first (a PrismaClient or a transaction client), the db/lib/dm.js
// convention. Not on the @lifeweb/db barrel; require it by path.
const { turnDay } = require("./turnFormat");
const { RESOURCES_SLUG } = require("./resourceStack");

const FLOOR_SETTLE_AUDIT_ACTION = "floor_settled";

// How many in-game days a stack must be BEHIND the opening day to sink. 2 is
// "a whole day in view": the day it was left does not count, the next one
// does.
const SETTLE_AFTER_DAYS = 2;

// The in-game day right now: the open turn's, or between turns the last
// one's. Null before the first turn, which stamps nothing — so nothing can
// sink in a game that has not started.
async function floorDayNow(db) {
  const select = { number: true, dayNumber: true };
  const turn =
    (await db.turn.findFirst({ where: { status: "OPEN" }, select })) ??
    (await db.turn.findFirst({ orderBy: { number: "desc" }, select }));
  return turn ? turnDay(turn) : null;
}

// Marks what a character just set down in `roomId` as LEFT today. `tagIds`
// are the stacks it landed on, and `resources` adds the room's ⬢ stack
// (which moves on its own ledgered path, not as a tag line). A missing row
// (the Spillway ate it) is simply not matched. Call it inside the same
// transaction as the drop, after it.
async function stampLeftOnFloor(db, roomId, tagIds, { day, resources = false } = {}) {
  const ids = [...(tagIds ?? [])];
  if (resources) {
    const coin = await db.tag.findUnique({ where: { slug: RESOURCES_SLUG }, select: { id: true } });
    if (coin) ids.push(coin.id);
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (!roomId || unique.length === 0) return 0;
  const floorDay = day ?? (await floorDayNow(db));
  if (floorDay == null) return 0;
  const { count } = await db.roomTag.updateMany({
    where: { roomId, tagId: { in: unique }, quantity: { gt: 0 } },
    data: { floorDay },
  });
  return count;
}

// The rule, pure — the SQL in settleFloors says exactly this, and the test
// pins it here. `row` is the RoomTag, `room` and `tag` its parents.
//
// - Only a stamped stack with something on the floor, old enough.
// - Not a keyed room (non-empty accessTagSlugs): that is a stash.
// - Not the Spillway (destroysContents), which holds nothing to sink.
// - Not a Stable: db/lib/stablePass.js counts the herd on the floor.
// - Not a corpse: burial, rot and the death smell all look for it there.
// - Not a stack on an expiry clock: it rots in plain sight instead, so a
//   hidden stack never carries a clock (the expiry sweep relies on that).
function settles(row, room, tag, nextDay) {
  if (row?.floorDay == null || nextDay == null) return false;
  if (!((row.quantity ?? 0) > 0)) return false;
  if (row.floorDay > nextDay - SETTLE_AFTER_DAYS) return false;
  if (row.expiresTurn != null) return false;
  if ((room?.accessTagSlugs ?? []).length > 0) return false;
  if (room?.destroysContents || room?.stable) return false;
  if (tag?.corpseOfCharacterId) return false;
  return true;
}

// The pass. Sinks every stack `settles` would, in ONE statement, so a stack is
// never half-moved: the floor count and its poison go under together (poison
// keeps its payload on the row, counted in hiddenPoisonedCount until a Search
// brings it back up). The stamp is cleared, so it sinks once. Returns the
// rows it moved, for the audit line.
async function settleFloors(db, { nextDay }) {
  if (nextDay == null) return [];
  const cutoff = nextDay - SETTLE_AFTER_DAYS;
  return db.$queryRaw`
    UPDATE "RoomTag" AS rt
    SET "hiddenQuantity" = rt."hiddenQuantity" + rt."quantity",
        "hiddenPoisonedCount" = rt."hiddenPoisonedCount" + rt."poisonedCount",
        "quantity" = 0,
        "poisonedCount" = 0,
        "floorDay" = NULL
    FROM "Room" AS r, "Tag" AS t
    WHERE rt."roomId" = r."id"
      AND rt."tagId" = t."id"
      AND rt."floorDay" IS NOT NULL
      AND rt."floorDay" <= ${cutoff}
      AND rt."quantity" > 0
      AND rt."expiresTurn" IS NULL
      AND cardinality(r."accessTagSlugs") = 0
      AND r."destroysContents" = false
      AND r."stable" = false
      AND t."corpseOfCharacterId" IS NULL
    RETURNING rt."roomId" AS "roomId", rt."tagId" AS "tagId", rt."hiddenQuantity" AS "hiddenQuantity"`;
}

module.exports = {
  FLOOR_SETTLE_AUDIT_ACTION,
  SETTLE_AFTER_DAYS,
  floorDayNow,
  stampLeftOnFloor,
  settles,
  settleFloors,
};
