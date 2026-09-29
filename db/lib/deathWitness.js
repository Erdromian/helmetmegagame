// What one witness takes when somebody dies where they stand: { kind, base }.
// Everybody takes DEATH_SEEN — except a Thanati, who is lifted by
// DEATH_RELISHED instead of frightened. Who died and how does not come into
// it: a death cult is as pleased by a comrade's death as by a sacrifice's.
//
// Out of mood.js on purpose. mood.js is imported by client components (the
// Mood box, Chat's YOU column), and the one line that asked "is this a
// Thanati?" pulled db/lib/thanati.js — the seat's slug, its shelf and its
// prices — into every player's browser bundle. Server-only callers read it here.
const { EVENTS } = require("./mood");
const { isThanati } = require("./thanati");

function deathWitnessTerm(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (isThanati(held)) return { kind: "DEATH_RELISHED", base: EVENTS.DEATH_RELISHED };
  return { kind: "DEATH_SEEN", base: EVENTS.DEATH_SEEN };
}

module.exports = { deathWitnessTerm };
