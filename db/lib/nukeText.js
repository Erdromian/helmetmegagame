// The bomb's keypad: its numbers and every word it says, on the Discord keypad
// and the Chat dialog alike. See docs/systemdocs/NUKE.md.
//
// Zero requires, on purpose, like db/lib/phoneText.js: the Chat dialog is a
// client component, and db/lib/nuke.js requires Prisma-shaped things that must
// never reach the browser bundle.
//
// Bascinet's design document gives the rules but not the words, so every line
// below is a stand-in that has not had Bascinet's pass yet.

// How many digits the arming sequence has (the design document: "an 8 digit
// sequence of numbers").
const NUKE_CODE_DIGITS = 8;

// Wrong sequences in a row before the keypad stops answering that character,
// for good (the design document: "three times in a row").
const NUKE_MAX_STRIKES = 3;

const NUKE_TEXT = {
  label: "Bomb",
  title: "The bomb",
  armedState: "It is armed.",
  safeState: "It is not armed.",
  arm: "Arm",
  disarm: "Disarm",
  clear: "Clear",
  wrong: "Wrong sequence.",
  triesLeft: (n) => (n === 1 ? "1 try left." : `${n} tries left.`),
  lockedOut: "The keypad no longer answers you.",
  notDigits: `Enter all ${NUKE_CODE_DIGITS} digits.`,
  noBomb: "There's no bomb here.",
  notHere: "You aren't standing at the bomb.",
  gone: "It's already gone off.",
  noTurn: "No turn is open.",
  armed: (turn) => `Armed. It goes off at the close of turn ${turn}.`,
  disarmed: "Disarmed.",
  // The Notes entry the leaders and the Tribunal start the game with, and the
  // paper the Tribunal Ordinator carries (the design document's own words).
  noteTitle: "The bomb",
  // Location names are bare nouns ("Keep", "Garrison"), so the note gives them
  // their "the" — unless the name brings its own ("The Old Cock Inn").
  noteBody: (location) => `The bomb is in ${/^the\s/i.test(location) ? location : `the ${location}`}.`,
  paperTitle: "A folded note",
};

module.exports = { NUKE_CODE_DIGITS, NUKE_MAX_STRIKES, NUKE_TEXT };
