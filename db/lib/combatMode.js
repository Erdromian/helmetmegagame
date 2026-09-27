// Combat mode (docs/systemdocs/COMBAT-MODE.md): the state, the timing rule and the sentences.
// IMPORT-FREE on purpose, so the web's client button can require it for the same words the
// server refuses with. The write is db/lib/verbs/combatMode.js; the push's Tired/Exhausted step
// is db/lib/combatModePass.js; the gates that need it are db/lib/combatGate.js.

const EXHAUSTED = "exhausted";

const NEEDS_COMBAT_MODE_ATTACK = "You need to be in combat mode to attack.";
const NEEDS_COMBAT_MODE_INTERCEPT = "You need to be in combat mode to lie in wait.";
const WATCH_DORMANT = "Your guard is down, you can't catch anyone unless you are in combat mode.";
const TOO_EXHAUSTED = "You're too exhausted to enter combat mode.";
const LOCKED_ON = "You can turn it off next turn.";
// Bascinet's words, verbatim (Combat Mode.docx).
const ALERT_LINE = "They look alert.";

// `row` is anything carrying Character.combatModeSinceTurn — a character, or a rehydrated look.
function inCombatMode(row) {
  return row?.combatModeSinceTurn != null;
}

// Turned on THIS turn, so it can't come off yet. Equality, not "greater or equal": Restart Game
// mints Turn 1 again, and a number stamped on the old Turn 57 must not lock anybody for good.
function lockedOn(row, openTurn) {
  return inCombatMode(row) && openTurn?.number != null && row.combatModeSinceTurn === openTurn.number;
}

function holdsExhausted(tags) {
  return (tags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === EXHAUSTED);
}

// What the button draws: { on, locked, onBlock }. `onBlock` is the sentence refusing "on", or
// null — only Exhausted, since an ACT blocker is the verb's to say and the button names none.
function combatModeState(row, openTurn, tags) {
  const on = inCombatMode(row);
  return {
    on,
    locked: lockedOn(row, openTurn),
    onBlock: !on && holdsExhausted(tags) ? TOO_EXHAUSTED : null,
  };
}

module.exports = {
  NEEDS_COMBAT_MODE_ATTACK,
  NEEDS_COMBAT_MODE_INTERCEPT,
  WATCH_DORMANT,
  TOO_EXHAUSTED,
  LOCKED_ON,
  ALERT_LINE,
  inCombatMode,
  lockedOn,
  holdsExhausted,
  combatModeState,
};
