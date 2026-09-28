// Where a gate is worked from, when it is not the plain watchtower case
// (docs/systemdocs/MAP.md §2a, docs/systemdocs/GATEHOUSE.md).
//
// Most modular gates are worked from a room at one of their ends: the button
// renders on that room's starter and anyone who can get in may pull it
// (db/lib/placeAffordances.js#GATE_CONTROL_ROOMS). Incarn and gates.docx adds
// two other shapes, and this file names them:
//
//   - a REMOTE LEVER: the room working the gate stands at neither end. The
//     Town Gatehouse's Gate Controls works the gate between the Bridge and the
//     Square. No ring — the doc: "a lever that can be pulled by anyone in the
//     room".
//   - an ANCHOR GATE: the button is on both Locations' own anchors, drawn for
//     everybody, and moves only for a worn ring carrying the token. The
//     portcullis between the Residences and the Courtyard. Anyone else who
//     presses it is told "Nothing happens."
//
// Pure — no Prisma, no requires beyond the zero-require text file — so the
// travel check, both faces and the tests read one answer. A link here needs
// its ends loaded with slugs (`link.a.slug`, `link.b.slug`), which is how
// db/lib/locationGraph.js hands every link out.

const {
  BRIDGE_SLUG,
  SQUARE_SLUG,
  COURTYARD_SLUG,
  RESIDENCES_SLUG,
  GATE_CONTROLS_ROOM_SLUG,
  PORTCULLIS_KEY,
  GATEHOUSE_TEXT: T,
} = require("./gatehouseText");

const REMOTE_LEVERS = Object.freeze([
  Object.freeze({ roomSlug: GATE_CONTROLS_ROOM_SLUG, ends: [BRIDGE_SLUG, SQUARE_SLUG], control: T.gateControl }),
]);

const ANCHOR_GATES = Object.freeze([
  Object.freeze({ ends: [COURTYARD_SLUG, RESIDENCES_SLUG], token: PORTCULLIS_KEY, control: T.gateControl }),
]);

// A travel refusal of its own, for a gate the default ("somebody in the
// watchtower would have to work the winch") would describe wrongly.
const SHUT_REFUSALS = Object.freeze([
  Object.freeze({ ends: [BRIDGE_SLUG, SQUARE_SLUG], text: T.shutBlackHills }),
  Object.freeze({ ends: [COURTYARD_SLUG, RESIDENCES_SLUG], text: T.shutPortcullis }),
]);

function endSlugs(link) {
  const a = link?.a?.slug;
  const b = link?.b?.slug;
  return a && b ? [a, b] : null;
}

function joins(link, ends) {
  const slugs = endSlugs(link);
  if (!slugs) return false;
  return (slugs[0] === ends[0] && slugs[1] === ends[1]) || (slugs[0] === ends[1] && slugs[1] === ends[0]);
}

/** The anchor-gate entry for this link, or null. */
function anchorGateFor(link) {
  return ANCHOR_GATES.find((gate) => joins(link, gate.ends)) ?? null;
}

/** The remote lever working this link, or null. */
function remoteLeverFor(link) {
  return REMOTE_LEVERS.find((lever) => joins(link, lever.ends)) ?? null;
}

/** The remote lever a room holds, or null. */
function remoteLeverIn(roomSlug) {
  return REMOTE_LEVERS.find((lever) => lever.roomSlug === roomSlug) ?? null;
}

/** Is this gate worked somewhere other than a watchtower at one of its ends? */
function workedElsewhere(link) {
  return Boolean(anchorGateFor(link) || remoteLeverFor(link));
}

/** What travel says while this gate is shut, or null for the default. */
function shutRefusalFor(link) {
  return SHUT_REFUSALS.find((entry) => joins(link, entry.ends))?.text ?? null;
}

// "The gate" from "the Gate", "The shutters" from "Shutters": the thing a
// confirm and an announcement name, off the label a button wears.
function controlThing(control) {
  const word = String(control ?? "").trim();
  if (!word) return null;
  const bare = word.replace(/^the\s+/i, "");
  return `The ${bare.toLowerCase()}`;
}

module.exports = {
  REMOTE_LEVERS,
  ANCHOR_GATES,
  anchorGateFor,
  remoteLeverFor,
  remoteLeverIn,
  workedElsewhere,
  shutRefusalFor,
  controlThing,
  joins,
};
