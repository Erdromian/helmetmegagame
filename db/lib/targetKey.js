// What a posted target key names. Every people-picker on /character sends one of these back, and two
// shapes reach here: "character:<id>" for somebody standing in the open, and "hood:<token>" for
// somebody in a mask. The token exists because a concealed row must not carry a Character.id to the
// browser at all — /api/avatar/<id> is ungated, so handing over the id IS the unmasking
// (db/lib/presentedMembers.js). This is the one place a key becomes an id again.
//
// It replaces two inline copies that had drifted apart: transfer.js#hoodedKey rewrote the key and
// offers.js#searchRequestImpl unwrapped it into a bare id, so the same token took two different paths
// depending on which verb you reached it through.
//
// resolveHoodToken re-derives co-presence itself and answers null for anybody not standing at the
// viewer's Location, which is what stops a token being a roster oracle — a stolen one from yesterday
// names nobody today.
//
// The token is the ONLY way to reach a hood. A plain id for somebody standing here in a mask resolves
// to nobody, exactly like an id for somebody who is not here at all. Before, every body verb took the
// id and landed — "You attack a young man." — so anybody who had ever seen a character's id could
// post it by hand and learn whether that was who stood under the hood.
const { resolveHoodToken, hiddenFrom } = require("./whosHere");

const CHARACTER_PREFIX = "character:";
const HOOD_PREFIX = "hood:";

// Pure: the shape of a key, never a lookup. A PartySelect writes "character:<id>" around whatever it
// was given, so a hood arrives double-wrapped as "character:hood:<token>" — strip the outer one first.
function splitTargetKey(raw) {
  const key = String(raw ?? "");
  const bare = key.startsWith(CHARACTER_PREFIX) ? key.slice(CHARACTER_PREFIX.length) : key;
  if (bare.startsWith(HOOD_PREFIX)) return { kind: "hood", value: bare.slice(HOOD_PREFIX.length) };
  return { kind: "character", value: bare };
}

// The id the key names, or null. Null is always "nobody you can reach", never an error: a made-up id,
// an expired token and a token for somebody who has since walked off all deserve the same answer, so
// that none of them tells the caller which of the three it was.
async function resolveTargetKey(prisma, actor, raw, { sightings = null, allowDead = false } = {}) {
  const { kind, value } = splitTargetKey(raw);
  if (!value) return null;
  // `allowDead` widens who a HOOD token may name, and which bodies the hood
  // check below looks at. A plain character key is otherwise still just an id,
  // and the caller's own isHere() decides whether a body is a legal target for
  // that verb — this flag exists so the token resolver and that check can agree
  // rather than one of them quietly disagreeing.
  if (kind === "hood") return resolveHoodToken(prisma, actor, value, { sightings, includeDead: allowDead });
  if (await hiddenFrom(prisma, actor, value, { sightings, includeDead: allowDead })) return null;
  return value;
}

module.exports = { resolveTargetKey, splitTargetKey };
