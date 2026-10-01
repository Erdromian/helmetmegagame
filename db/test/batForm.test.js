// Bat Form's gate (db/lib/batForm.js): everything that holds a walk holds a
// flight too. Prisma is stubbed down to the handful of reads the gate makes.
const test = require("node:test");
const assert = require("node:assert/strict");

const { batFormRefusal, batFormHeldReason, IN_A_FIGHT, CAVING_HOLD } = require("../lib/batForm");
const { HELD_REASON } = require("../lib/intercept");
const { CAVING_STUCK_REASON } = require("../lib/cavingPass");
const { GATE_MESSAGES, CAVING_TRAVEL_LOCKED } = require("../lib/turnGate");

const HOUR = 60 * 60 * 1000;
const OPEN_TURN = { id: "turn1", number: 3 };

// `turn` is only offered when a test wants the pre-push lock read: a client
// with no Turn model is never locked (turnGate.js#travelLockReason).
function fakeDb({ config = {}, state = { phase: "RUNNING" }, turn = null, fight = null, troubles = 0, zoneKind = "SURFACE" } = {}) {
  return {
    gameConfig: { findUnique: async () => config },
    gameState: { findUnique: async () => state },
    ...(turn ? { turn: { findFirst: async () => turn } } : {}),
    combatParticipant: { findFirst: async () => fight },
    cavingRoll: { count: async () => troubles },
    zone: { findUnique: async () => ({ kind: zoneKind }) },
  };
}

function vampire(extra = {}) {
  return { id: "vamp", zoneId: "zone1", locationId: "loc1", heldUntil: null, heldReason: null, tags: [], ...extra };
}

const later = () => new Date(Date.now() + HOUR);

test("free to fly: no refusal", async () => {
  assert.equal(await batFormRefusal(fakeDb(), vampire(), { turn: OPEN_TURN }), null);
});

test("every kind of hold refuses it, in the hold's own sentence", async () => {
  for (const reason of Object.values(HELD_REASON)) {
    const held = vampire({ heldUntil: later(), heldReason: reason });
    const refusal = await batFormRefusal(fakeDb(), held, { turn: OPEN_TURN });
    assert.ok(refusal, `${reason} should refuse`);
    assert.equal(refusal, batFormHeldReason(held));
  }
  const attacked = vampire({ heldUntil: later(), heldReason: HELD_REASON.ATTACK });
  assert.match(await batFormRefusal(fakeDb(), attacked, { turn: OPEN_TURN }), /fight is over/);
});

test("a hold that has lapsed on its own clock no longer refuses", async () => {
  const lapsed = vampire({ heldUntil: new Date(Date.now() - 1000), heldReason: HELD_REASON.ATTACK });
  assert.equal(await batFormRefusal(fakeDb(), lapsed, { turn: OPEN_TURN }), null);
});

test("a live fight row refuses it even with no hold on the clock", async () => {
  const db = fakeDb({ fight: { id: "p1", combatId: "c1" } });
  assert.equal(await batFormRefusal(db, vampire(), { turn: OPEN_TURN }), IN_A_FIGHT);
});

test("incapacitated refuses it", async () => {
  const bound = vampire({ tags: [{ tag: { slug: "unconscious", name: "Unconscious" } }] });
  assert.equal(await batFormRefusal(fakeDb(), bound, { turn: OPEN_TURN }), "You're in no state to do that — you're Unconscious.");
});

test("between sittings refuses it", async () => {
  const db = fakeDb({ config: { gameMode: "SESSIONS" }, state: { phase: "RUNNING", sessionOpenedAt: null } });
  assert.equal(await batFormRefusal(db, vampire(), { turn: OPEN_TURN }), GATE_MESSAGES.NOT_IN_SESSION);
});

test("the pre-push travel lock refuses a flight into or out of the caves, and nothing else", async () => {
  const now = Date.now();
  const lockedTurn = {
    id: "turn1",
    status: "OPEN",
    turnLengthHours: 24,
    startedAt: new Date(now - 23 * HOUR),
    endsAt: new Date(now + HOUR),
  };
  const surface = fakeDb({ turn: lockedTurn });
  assert.equal(await batFormRefusal(surface, vampire(), { turn: lockedTurn, intoZoneKind: "SURFACE" }), null);
  assert.equal(await batFormRefusal(surface, vampire(), { turn: lockedTurn, intoZoneKind: "CAVE_LEVEL" }), CAVING_TRAVEL_LOCKED);
  const caves = fakeDb({ turn: lockedTurn, zoneKind: "CAVE_LEVEL" });
  assert.equal(await batFormRefusal(caves, vampire(), { turn: lockedTurn, intoZoneKind: "SURFACE" }), CAVING_TRAVEL_LOCKED);
});

test("the Caving Die: a 1 holds, severity 10 stops, and only underground", async () => {
  assert.equal(await batFormRefusal(fakeDb({ troubles: 1, zoneKind: "CAVE_LEVEL" }), vampire(), { turn: OPEN_TURN }), CAVING_HOLD);
  assert.equal(
    await batFormRefusal(fakeDb({ troubles: 10, zoneKind: "CAVE_LEVEL" }), vampire(), { turn: OPEN_TURN }),
    CAVING_STUCK_REASON,
  );
  assert.equal(await batFormRefusal(fakeDb({ troubles: 1, zoneKind: "SURFACE" }), vampire(), { turn: OPEN_TURN }), null);
});
