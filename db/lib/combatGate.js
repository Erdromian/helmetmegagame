// THE GATES ON ATTACK (docs/systemdocs/ATTACK.md §5a) AND INTERCEPT. Attack is free, so it's a lever: with your Move
// already filed, pressing it only pins somebody for the rest of the day.

const { inCombatMode, NEEDS_COMBAT_MODE_ATTACK, NEEDS_COMBAT_MODE_INTERCEPT } = require("./combatMode");

// A Move already filed spends the turn — unless it's a GAMBIT. NO moveKind counts as spent, not as
// nothing filed — db/lib/locationTravel.js files a paid zone crossing with the column left null, and
// that crossing cost the turn. Kept as the row test, not the kind, so a writer that forgets the column fails closed.
function spentBy(action) {
  return Boolean(action) && action.moveKind !== "GAMBIT";
}

// Bascinet's words, verbatim.
const ATTACK_MOVE_SPENT =
  "You've already used your Move this turn. You should only Attack if you plan to use your Gambit to actually declare your combat.";

// `db` is a parameter for the db/lib/dm.js reason: requiring the barrel back
// from inside db/lib/ resolves to a partial exports object.
async function moveSpent(db, characterId, turnId) {
  if (!turnId) return false;
  return spentBy(
    await db.action.findFirst({ where: { characterId, turnId }, select: { moveKind: true } }),
  );
}

// The heldReasonFor shape (db/lib/intercept.js): sentence or null, so the button greying and the
// server action refusal never disagree about why.
async function attackMoveBlock(db, characterId, turnId) {
  return (await moveSpent(db, characterId, turnId)) ? ATTACK_MOVE_SPENT : null;
}

// Combat mode is required to Attack (Combat Mode.docx; COMBAT-MODE.md §3). A sentence or null, the
// shape above. Checked AFTER the spent Move: that one can't be fixed this turn, and naming combat mode
// first would have a player turn it on, which can't be undone until tomorrow, only to be refused anyway.
async function attackBlock(db, characterId, turnId) {
  const spent = await attackMoveBlock(db, characterId, turnId);
  if (spent) return spent;
  return (await combatModeOn(db, characterId)) ? null : NEEDS_COMBAT_MODE_ATTACK;
}

// Setting an Intercept watch needs it too. Stopping one never does (db/lib/verbs/watch.js#stopWatch).
async function interceptBlock(db, characterId) {
  return (await combatModeOn(db, characterId)) ? null : NEEDS_COMBAT_MODE_INTERCEPT;
}

async function combatModeOn(db, characterId) {
  return inCombatMode(await db.character.findUnique({ where: { id: characterId }, select: { combatModeSinceTurn: true } }));
}

module.exports = {
  spentBy,
  attackMoveBlock,
  attackBlock,
  interceptBlock,
};
