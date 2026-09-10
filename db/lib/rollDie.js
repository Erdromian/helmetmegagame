// The Move d6, on its own so that db/lib/advantage.js can roll one without
// requiring db/lib/moveEffects.js back — moveEffects rolls the labor drop die
// THROUGH advantage.js, and the two requiring each other is a CJS cycle whose
// symptom is an empty exports object at import time rather than an error.
//
// It stays exported from moveEffects as well, so every existing
// `require("./moveEffects").rollDie` keeps resolving. That matters more than it
// looks: the adjudication panel rerolls this die when a GM switches a Routine
// to a Gambit, and the two must be the same die.
function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

module.exports = { rollDie };
