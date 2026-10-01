// One person's roll in a fight (docs/systemdocs/ATTACK.md, Combat Overhaul.docx): "the same rules
// as gambit rolls, subject to all the modifiers a player may have when making a gambit", plus two
// of the fight's own. PURE, so the tests throw it with a forced die.
//
// GM ONLY. Nothing a player reads carries any of this (db/test/combatPrivacy.test.js). And nothing
// ACTS on it either — the GM reads it and rules, the way a Gambit's die has always worked.
//
// Read at the snapshot, not at the Move cutoff the way a Gambit's modifier is. A GM adjudicates a
// fight off the snapshot taken when it started (or when somebody joined), so the roll answers for
// the same moment.
const { rollWithEdge } = require("./advantage");
const { gambitModifiers } = require("./gambitModifier");
const { GAMBIT_BETTER, GAMBIT_WORSE } = require("./gambitDie");
const { LUCKY_SLUG, MISFORTUNE_SLUG } = require("./constants");
const { rollTotal } = require("./rollDie");

// Caught by surprise: out of combat mode when the fight reached you. Bascinet's number.
const SURPRISE_PENALTY = -3;
// How far an intervener came, in Locations. 1, 2 or 3 costs that much; 4 or more is too late to
// join at all (combat.js refuses before anything rolls).
const MAX_INTERVENE_DISTANCE = 3;

// [{ label, value }] — gambitModifiers' shape, so the desk prints it the same way. `tags` must
// carry tag.slug, tag.name and tag.gambitBonus (the gambitModifier.js trap); `mood` is the column.
function combatModifiers(tags, { mood = 0, alert = true, distance = null } = {}) {
  const out = gambitModifiers(tags, { mood });
  if (!alert) out.push({ label: "Surprised", value: SURPRISE_PENALTY });
  const d = Number.isInteger(distance) ? distance : 0;
  if (d > 0) out.push({ label: `Arrived late (${d})`, value: -Math.min(d, MAX_INTERVENE_DISTANCE) });
  return out;
}

// -> { die, rolls, advantageSource, modifiers, total }. Lucky and Misfortune pull the die exactly as
// they pull a Gambit's (db/lib/gambitDie.js).
function rollCombat(tags, opts = {}) {
  const roll = rollWithEdge(tags, { better: GAMBIT_BETTER, worse: GAMBIT_WORSE }, 6);
  const modifiers = combatModifiers(tags, opts);
  return {
    die: roll.die,
    rolls: roll.rolls,
    advantageSource: roll.edge === "better" ? LUCKY_SLUG : roll.edge === "worse" ? MISFORTUNE_SLUG : null,
    modifiers,
    total: rollTotal(roll.die, modifiers.reduce((sum, m) => sum + m.value, 0)),
  };
}

module.exports = { SURPRISE_PENALTY, MAX_INTERVENE_DISTANCE, combatModifiers, rollCombat };
