// node --test over what a zone crossing costs in travel (db/lib/crossingCost.js,
// MAP.md §3) and how a crossing is charged to the two pools
// (db/lib/locationTravel.js#crossingClaim). Pure: plain objects, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crossingCost, TOWN_ZONE_SLUGS, NEAR_CROSSING_COST, FAR_CROSSING_COST } = require("../lib/crossingCost");
const { crossingClaim, freeMovesLeft } = require("../lib/locationTravel");

test("crossingCost: 1 between the town zones, 2 anywhere else, 0 inside a zone", () => {
  assert.deepEqual([...TOWN_ZONE_SLUGS].sort(), ["fortress", "town", "undertown"]);
  assert.equal(crossingCost("town", "fortress"), NEAR_CROSSING_COST);
  assert.equal(crossingCost("fortress", "undertown"), 1);
  assert.equal(crossingCost("undertown", "town"), 1);
  assert.equal(crossingCost("town", "hills"), FAR_CROSSING_COST);
  assert.equal(crossingCost("hills", "town"), 2);
  assert.equal(crossingCost("undertown", "underground"), 2);
  assert.equal(crossingCost("hills", "underground"), 2);
  assert.equal(crossingCost("town", "town"), 0);
  // A zone with no slug is not a town crossing: charged in full, never for free.
  assert.equal(crossingCost(null, "town"), 0);
});

const TURN = { id: "t1" };
const CONFIG = { freeZoneMovesPerTurn: 2 };
const fresh = { zoneMovesTurnId: null, zoneMovesUsed: 0, zoneMovesBonusUsed: 0 };
const spent = (used, bonusUsed = 0) => ({ zoneMovesTurnId: TURN.id, zoneMovesUsed: used, zoneMovesBonusUsed: bonusUsed });
const onFoot = { base: 2, bonus: 0 };
const riding = { base: 2, bonus: 2 };

test("crossingClaim: a town hop takes 1, a far one 2, and the rest stays for a cheaper hop", () => {
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, left: 1 });
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 2), { zoneMovesTurnId: "t1", zoneMovesUsed: 2, zoneMovesBonusUsed: 0, left: 0 });
  assert.deepEqual(crossingClaim(onFoot, spent(1), TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 2, zoneMovesBonusUsed: 0, left: 0 });
});

test("crossingClaim: the mount's pool goes first and a crossing can straddle the two", () => {
  // A far crossing on a fresh ride: all of it on the arelitz.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 2), { zoneMovesTurnId: "t1", zoneMovesUsed: 2, zoneMovesBonusUsed: 2, left: 2 });
  // A town hop, then a far crossing: 1 left on the arelitz, the other 1 off the base.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 1, left: 3 });
  assert.deepEqual(crossingClaim(riding, spent(1, 1), TURN, 2), { zoneMovesTurnId: "t1", zoneMovesUsed: 3, zoneMovesBonusUsed: 2, left: 1 });
  // Then the arelitz is parked indoors: the base travel that was never spent is still there.
  assert.equal(freeMovesLeft({ tags: [], ...spent(3, 2) }, CONFIG, TURN), 1);
});

test("crossingClaim: last turn's counters are reset by the same write", () => {
  const yesterday = { zoneMovesTurnId: "t0", zoneMovesUsed: 2, zoneMovesBonusUsed: 0 };
  assert.deepEqual(crossingClaim(onFoot, yesterday, TURN, 2), { zoneMovesTurnId: "t1", zoneMovesUsed: 2, zoneMovesBonusUsed: 0, left: 0 });
});

test("crossingClaim: a push on overspends the base pool alone", () => {
  // 1 travel left, a far crossing wanted: the push on charges the full cost
  // to the base, which is what exertedThisTurn reads back, and never the bonus.
  assert.deepEqual(crossingClaim(onFoot, spent(1), TURN, 2, { exert: true }), { zoneMovesTurnId: "t1", zoneMovesUsed: 3, zoneMovesBonusUsed: 0, left: 0 });
});
