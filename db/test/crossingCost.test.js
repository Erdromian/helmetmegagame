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
// A fresh arelitz: 2 rides, each worth a far crossing (FAR_CROSSING_COST, 1)
// in the summed number — so 2 travel of bonus. The rides live on the mount's
// own tag (db/lib/mounts.js), which is why nothing below subtracts
// zoneMovesBonusUsed from the bonus: after a ride the caller hands in the
// NEXT rung's allowance, and that is the whole memory.
const riding = { base: 1, bonus: 2 };
const riddenOnce = { base: 1, bonus: 1 };
const spentMount = { base: 1, bonus: 0 };

test("crossingClaim: a town hop takes ½, a far one 1, and the rest stays for a cheaper hop", () => {
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 0.5, zoneMovesBonusUsed: 0, rode: false, left: 0.5 });
  assert.deepEqual(crossingClaim(onFoot, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, rode: false, left: 0 });
  assert.deepEqual(crossingClaim(onFoot, spent(0.5), TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, rode: false, left: 0 });
});

test("crossingClaim: a ride covers a whole crossing, near or far, and the mount goes first", () => {
  // A far crossing on a fresh arelitz: all of it on the animal, one ride gone.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 1, rode: true, left: 2 });
  // A town hop (½) on the same animal still costs it a whole ride — no
  // straddle, no half-ride left on the rung.
  assert.deepEqual(crossingClaim(riding, fresh, TURN, 0.5), { zoneMovesTurnId: "t1", zoneMovesUsed: 0.5, zoneMovesBonusUsed: 0.5, rode: true, left: 2 });
  // The second crossing is asked with the NEXT rung's allowance (the ride
  // already moved the tag): one ride left, and it is spent the same way.
  assert.deepEqual(crossingClaim(riddenOnce, spent(0.5, 0.5), TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1.5, zoneMovesBonusUsed: 1.5, rode: true, left: 1 });
  // A spent mount buys nothing, so the base pays — and the base is still whole.
  assert.deepEqual(crossingClaim(spentMount, spent(1.5, 1.5), TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 2.5, zoneMovesBonusUsed: 1.5, rode: false, left: 0 });
});

test("a ride is never counted twice: once off the rider's counters and again off the animal", () => {
  // After one far crossing on a fresh arelitz the counters read 1 used, 1 of
  // it on the mount, and the tag is one rung down. What is left must be the
  // base 1 plus the ONE ride on the rung — not 1 + (rung 1 − counter 1).
  const rider = { tags: [{ equipped: true, tag: { slug: "arelitz-ridden-1", name: "Arelitz (1 ride left)" } }], ...spent(1, 1) };
  assert.equal(freeMovesLeft(rider, CONFIG, TURN), 2);
  // Parked indoors afterwards: the base travel is untouched.
  assert.equal(freeMovesLeft({ tags: [], ...spent(1, 1) }, CONFIG, TURN), 1);
  // And a fresh arelitz picked up from the stable this turn rides at once —
  // there is no "changed hands" gate any more, the rung is the whole truth.
  const fresh2 = { tags: [{ equipped: true, tag: { slug: "arelitz", name: "Arelitz" } }], ...spent(1, 1) };
  assert.equal(freeMovesLeft(fresh2, CONFIG, TURN), 3);
});

test("crossingClaim: last turn's counters are reset by the same write", () => {
  const yesterday = { zoneMovesTurnId: "t0", zoneMovesUsed: 1, zoneMovesBonusUsed: 0 };
  assert.deepEqual(crossingClaim(onFoot, yesterday, TURN, 1), { zoneMovesTurnId: "t1", zoneMovesUsed: 1, zoneMovesBonusUsed: 0, rode: false, left: 0 });
});

test("crossingClaim: a push on overspends the base pool alone", () => {
  // ½ travel left, a far crossing wanted: the push on charges the full cost
  // to the base, which is what exertedThisTurn reads back, and never the bonus.
  assert.deepEqual(crossingClaim(onFoot, spent(0.5), TURN, 1, { exert: true }), { zoneMovesTurnId: "t1", zoneMovesUsed: 1.5, zoneMovesBonusUsed: 0, rode: false, left: 0 });
});
