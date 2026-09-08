// node --test over db/lib/desireGates.js#slotStates — the per-slot cooldown
// and the turns-left count the client labels a locked slot by.
const test = require("node:test");
const assert = require("node:assert/strict");
const { slotStates } = require("../lib/desireGates");

const ended = (slotIndex, endedTurnNumber) => ({ slotIndex, endedTurnNumber, status: "FULFILLED" });

test("a fresh slot is open with no turns left to count", () => {
  const [slot] = slotStates({ history: [], openTurnNumber: 5, desireSlots: 1 });
  assert.equal(slot.lockedUntilTurn, null);
  assert.equal(slot.lockedTurnsLeft, null);
});

test("a slot ended this turn is locked for lockTurns, counting down each turn", () => {
  const history = [ended(0, 4)];
  const at = (openTurnNumber) => slotStates({ history, openTurnNumber, desireSlots: 1, lockTurns: 2 })[0];
  assert.equal(at(4).lockedUntilTurn, 7);
  assert.equal(at(4).lockedTurnsLeft, 3);
  assert.equal(at(5).lockedTurnsLeft, 2);
  assert.equal(at(6).lockedTurnsLeft, 1);
  assert.equal(at(7).lockedUntilTurn, null);
  assert.equal(at(7).lockedTurnsLeft, null);
});

test("turns left never reads zero while the slot is locked", () => {
  const [slot] = slotStates({ history: [ended(0, 4)], openTurnNumber: 6, desireSlots: 1, lockTurns: 2 });
  assert.ok(slot.lockedTurnsLeft >= 1);
});
