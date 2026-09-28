// Which buttons of the affordance list (db/lib/placeAffordances.js) are the
// FIXTURES of a place — the things on its walls you walk up to and work: a
// phone, an infoterminal, a slot machine, a gate. One answer for the two
// places that draw them: the right column (PlaceCard.js for the Location's,
// RoomPanel.js for the open room's) and, where that column has folded into a
// drawer, the strip over the scene (next/FixtureStrip.js). Two copies of a
// filter is how a button ends up on one and not the other.

// The room id an open place names, or null when it is not a room.
export function roomIdOf(selected) {
  if (!selected || selected.kind !== "room") return null;
  return selected.placeKey?.slice("room:".length) || null;
}

// The Location's own. Travel / Who's here? / Secret rooms? / Examine are
// answered by the column being on the page; they stay in placeAffordances.js
// for Discord. Charon's Leave is a place affordance too: it is how you get OFF
// the ship, and the ship is a Location with no edge, so Travel cannot offer it
// (docs/systemdocs/CHARON.md). The Merchant's Terminal is the Depot's own
// fixture, on no room's wall (docs/systemdocs/DEPOT.md §0c).
export function locationFixtures(affordances = []) {
  return affordances.filter(
    (entry) =>
      (entry.kind === "place" &&
        (entry.id === "noticeboard" || entry.id === "charonLeave" || entry.id === "merchantTerminal")) ||
      entry.kind === "gate" ||
      entry.kind === "keyed",
  );
}

// One room's. Storage and Search are drawn by RoomPanel itself, not as fixtures.
export function roomFixtures(affordances = [], roomId) {
  if (!roomId) return [];
  return affordances.filter(
    (entry) => entry.kind === "room" && entry.roomId === roomId && entry.id !== "storage" && entry.id !== "search",
  );
}

// What the OPEN place has on its walls: the room's when a room is open, the
// Location's when its street is. A place only watched from a vantage
// (db/lib/vantages.js) is not one you can put your hands on, and a
// conversation, the zone summary or a DM has no walls.
export function fixturesFor(affordances = [], selected) {
  if (!selected || selected.vantage) return [];
  if (selected.kind === "room") return roomFixtures(affordances, roomIdOf(selected));
  if (selected.kind === "loc") return locationFixtures(affordances);
  return [];
}
