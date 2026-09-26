// node --test over what a zone crossing costs in travel (db/lib/crossingCost.js,
// MAP.md §3) and how a crossing is charged to the two pools
// (db/lib/locationTravel.js#crossingClaim). Pure: plain objects, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crossingCost, formatTravel, TOWN_ZONE_SLUGS, NEAR_CROSSING_COST, FAR_CROSSING_COST } = require("../lib/crossingCost");
const { crossingClaim, freeMovesLeft } = require("../lib/locationTravel");

test("crossingCost: ½ between the town zones, 1 anywhere else, 0 inside a zone", () => {
  assert.deepEqual([...TOWN_ZONE_SLUGS].sort(), ["fortress", "town", "undertown"]);
  assert.equal(crossingCost("town", "fortress"), NEAR_CROSSING_COST);
  assert.equal(crossingCost("fortress", "undertown"), 0.5);
  assert.equal(crossingCost("undertown", "town"), 0.5);
  assert.equal(crossingCost("town", "hills"), FAR_CROSSING_COST);
  assert.equal(crossingCost("hills", "town"), 1);
  assert.equal(crossingCost("undertown", "underground"), 1);
  assert.equal(crossingCost("hills", "underground"), 1);
  assert.equal(crossingCost("town", "town"), 0);
  // No slug to go on: 0 here, and the mover charges FAR_CROSSING_COST instead.
  assert.equal(crossingCost(null, "town"), 0);
});

test("formatTravel: halves read as ½, never 0.5", () => {
  assert.equal(formatTravel(0), "0");
  assert.equal(formatTravel(0.5), "½");
  assert.equal(formatTravel(1), "1");
  assert.equal(formatTravel(1.5), "1½");
  assert.equal(formatTravel(2), "2");
  assert.equal(formatTravel(null), "0");
  assert.equal(formatTravel(-1), "0");
});

const TURN = { id: "t1" };
const CONFIG = { freeZoneMovesPerTurn: 1 };
const fresh = { zoneMovesTurnId: null, zoneMovesUsed: 0, zoneMovesBonusUsed: 0 };
const spent = (used, bonusUsed = 0) => ({ zoneMovesTurnId: TURN.id, zoneMovesUsed: used, zoneMovesBonusUsed: bonusUsed });
const onFoot = { base: 1, bonus: 0 };
const riding = { base: 1, bonus: 1 };

test("crossingClaim: a town hop takes ½, a far one 1, and the rest stays for a cheaper hop", () => {
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 0.5, zoneMovesBonusUsed: 0, left: 0.5 });
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, left: 0 });
  assert.deepEqual(crossingClaim(onFoot, spent(0.5), TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, left: 0 });
});

test("crossingClaim: the mount's pool goes first and a crossing can straddle the two", () => {
  // A far crossing on a fresh ride: all of it on the arelitz.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 1, left: 1 });
  // A town hop, then a far crossing: ½ left on the arelitz, the other ½ off the base.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 0.5, zoneMovesBonusUsed: 0.5, left: 1.5 });
  assert.deepEqual(crossingClaim(riding, spent(0.5, 0.5), TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1.5, zoneMovesBonusUsed: 1, left: 0.5 });
  // Then the arelitz is parked indoors: the base travel that was never spent is still there.
  assert.equal(freeMovesLeft({ tags: [], ...spent(1.5, 1) }, CONFIG, TURN), 0.5);
});

test("crossingClaim: last turn's counters are reset by the same write", () => {
  const yesterday = { zoneMovesTurnId: "t0", zoneMovesUsed: 1, zoneMovesBonusUsed: 0 };
  assert.deepEqual(crossingClaim(onFoot, yesterday, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, left: 0 });
});

test("crossingClaim: a push on overspends the base pool alone", () => {
  // ½ travel left, a far crossing wanted: the push on charges the full cost
  // to the base, which is what exertedThisTurn reads back, and never the bonus.
  assert.deepEqual(crossingClaim(onFoot, spent(0.5), TURN, 1, { exert: true }), { zoneMovesTurnId: "t1", zoneMovesUsed: 1.5, zoneMovesBonusUsed: 0, left: 0 });
});
