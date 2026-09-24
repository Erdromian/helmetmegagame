// What a room search costs of the turn's Move (docs/systemdocs/SEARCH.md §9c):
// half, so two fill a Routine. `family` is what lets it share the ledger
// with a craft or a cure the same turn (CRAFTING.md §2a).
//
// Its own file with ZERO requires, ever, the db/lib/dmKinds.js rule: the
// /chat room panel is a client component and reads this to say the price
// before the press, and one require of anything heavier here would drag it
// into the browser bundle. db/lib/roomSearch.js is the only other reader.
const SEARCH_MOVE = Object.freeze({ num: 1, den: 2, family: "search" });

module.exports = { SEARCH_MOVE };
