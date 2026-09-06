// Which places a character may read and write, for both faces.
//
// Moved down here from web/lib/feedAccess.js in phase 1, because the one write
// path (db/lib/say.js) has to ask the same question the SSE route asks, and a
// gate that lived in web/ could only ever answer for one of them.
//
// Phase 1 answers for the Location a character stands in. Rooms,
// Conversations and the zone Summary arrive in phase 2, when placesFor() takes
// over from this; the shape here is deliberately the one that grows into it.
//
// Takes `prisma` where it needs it, same reason as archive.js and placeKey.js:
// db/index.js imports this, so requiring it back would resolve to a partial
// exports object.

const { placeKeyForLocation, parsePlaceKey } = require("./placeKey");

// The place keys a character may READ. Phase 1: the Location they stand in.
function allowedPlaceKeys(character) {
  const here = placeKeyForLocation(character?.locationId);
  return here ? [here] : [];
}

function mayReadPlace(character, placeKey) {
  return Boolean(placeKey) && allowedPlaceKeys(character).includes(placeKey);
}

// The place keys a character may SPEAK in. The same list for now; decision 5
// (Location channels become system-only) splits the two in phase 2, when the
// Location loses its composer and the Rooms gain theirs.
function mayWritePlace(character, placeKey) {
  return mayReadPlace(character, placeKey);
}

// How long a character waits between two sends in one place, in ms. The zone
// summary is a slower surface on purpose: it is a whole zone reading.
const PLACE_SLOWMODE_MS = 30_000;
const ZONE_SLOWMODE_MS = 300_000;

function slowmodeMsFor(placeKey) {
  return parsePlaceKey(placeKey)?.kind === "zone" ? ZONE_SLOWMODE_MS : PLACE_SLOWMODE_MS;
}

module.exports = {
  allowedPlaceKeys,
  mayReadPlace,
  mayWritePlace,
  slowmodeMsFor,
  PLACE_SLOWMODE_MS,
  ZONE_SLOWMODE_MS,
};
