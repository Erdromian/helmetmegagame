// "May a player do this right now, with the game shut between sittings?" — one answer, one sentence, both faces.
//
// db/lib/turnGate.js#movesOpen answers a DIFFERENT question: may a Move be spent or filed. It needs an open turn, and it
// folds NO_TURN and LOCKED into the same answer, so it cannot stand in for the session question — a caller asking it about
// Travel would refuse between turns as well, which nobody wants.
//
// THE POLICY (SESSIONS.md §5): between sessions a player may TALK. Nothing else. Travel, transfers, theft, crafting,
// healing, filing a Gambit — all of it waits for the sitting to open. Reading is never an act, equipping costs nothing, the
// lobby sits outside the game, and a GM works whenever they like; none of those come through here.
//
// `acting: false` is the speech case, and the one thing GameConfig.roleplayBetweenSessions decides. With the knob on,
// speech goes through; with it off, the freeze is total.

const { inSession, readGameConfig, readGameState, CLOCK_CONFIG_SELECT, CLOCK_STATE_SELECT } = require("./gameState");
const { GATE_MESSAGES } = require("./turnGate");

// gameMode is what `inSession` reads; roleplayBetweenSessions is what this module adds. Selected together so a caller
// cannot half-select and get a confidently wrong answer, the same reasoning as CLOCK_CONFIG_SELECT's own note.
const SESSION_CONFIG_SELECT = { ...CLOCK_CONFIG_SELECT, roleplayBetweenSessions: true };

// Takes the client as a parameter, the db/lib/dm.js convention — `db` may be a transaction client.
//
// FAILS OPEN when gameMode is unset, inherited from inSession() on purpose: a half-configured game should not lock
// everybody out of everything.
async function sessionGate(db, { acting = true } = {}) {
  const [config, state] = await Promise.all([
    readGameConfig(db, SESSION_CONFIG_SELECT),
    readGameState(db, CLOCK_STATE_SELECT),
  ]);
  return gateFor(config, state, { acting });
}

// The same answer from rows already in hand — for a page that has just loaded the two singletons anyway.
function gateFor(config, state, { acting = true } = {}) {
  if (inSession(config, state)) return { ok: true, reason: null, message: null };
  if (!acting && config?.roleplayBetweenSessions !== false) return { ok: true, reason: null, message: null };
  return { ok: false, reason: "NOT_IN_SESSION", message: GATE_MESSAGES.NOT_IN_SESSION };
}

module.exports = { sessionGate, gateFor, SESSION_CONFIG_SELECT };
