// The words of a Bloodcrazed or Wight Vampire's compulsion (docs/systemdocs/VAMPIRE.md §4;
// db/lib/vampireCompulsion.js). A Vampire secret, so NEVER import this from a client component:
// db/lib/combatMode.js ships to every browser, and these sentences would tell anybody with DevTools
// that a Vampire seat is real. The server works out which applies and sends the sentence itself.
// Zero requires, so combat.js and the verbs can read it without a cycle through vampireCompulsion.js.

// Always first on the Vampire's card on the GM's Combat desk, whatever they write (Bascinet,
// 2026-10-01: the same line for a Wight).
const COMPELLED_GM_LINE = "This character is bloodcrazed and MUST feed this turn.";

// The Vampire's own prompt: the feeding IS the attack, written in the same box.
const COMPELLED_WRITE_PROMPT = "The hunger has you. Write how you attack and feed on them. You can change it until Moves lock.";
const COMPELLED_FIELD_LABEL = "How do you attack and feed?";

const COMPELLED_NO_CALL_OFF = "The hunger won't let you call this off.";
const COMPELLED_LOCKED_ON = "The hunger won't let you relax.";

module.exports = {
  COMPELLED_GM_LINE,
  COMPELLED_WRITE_PROMPT,
  COMPELLED_FIELD_LABEL,
  COMPELLED_NO_CALL_OFF,
  COMPELLED_LOCKED_ON,
};
