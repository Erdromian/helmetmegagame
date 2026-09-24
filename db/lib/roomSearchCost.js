// What a room search costs of the turn's Move (docs/systemdocs/SEARCH.md §9c):
// a third, so three fill a Routine. `family` is what lets it share the ledger
// with a craft or a cure the same turn (CRAFTING.md §2a).
//
// Stored as an exact 1/3 rather than 0.33, so three searches close the Move
// with no sliver left over (the ledger is rational). SEARCH_MOVE_LABEL is how
// players read it, on the Discord button and in the /chat confirm alike;
// formatMoveAmount would print "0.333", which is right for the ledger's own
// sentences and too fussy for a price tag.
//
// Its own file with ZERO requires, ever, the db/lib/dmKinds.js rule: the
// /chat room panel is a client component and reads this to say the price
// before the press, and one require of anything heavier here would drag it
// into the browser bundle.
const SEARCH_MOVE = Object.freeze({ num: 1, den: 3, family: "search" });
const SEARCH_MOVE_LABEL = "0.33";

module.exports = { SEARCH_MOVE, SEARCH_MOVE_LABEL };
