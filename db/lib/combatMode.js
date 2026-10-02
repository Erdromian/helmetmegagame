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
const CALL_OFF_LOCKED = "Moves are locked for this turn, so the fight can't be called off now.";
const DESCRIBE_LOCKED = "Moves are locked for this turn, so your attack can't be changed now.";
const ALREADY_FIGHTING = "You're already in a fight.";
const WITHDRAWING_BLOCK = "You've just called off a fight. You can't start another one yet.";
// Turning an invitation down bars one thing: joining that same fight's attackers later. Its defenders, other
// fights and new attacks all stay open (Bascinet, 2026-09-27).
const DECLINED_ATTACKERS = "You turned down this fight, so you can't join its attackers.";
// A sprung ambush keeps the targets it was set with until its fight is over (Bascinet, 2026-09-27).
const AMBUSH_SPRUNG = "Your ambush has already sprung. You can't change it until the fight is over.";
// An ambush ends with the fight it sprang (Bascinet, 2026-09-27); its owner is told.
const AMBUSH_ENDED = "Your ambush is over. Set it again if you still want to lie in wait.";
const TOO_FAR_TO_INTERVENE = "You arrived too late to intervene.";
const SURPRISED = "You were caught by surprise, so you can't choose how you fight this one.";
// Said to a collaborator asked along while out of combat mode: they are snapshotted and rolled the moment they
// are asked, so turning it on before answering changes nothing (Bascinet, 2026-09-27).
const INVITE_SURPRISED = "You aren't on guard, so if you join you'll be caught by surprise and can't choose how you fight.";
// What one attack description may run to. Discord's modal paragraph takes 4000; a GM reads a whole fight's
// worth of these, so this is the smaller of the two. Here, import-free, so the web's editor counts to it.
const DESCRIPTION_LIMIT = 2000;
const ALERT_TOO_LATE = "You're alert now, but it only counts for fights that start from here on — not the one you're already in.";

// A failed Caving roll (Combat Mode.docx: "a character who has combat mode enabled when failing a cave roll is
// given a prompt as to how they might respond to any threats"; COMBAT-MODE.md §6). One response per caving result,
// capped at DESCRIPTION_LIMIT like an attack. Here so the web's write box says what the server refuses with.
const CAVING_PROMPT = "You're on guard. Write how you respond to it. You can change it until Moves lock.";
// Out of combat mode at every 1 so far. The doc's way back in: turn it on, and the next failed roll asks.
const CAVING_SURPRISED = "You weren't on guard, so you can't choose how you respond. If you're in combat mode when it happens again this turn, you can.";
const CAVING_LOCKED = "Moves are locked for this turn, so your response can't be changed now.";
const CAVING_WRITTEN = "Your response is written. You can change it until Moves lock.";

// An invitation, naming who asked (combat.js#combatViewFor's `inviter`, already the name the reader knows
// them by). Both faces' fight readouts and the line under the Turn box say it the same way. `inviter` may be
// null — the one who asked has left the fight — and then nobody is named.
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function invitedLine(inviter) {
  return inviter
    ? `${capFirst(inviter)} has asked you to join the attack. You can't leave until you answer.`
    : "You've been asked to join the attack. You can't leave until you answer.";
}
function invitedShortLine(inviter) {
  return inviter ? `${capFirst(inviter)} has asked you to join a fight.` : "You've been asked to join a fight.";
}

// How a list reads to one reader: "a young man", "Ada and a young man", "Ada, Bo and a young man".
function listNames(names) {
  const list = (names ?? []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "nobody";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// Joining a side of a fight going on here (combat.js#combatsHere's shape: `attackers` and `defenders` as the
// names the reader knows them by). The confirm names who you would be fighting beside and against, so the
// choice never rests on reading which half of a list is which.
function joinSideLine(fight, side) {
  const ours = side === "ATTACKER" ? fight?.attackers : fight?.defenders;
  const theirs = side === "ATTACKER" ? fight?.defenders : fight?.attackers;
  return `You'll fight alongside ${listNames(ours)} against ${listNames(theirs)}. You'll be held here until the fight is over. The further you came to get here, the worse your chances.`;
}

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

// What the button draws: { on, locked, onBlock, lockedNote }. `onBlock` is the sentence refusing "on", or
// null — only Exhausted, since an ACT blocker is the verb's to say and the button names none.
// `heldBy` is a sentence the SERVER worked out for something else holding it on: passed in rather than
// decided here, because this file ships to every browser and must not name what does the holding (a secret
// seat's rule — chat/actions.js#myMove says which). It locks the button and is what the button says.
function combatModeState(row, openTurn, tags, { heldBy = null } = {}) {
  const on = inCombatMode(row);
  const held = Boolean(heldBy) && on;
  return {
    on,
    locked: held || lockedOn(row, openTurn),
    onBlock: !on && holdsExhausted(tags) ? TOO_EXHAUSTED : null,
    lockedNote: held ? heldBy : null,
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
  CALL_OFF_LOCKED,
  DESCRIBE_LOCKED,
  ALREADY_FIGHTING,
  WITHDRAWING_BLOCK,
  DECLINED_ATTACKERS,
  AMBUSH_SPRUNG,
  AMBUSH_ENDED,
  TOO_FAR_TO_INTERVENE,
  SURPRISED,
  INVITE_SURPRISED,
  ALERT_TOO_LATE,
  CAVING_PROMPT,
  CAVING_SURPRISED,
  CAVING_LOCKED,
  CAVING_WRITTEN,
  DESCRIPTION_LIMIT,
  invitedLine,
  invitedShortLine,
  listNames,
  joinSideLine,
  inCombatMode,
  lockedOn,
  holdsExhausted,
  combatModeState,
};
