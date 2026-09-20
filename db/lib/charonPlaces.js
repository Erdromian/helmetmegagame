// Where the Charon is, as slugs. Split out of db/lib/charon.js for one reason:
// that module requires locationMove.js, which reaches Discord and drags half the
// move pipeline behind it, and db/lib/placeAffordances.js needs nothing from the
// Charon but four strings. Importing the mechanism to draw a button would be a
// require cycle waiting to happen.
//
// Zero requires, ever — the db/lib/sfx.js convention — so this stays safe to
// reach from anywhere, including a client component.
//
// Slugs rather than ids because a slug never moves (docs/zones.yaml's header):
// a superadmin can rename the Charon at /gm/dev/zones all day and none of this
// goes stale. See docs/systemdocs/CHARON.md.

/** The ship on the ground, one tile above the Keep on the barony1 plate. */
const CHARON_SLUG = "fortress-6";
/** The ship in orbit. Carries the `offMap` attribute; nothing draws it. */
const CHARON_SPACE_SLUG = "space-1";
/** The Keep. Where the Panic Room is, and where Leave puts you back. */
const KEEP_SLUG = "fortress-4";

/** The room with the only door into the ship. */
const PANIC_ROOM_SLUG = "fortress-4-d";
/** The ship's two rooms. Both TRAVEL with it — the same rows, repointed. */
const COCKPIT_SLUG = "fortress-6-1";
const HABITATION_SLUG = "fortress-6-2";

module.exports = {
  CHARON_SLUG,
  CHARON_SPACE_SLUG,
  KEEP_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
};
