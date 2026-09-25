// What a zone crossing costs in TRAVEL (MAP.md §3). Zero requires on purpose:
// db/lib/locationGraph.js stamps it on every destination row and
// db/lib/locationTravel.js spends it, and those two already require each other
// through crossingCheck — a third module in that loop would resolve to a
// half-built exports object.
//
// The three zones of the town proper are a short walk apart: a crossing
// between any two of them costs 1. Everything else — out to the Black Hills,
// down into the caves, or off the map — is the full 2. A hop inside one zone
// costs nothing at all, and that stays where it always was (a same-zone hop
// never reaches the spend at all).
const TOWN_ZONE_SLUGS = new Set(["town", "fortress", "undertown"]);
const NEAR_CROSSING_COST = 1;
const FAR_CROSSING_COST = 2;

function crossingCost(fromZoneSlug, toZoneSlug) {
  if (!fromZoneSlug || !toZoneSlug || fromZoneSlug === toZoneSlug) return 0;
  return TOWN_ZONE_SLUGS.has(fromZoneSlug) && TOWN_ZONE_SLUGS.has(toZoneSlug) ? NEAR_CROSSING_COST : FAR_CROSSING_COST;
}

module.exports = { TOWN_ZONE_SLUGS, NEAR_CROSSING_COST, FAR_CROSSING_COST, crossingCost };
