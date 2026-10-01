// "May a player act on the turn right now?" — one answer, one sentence, both faces.
//
// This did not exist, and its absence was a bug waiting to be written. Fourteen call sites each loaded the open turn, called
// clockFrozen(), called moveWindow(), read `.locked`, and hardcoded their own copy of the refusal — in four different
// wordings. Adding Sessions to that shape would have meant a fifteenth copy, and any site somebody forgot would quietly
// accept Moves while the game was shut.
//
// THE ORDER OF THE CHECKS IS THE POINT. `moveWindow().locked` is false when the clock is frozen, on purpose: freezing
// removes the DEADLINE (there is no scheduled end to count back from), it does not shut the game. So a gate that asked only
// about `locked` would read "not in session" as "wide open" — the exact opposite. The session question comes first.
//
// THE LOCK IS FOR MOVES A GM HAS TO RULE ON, and nothing else. It is there to give the desk a quiet window to adjudicate
// what was written, so it shuts `movesOpen`: filing, editing or withdrawing a written Move (db/lib/moves.js). A verb that
// settles itself — every craft, Bury, Mine, Refine, Farm, a build site, a heal, a Trinket, a lesson, a confession — asks
// `autoMovesOpen` instead, which is the same gate without the window. No GM reads those rows, so there is nothing for the
// lock to protect, and a player can keep working right up to the push. Being out of session still refuses both.
// Two things a GM also reads off the picture are shut by the lock as well, since the Combat Overhaul: starting
// or joining a fight and laying in wait (db/lib/combatGate.js), and walking in the caves (travelLockReason below).

const { moveWindow } = require("./turnClock");
const { clockStatus } = require("./gameState");

// Keyed by the same vocabulary db/lib/gameState.js#frozenReason speaks, plus the two this gate adds of its own.
const GATE_MESSAGES = {
  NO_TURN: "No turn is open.",
  NOT_IN_SESSION: "The game isn't in session.",
  NOT_RUNNING: "The game isn't running.",
  PAUSED: "The turn clock is paused.",
  LOCKED: "Moves are locked for this turn.",
};

function gateMessage(reason) {
  return reason ? (GATE_MESSAGES[reason] ?? GATE_MESSAGES.LOCKED) : null;
}

// Takes the client as a parameter, the db/lib/dm.js convention — `db` may be a transaction, which several callers hand it.
// `turn` is returned whether or not the gate opens, because a refusing caller usually still wants to name the turn.
async function movesOpen(db, { now = new Date(), turn = null } = {}) {
  return gate(db, { now, turn, lockApplies: true });
}

// The same gate for a verb no GM resolves: every refusal above, in the same order, except the lock. See the header.
async function autoMovesOpen(db, { now = new Date(), turn = null } = {}) {
  return gate(db, { now, turn, lockApplies: false });
}

async function gate(db, { now, turn, lockApplies }) {
  const [openTurn, status] = await Promise.all([
    turn ? Promise.resolve(turn) : db.turn.findFirst({ where: { status: "OPEN" } }),
    clockStatus(db),
  ]);

  if (!openTurn) return refusal("NO_TURN", null, null);

  // Before the session, and before the window. A turn row exists through the lobby — Restart Game mints Turn 1 and Start
  // Game restamps it — and `inSession` is true for a Persistent game whatever the phase, so without this the gate read a
  // game nobody had started yet as wide open. NOT_RUNNING had a message in the table above and was never once returned.
  if (status.reason === "NOT_RUNNING") return refusal("NOT_RUNNING", openTurn, null);

  // Before the window, always. See the header.
  if (!status.inSession) return refusal("NOT_IN_SESSION", openTurn, null);

  const window = moveWindow(openTurn, { now, clockFrozen: status.frozen });
  if (lockApplies && window.locked) return refusal("LOCKED", openTurn, window);

  return { ok: true, reason: null, message: null, turn: openTurn, window };
}

function refusal(reason, turn, window) {
  return { ok: false, reason, message: gateMessage(reason), turn, window };
}

// TRAVEL IS SHUT BY THE LOCK ONLY UNDERGROUND. The Combat Overhaul shut every walk in the lock ("Movement
// between locations is locked during turn lock henceforth"); Bascinet opened the surface again on 2026-10-01
// and kept the caves shut. The lock is what gives the desk time to answer every failed Caving roll before the
// push, so a walk with either end in a CAVE_LEVEL zone (the Caves and the Depths) is refused, in Caving.docx's
// own words: walking in, walking out, and walking about inside. Anywhere else the lock lets them walk.
//
// Only the lock's own refusal — whether the game is in session is sessionGate's question, asked first by the
// mover (db/lib/locationTravel.js). Null means they may walk. A GM's relocation never comes this way. A client
// with no Turn model (the unit tests' fakes) is never locked.
//
// `fromZoneKind` is the zone kind the walker stands in, `intoZoneKind` the destination's. A walk that touches
// no cave asks no query at all.
async function travelLockReason(db, { now = new Date(), turn = null, fromZoneKind = null, intoZoneKind = null } = {}) {
  const sentence = lockedTravelSentence(fromZoneKind, intoZoneKind);
  if (!sentence) return null;
  return (await travelLocked(db, { now, turn })) ? sentence : null;
}

// Has the lock shut this turn? The one question under travelLockReason, for a caller drawing many ways off
// one answer (db/lib/locationGraph.js) and pairing it with lockedTravelSentence per way.
async function travelLocked(db, { now = new Date(), turn = null } = {}) {
  if (!turn && typeof db?.turn?.findFirst !== "function") return false;
  try {
    const out = await gate(db, { now, turn, lockApplies: true });
    return out.reason === "LOCKED";
  } catch {
    return false;
  }
}

// Caving.docx, verbatim.
const CAVING_TRAVEL_LOCKED = "It is too close to the turn push, wait till next turn to move in the caves.";

// The lock's sentence for a walk between zones of these kinds, or null when the lock does not reach it.
function lockedTravelSentence(fromZoneKind, intoZoneKind) {
  return fromZoneKind === "CAVE_LEVEL" || intoZoneKind === "CAVE_LEVEL" ? CAVING_TRAVEL_LOCKED : null;
}

module.exports = {
  movesOpen,
  autoMovesOpen,
  travelLockReason,
  travelLocked,
  lockedTravelSentence,
  gateMessage,
  GATE_MESSAGES,
  CAVING_TRAVEL_LOCKED,
};
