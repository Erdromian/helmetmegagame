// A handle for somebody in a hood that says nothing about who they are: an HMAC of the id keyed with
// AUTH_SECRET, since /api/avatar/<id> would unmask a raw Character.id. No AUTH_SECRET means no token at
// all — never an HMAC under an empty key, which would be an unmasking oracle. Zero-requires leaf beside
// dmKinds.js, for the same reason: avoids pulling in the whosHere.js -> sightings.js -> feedAccess.js chain.
//
// `nonce` is Character.presenceNonce, rolled again whenever the person moves or covers or uncovers their
// face (docs/systemdocs/STRANGERS.md §3). A list of who is here passes it, so the handle it offers dies with
// the encounter and cannot follow somebody from room to room. Without one the token is the old stable
// one, which is still what a player's OWN lines carry (chat/page.js's self.speakerKey) and what the GM's
// key ring reads (web/lib/gmSpeakers.js). Nobody else is ever handed a stable one: the feed gives them
// sceneSpeakerKey below.
const crypto = require("node:crypto");

function hoodToken(characterId, nonce = null) {
  if (!characterId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(nonce ? `hood:${characterId}:${nonce}` : `hood:${characterId}`)
    .digest("hex")
    .slice(0, 32);
}

// What groups one alias's lines in the feed (db/lib/strangers.js#lensRow): the same for every line
// somebody says in one place in one turn, different in the next place or the next turn. A browser can
// tell "the same young man again" within a scene, which the room could too, and nothing beyond it.
function sceneSpeakerKey(characterId, placeKey, turnNumber) {
  if (!characterId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`scene:${characterId}:${placeKey ?? ""}:${turnNumber ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

// The handle a listener mutes a performer by (db/lib/performance.js, HereList.js). Its own
// namespace, so it never equals a hood token and cannot be matched against one.
function performerKey(characterId) {
  if (!characterId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`performer:${characterId}`)
    .digest("hex")
    .slice(0, 32);
}

module.exports = { hoodToken, sceneSpeakerKey, performerKey };
