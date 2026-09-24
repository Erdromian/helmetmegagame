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
// SETTLE: a turn pass (db/index.js, `floorSettle`) sinks a stamped stack
// whose day is two or more behind the day the next turn opens on. Left on
// day 5, it is still there all of day 6 and can go when day 7 begins: at
// least one full day in view. Only loose objects sink (canSink), and only
// out of a cluttered floor (planSettle): a room showing fewer than three
// stacks loses nothing.
//
// Takes `db` first (a PrismaClient or a transaction client), the db/lib/dm.js
// convention. Not on the @lifeweb/db barrel; require it by path.
const { turnDay } = require("./turnFormat");
const { RESOURCES_SLUG } = require("./resourceStack");
const { TAG_CATEGORY } = require("./constants");

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

// Which THINGS can be lost under a floor at all. Only loose objects: the
// Items category (⬢ and coin included) — Tag.category holds the display name,
// "Items", and is compared case-folded because older runtime minters wrote
// the YAML slug (db/lib/constants.js#TAG_CATEGORY). Never an asset — an arelitz, a
// dog, a cart, a bird — and never a building (a `placement:` tag, which is
// every one of them). Never a corpse of either kind (`corpseKind`): burial,
// rot, butchering and the death smell all look for it on the floor. And never
// anything heavy enough that nobody could overlook it — HEAVY_LBS and up, the
// workbench, the Packaging Equipment, a suit of plate, the device.
const SINKABLE_CATEGORY = TAG_CATEGORY.ITEMS.toLowerCase();
const HEAVY_LBS = 40;

function canSink(tag) {
  if (!tag || String(tag.category ?? "").toLowerCase() !== SINKABLE_CATEGORY) return false;
  if (tag.corpseKind || tag.corpseOfCharacterId) return false;
  if (tag.placement != null) return false;
  if ((tag.weightLbs ?? 0) >= HEAVY_LBS) return false;
  return true;
}

// Whether ONE stack is ready to sink, pure. `row` is the RoomTag, `room`
// and `tag` its parents. Whether it actually does is also up to how much
// else is on that floor — see planSettle.
//
// - Only a stamped stack with something on the floor, old enough.
// - Not a keyed room (non-empty accessTagSlugs): that is a stash.
// - Not the Spillway (destroysContents), which holds nothing to sink.
// - Not a Stable: db/lib/stablePass.js counts the herd on the floor.
// - Not a stack on an expiry clock: it rots in plain sight instead, so a
//   hidden stack never carries a clock (the expiry sweep relies on that).
// - Only a thing canSink allows.
function settles(row, room, tag, nextDay) {
  if (row?.floorDay == null || nextDay == null) return false;
  if (!((row.quantity ?? 0) > 0)) return false;
  if (row.floorDay > nextDay - SETTLE_AFTER_DAYS) return false;
  if (row.expiresTurn != null) return false;
  if ((room?.accessTagSlugs ?? []).length > 0) return false;
  if (room?.destroysContents || room?.stable) return false;
  return canSink(tag);
}

// Things only get lost in CLUTTER. A stack sinks only while the room shows at
// least MIN_VISIBLE_TO_SINK stacks on its floor, counting itself and counting
// everything (an arelitz, the ⬢, a stack that never sinks). One at a time,
// oldest drop first, and each one that goes takes one off the count — so a
// floor is never swallowed below MIN_VISIBLE_TO_SINK - 1: two things lying in
// a room are two things anybody would see.
const MIN_VISIBLE_TO_SINK = 3;

// Pure. `visible` is how many stacks the floor shows now; `ready` the rows
// `settles` passed for this room. Returns the ones to sink, in order.
function planSettle(visible, ready) {
  const queue = [...(ready ?? [])].sort((a, b) => a.floorDay - b.floorDay || String(a.id).localeCompare(String(b.id)));
  const out = [];
  let showing = visible;
  for (const row of queue) {
    if (showing < MIN_VISIBLE_TO_SINK) break;
    out.push(row);
    showing -= 1;
  }
  return out;
}

// The pass. Reads every stamped, old-enough stack, keeps the ones `settles`
// allows, and then works ONE ROOM AT A TIME under that Room's row lock (the
// lock every stash writer takes, tagWrites.js#lockRoom), so a Take landing
// mid-pass is counted rather than raced: the floor is counted again under the
// lock, and planSettle decides from that.
//
// Each sink is one guarded UPDATE, so a stack is never half-moved: the floor
// count and its poison go under together (the payload stays on the row,
// counted in hiddenPoisonedCount until a Search brings it back up). The stamp
// is cleared, so it sinks once. A stack held back because the floor is too
// bare keeps its stamp, and sinks on a later pass if the room fills up.
// Returns the rows it moved, for the audit line.
async function settleFloors(db, { nextDay }) {
  if (nextDay == null) return [];
  const cutoff = nextDay - SETTLE_AFTER_DAYS;
  const stale = await db.roomTag.findMany({
    where: { floorDay: { not: null, lte: cutoff }, quantity: { gt: 0 }, expiresTurn: null },
    select: {
      id: true,
      roomId: true,
      tagId: true,
      quantity: true,
      floorDay: true,
      expiresTurn: true,
      room: { select: { accessTagSlugs: true, destroysContents: true, stable: true } },
      tag: { select: { category: true, corpseKind: true, corpseOfCharacterId: true, placement: true, weightLbs: true } },
    },
  });
  const byRoom = new Map();
  for (const row of stale) {
    if (!settles(row, row.room, row.tag, nextDay)) continue;
    if (!byRoom.has(row.roomId)) byRoom.set(row.roomId, []);
    byRoom.get(row.roomId).push(row);
  }

  const settled = [];
  for (const [roomId, ready] of byRoom) {
    const moved = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      const visible = await tx.roomTag.count({ where: { roomId, quantity: { gt: 0 } } });
      const out = [];
      for (const row of planSettle(visible, ready)) {
        const rows = await tx.$queryRaw`
          UPDATE "RoomTag"
          SET "hiddenQuantity" = "hiddenQuantity" + "quantity",
              "hiddenPoisonedCount" = "hiddenPoisonedCount" + "poisonedCount",
              "quantity" = 0,
              "poisonedCount" = 0,
              "floorDay" = NULL
          WHERE "id" = ${row.id}
            AND "quantity" > 0
            AND "expiresTurn" IS NULL
            AND "floorDay" IS NOT NULL
            AND "floorDay" <= ${cutoff}
          RETURNING "roomId", "tagId", "hiddenQuantity"`;
        out.push(...rows);
      }
      return out;
    });
    settled.push(...moved);
  }
  return settled;
}

module.exports = {
  FLOOR_SETTLE_AUDIT_ACTION,
  SETTLE_AFTER_DAYS,
  MIN_VISIBLE_TO_SINK,
  HEAVY_LBS,
  canSink,
  planSettle,
  floorDayNow,
  stampLeftOnFloor,
  settles,
  settleFloors,
};
