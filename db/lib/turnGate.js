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

module.exports = { movesOpen, autoMovesOpen, gateMessage, GATE_MESSAGES };
