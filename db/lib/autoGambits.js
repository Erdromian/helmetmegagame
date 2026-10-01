// The Gambits the game rolls and settles on its own (ADJUDICATION.md §2).
// Each is filed with its die already thrown and a gmNotes marker, and its
// outcome is decided by code at the close, never by a GM:
//
//   auto:lesson        db/lib/lessons.js, settled the moment it's accepted
//   auto:heal_gambit   db/lib/healGambitPass.js
//   auto:confession    db/lib/confessionPass.js
//   auto:trinket       db/lib/trinketPass.js
//   auto:break_arelitz db/lib/moveEffects.js's `brokeIn` entry, at the push
//
// They file SOLVED (lessons PASSED), so the desk never lists one as waiting on
// a ruling, and nothing a GM does on the desk stops the roll landing: Save,
// Solve and Reopen all leave it to its pass. Only Reject, which deletes the
// Move, calls one off. A GM who disagrees with an outcome stages an effect.
//
// Zero requires, ever: web/lib/moves.js reaches this from a client component.
const SELF_RESOLVING_MARKERS = ["auto:lesson", "auto:heal_gambit", "auto:confession", "auto:trinket", "auto:break_arelitz"];

// Stamped into gmNotes by a pass once it has settled a row, so a close that
// is re-run after a crash never settles it twice. The status can't say this
// (the row was born SOLVED) and neither can the Result line (a GM may have
// typed one).
const SETTLED_MARKER = "auto:settled";

function hasMarker(gmNotes, marker) {
  return typeof gmNotes === "string" && gmNotes.includes(marker);
}

function isSelfResolving(gmNotes) {
  return SELF_RESOLVING_MARKERS.some((marker) => hasMarker(gmNotes, marker));
}

function isSettled(gmNotes) {
  return hasMarker(gmNotes, SETTLED_MARKER);
}

function withSettled(gmNotes) {
  return [gmNotes, SETTLED_MARKER].filter(Boolean).join("\n");
}

module.exports = { isSelfResolving, isSettled, withSettled };
