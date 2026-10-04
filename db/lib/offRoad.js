// Places with no road at either end: the Charon on the ground and the Charon in
// orbit, and nothing else today (docs/systemdocs/CHARON.md §2). You cannot walk
// to one, so nothing but its own door may put a player there: the Panic Room's
// Enter, the Cockpit's launch, a GM's Teleport. You cannot walk off one either,
// so nothing but its own door takes a player away: the ground ship's Leave, the
// Habitation's Sleep, a GM. Every raw relocation a player can set off — the
// Stepstone, a first placement, Bat Form, Xom's lonely teleport, the Rite of
// Summoning — asks here at both ends.
//
// The honest test rather than a slug check, the one revealSurface and Bat Form
// already used: no LocationLink means no way there, and the second road-less
// place needs no code. Zero requires — the db/lib/sfx.js convention — so the
// move pipeline, the rites and the Xom pass can all reach it without a cycle.

/** Location `where`: a road at either end. A fresh object per call, so a caller may spread it. */
function onRoadsWhere() {
  return { OR: [{ linksA: { some: {} } }, { linksB: { some: {} } }] };
}

/**
 * Location `where`: somewhere anything but its own door may set a player down —
 * live, in a live zone, on the roads. Spread into a `where` that has no `OR` or
 * `zone` of its own, or nest it under `AND`.
 */
function arrivableWhere() {
  return { retiredAt: null, zone: { retiredAt: null }, ...onRoadsWhere() };
}

/** True when `locationId` is somewhere anything but its own door may set a player down. */
async function isArrivable(db, locationId) {
  if (!locationId) return false;
  return (await db.location.count({ where: { id: locationId, ...arrivableWhere() } })) > 0;
}

/**
 * True when `locationId` has no road — the one way off is the place's own door.
 * Unplaced (null) is not off-road: there is nothing to leave.
 */
async function isOffRoad(db, locationId) {
  if (!locationId) return false;
  return (await db.location.count({ where: { id: locationId, ...onRoadsWhere() } })) === 0;
}

/** Every road-less Location's id, for a pass that asks about many characters at once. */
async function offRoadLocationIds(db) {
  const rows = await db.location.findMany({
    where: { linksA: { none: {} }, linksB: { none: {} } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

module.exports = { onRoadsWhere, arrivableWhere, isArrivable, isOffRoad, offRoadLocationIds };
