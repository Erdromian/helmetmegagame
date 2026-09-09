// A handle for somebody in a hood, that says nothing about who they are.
//
// A concealed row cannot carry its Character.id to the browser:
// /api/avatar/<id> takes an id and answers with a face, so shipping one is the
// unmasking, whatever the page then chooses to draw. So a hood gets an HMAC of
// the id keyed with AUTH_SECRET, truncated — stable for as long as the secret
// is, opaque to the browser, and worthless anywhere but a resolver that
// recomputes it over a list the viewer was already entitled to.
//
// With no AUTH_SECRET there is no key, and an HMAC under the empty one is
// something anybody holding a character id can compute for themselves — which
// would turn the token from a handle into an unmasking oracle. So there is no
// token at all in that case: the row still draws, and anything acting on it
// gets the refusal a bad token already answers with.
//
// A zero-requires leaf beside dmKinds.js, and for the same reason it became
// one: whosHere.js owned this, and whosHere.js reaches sightings.js ->
// feedAccess.js -> conversations.js. Anything else wanting a hood handle —
// presentedMembers.js does — would have pulled that whole chain in a circle.
const crypto = require("node:crypto");

function hoodToken(characterId) {
  if (!characterId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`hood:${characterId}`)
    .digest("hex")
    .slice(0, 32);
}

module.exports = { hoodToken };
