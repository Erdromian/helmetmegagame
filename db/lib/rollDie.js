// The Move d6, on its own so db/lib/advantage.js can roll one without requiring db/lib/moveEffects.js back (a CJS cycle). Stays exported from moveEffects too, so every existing `require("./moveEffects").rollDie` keeps resolving — the adjudication panel rerolls this die when a GM switches a Routine to a Gambit, and the two must be the same die.
function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

// The lowest any roll can come to once its modifiers are added: a Gambit, a fight, a steal, a
// lesson — every die-plus-modifiers total in the game. The die itself is already 1 or more, so
// this only ever lifts a total that the minuses dragged below it.
const MIN_ROLL_TOTAL = 1;

// die + modifier, never below MIN_ROLL_TOTAL. `modifier` is the summed number, not the list.
// No requires, so a client component can import it.
function rollTotal(die, modifier = 0) {
  return Math.max(MIN_ROLL_TOTAL, (Number(die) || 0) + (Number(modifier) || 0));
}

module.exports = { rollDie, MIN_ROLL_TOTAL, rollTotal };
