// What a zone crossing costs in TRAVEL (MAP.md §3). Zero requires on purpose:
// db/lib/locationGraph.js stamps it on every destination row and
// db/lib/locationTravel.js spends it, and those two already require each other
// through crossingCheck — a third module in that loop would resolve to a
// half-built exports object.
//
// The three zones of the town proper are a short walk apart: a crossing
// between any two of them costs half a travel. Everything else — out to the
// Black Hills, down into the caves, or off the map — is a full 1. A hop inside
// one zone costs nothing at all, and that stays where it always was (a
// same-zone hop never reaches the spend at all).
//
// Halves are exact in a double, so the counters (Character.zoneMovesUsed,
// GameConfig.freeZoneMovesPerTurn) are Float columns and add up without drift.
const TOWN_ZONE_SLUGS = new Set(["town", "fortress", "undertown"]);
const NEAR_CROSSING_COST = 0.5;
const FAR_CROSSING_COST = 1;

function crossingCost(fromZoneSlug, toZoneSlug) {
  if (!fromZoneSlug || !toZoneSlug || fromZoneSlug === toZoneSlug) return 0;
  return TOWN_ZONE_SLUGS.has(fromZoneSlug) && TOWN_ZONE_SLUGS.has(toZoneSlug) ? NEAR_CROSSING_COST : FAR_CROSSING_COST;
}

// A travel amount the way a player reads it: "½", "1", "1½". Every surface
// that prints a cost or what is left goes through here — the web's Travel
// panel, map card, sheet tile and result line, and the bot's picker — so a
// half never shows up as "0.5" on one and "½" on another.
function formatTravel(amount) {
  const n = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

module.exports = { TOWN_ZONE_SLUGS, NEAR_CROSSING_COST, FAR_CROSSING_COST, crossingCost, formatTravel };
