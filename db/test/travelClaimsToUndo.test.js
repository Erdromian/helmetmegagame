// node --test over db/lib/locationTravel.js#travelClaimsToUndo — what
// restoring a GM-reset (or rejected) Move should also undo on the Character
// row, since a zone crossing spends two things outside Action.appliedEffects
// entirely: the pending-travel pointer (travelToLocationId/travelTurnId) a
// PAID crossing stamps instead of moving anyone, and the
// zoneMovesUsed/zoneMovesTurnId counter every crossing this turn claims
// against, free or paid. Pure function, no Prisma, no tx.
const test = require("node:test");
const assert = require("node:assert/strict");
const { travelClaimsToUndo } = require("../lib/locationTravel");

const TURN_A = "turn-a";
const TURN_B = "turn-b";

// `action`-shaped input: { turnId, characterId, character: {...} }.
const actionFor = (character, turnId = TURN_A) => ({
  turnId,
  characterId: "char-1",
  character,
});

test("nothing to undo: no pending travel, no zone-move claim", () => {
  const action = actionFor({ travelToLocationId: null, travelTurnId: null, zoneMovesTurnId: null });
  assert.equal(travelClaimsToUndo(action), null);
});

test("no character on the action at all", () => {
  assert.equal(travelClaimsToUndo({ turnId: TURN_A, characterId: "char-1" }), null);
});

test("a paid crossing this turn clears the pending destination", () => {
  const action = actionFor({
    travelToLocationId: "loc-forest",
    travelTurnId: TURN_A,
    zoneMovesTurnId: null,
  });
  assert.deepEqual(travelClaimsToUndo(action), {
    travelToLocationId: null,
    travelTurnId: null,
  });
});

test("a pending destination from a DIFFERENT turn is left alone", () => {
  // travelTurnId belongs to some other turn than the Action being undone —
  // this Action cannot be the one that queued it (Action.turnId is unique
  // per character), so touching it would undo someone else's journey.
  const action = actionFor({
    travelToLocationId: "loc-forest",
    travelTurnId: TURN_B,
    zoneMovesTurnId: null,
  });
  assert.equal(travelClaimsToUndo(action), null);
});

test("travelTurnId set with no actual destination is not a claim", () => {
  const action = actionFor({ travelToLocationId: null, travelTurnId: TURN_A, zoneMovesTurnId: null });
  assert.equal(travelClaimsToUndo(action), null);
});

test("a free crossing spent this turn resets the counter", () => {
  const action = actionFor({
    travelToLocationId: null,
    travelTurnId: null,
    zoneMovesTurnId: TURN_A,
  });
  assert.deepEqual(travelClaimsToUndo(action), {
    zoneMovesUsed: 0,
    zoneMovesTurnId: null,
  });
});

test("a zone-move claim from a different turn is left alone", () => {
  const action = actionFor({
    travelToLocationId: null,
    travelTurnId: null,
    zoneMovesTurnId: TURN_B,
  });
  assert.equal(travelClaimsToUndo(action), null);
});

test("a paid crossing past the free allowance undoes both at once", () => {
  // The realistic case: free moves were already spent this turn, so THIS
  // crossing became the paid one that spent the Move.
  const action = actionFor({
    travelToLocationId: "loc-forest",
    travelTurnId: TURN_A,
    zoneMovesTurnId: TURN_A,
  });
  assert.deepEqual(travelClaimsToUndo(action), {
    travelToLocationId: null,
    travelTurnId: null,
    zoneMovesUsed: 0,
    zoneMovesTurnId: null,
  });
});
