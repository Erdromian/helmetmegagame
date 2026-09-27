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

// The fight's own sentences (docs/systemdocs/ATTACK.md, Combat Overhaul.docx). Here rather than in
// db/lib/combat.js so the web's client components read the same words the server refuses with.
const ATTACK_LOCKED = "Moves are locked for this turn, so nobody can start or join a fight.";
const INTERCEPT_LOCKED = "Moves are locked for this turn, so you can't lie in wait.";
const TRAVEL_LOCKED = "Moves are locked for this turn. Nobody can travel until the next turn starts.";
const CALL_OFF_LOCKED = "Moves are locked for this turn, so the fight can't be called off now.";
const DESCRIBE_LOCKED = "Moves are locked for this turn, so your attack can't be changed now.";
const ALREADY_FIGHTING = "You're already in a fight.";
const WITHDRAWING_BLOCK = "You've just called off a fight. You can't start another one yet.";
const DECLINED_HERE = "You stayed out of the fight here. You can't attack anyone here until next turn.";
const TOO_FAR_TO_INTERVENE = "You arrived too late to intervene.";
const SURPRISED = "You were caught by surprise, so you can't choose how you fight this one.";
// Said to a collaborator asked along while out of combat mode: they are snapshotted and rolled the moment they
// are asked, so turning it on before answering changes nothing (Bascinet, 2026-09-27).
const INVITE_SURPRISED = "You aren't on guard, so if you join you'll be caught by surprise and can't choose how you fight.";
// What one attack description may run to. Discord's modal paragraph takes 4000; a GM reads a whole fight's
// worth of these, so this is the smaller of the two. Here, import-free, so the web's editor counts to it.
const DESCRIPTION_LIMIT = 2000;
const ALERT_TOO_LATE = "You're alert now, but it only counts for fights that start from here on — not the one you're already in.";

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
  ATTACK_LOCKED,
  INTERCEPT_LOCKED,
  TRAVEL_LOCKED,
  CALL_OFF_LOCKED,
  DESCRIBE_LOCKED,
  ALREADY_FIGHTING,
  WITHDRAWING_BLOCK,
  DECLINED_HERE,
  TOO_FAR_TO_INTERVENE,
  SURPRISED,
  INVITE_SURPRISED,
  ALERT_TOO_LATE,
  DESCRIPTION_LIMIT,
  inCombatMode,
  lockedOn,
  holdsExhausted,
  combatModeState,
};
