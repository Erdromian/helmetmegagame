// The zone code — the zones as a colour vocabulary.
//
// Lives in web/lib rather than db/lib because a CSS token key is of no use to
// the bot; db/lib is for what both faces genuinely need. Nothing here touches
// Prisma.
//
// Callers hand this a zone NAME rather than a slug, because most of them have
// a display row and not a Zone. The name is slugified and checked against the
// known set, which degrades correctly: an unrecognised zone yields null and
// renders the neutral chip, rather than an uncoloured mark or a throw.
//
// "Underground" is deliberately absent. It is a CAVE_GROUP — a category and a
// GM seat, never a place — so it has no chip to colour; its two levels, Caves
// and Depths, carry their own.

// Canonical order, matching the zones: → factions: nesting in docs/roles.yaml
// and the reading order of the map: the two built-up places, the three
// stretches of wild, then down.
export const ZONE_KEYS = [
  "fortress",
  "town",
  "forest",
  "hills",
  "marshes",
  "caves",
  "depths",
];

// Zone NAMES that don't slugify to their own key. Both of these read as
// unrecognised without the alias, which costs them their chip colour and drops
// them to the tail of every sorted list — "Black Hills" has been doing exactly
// that since it was renamed, and the GM zone picker is where it finally showed.
// "Underground" is the caves SEAT (Zone.seatZoneId), so it wears the caves
// colour rather than a seventh of its own.
const ZONE_KEY_ALIASES = {
  "black-hills": "hills",
  underground: "caves",
};

export function zoneKey(zoneName) {
  if (!zoneName) return null;
  const slug = String(zoneName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = ZONE_KEY_ALIASES[slug] ?? slug;
  return ZONE_KEYS.includes(key) ? key : null;
}

// The same name, folded onto the zone that OWNS it — the GM-seat key.
//
// Presence is six zones; the GM seats are four, with the whole cave system
// belonging to one. That is Zone.seatZoneId on the data side
// (db/lib/seatZone.js), and this is its display-name twin, for the one caller
// that holds names rather than rows.
//
// zoneKey already folds "Underground" onto `caves`, so the only thing left to
// say is that Depths sits under the same seat. It gets its own chip COLOUR —
// which is why this is a second function and not a third alias.
const CAVE_SEAT_KEY = "caves";
const CAVE_LEVEL_KEYS = ["caves", "depths"];

export function seatKey(zoneName) {
  const key = zoneKey(zoneName);
  return CAVE_LEVEL_KEYS.includes(key) ? CAVE_SEAT_KEY : key;
}

// Sorts a list of {name} zones into the canonical order above, with anything
// unrecognised falling to the end alphabetically rather than vanishing.
export function sortZones(zones) {
  return [...zones].sort((a, b) => {
    const ai = ZONE_KEYS.indexOf(zoneKey(a.name));
    const bi = ZONE_KEYS.indexOf(zoneKey(b.name));
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}


// The zone-view gate, shared by all three GM tables — the players rail, the
// roster and the adjudication queue. One copy because it is a policy, not a
// filter: the "no faction zone means everyone sees it" rule below is a real
// decision, and three copies of it would drift the moment somebody tuned one.
//
// `visibleZoneNames` null means every zone — see web/lib/gmZoneView.js. Rows
// carry `factionZoneName` on every desk, which is the SEAT zone (the zone
// their faction answers to), not where they happen to be standing.
//
// A row that knows where it PHYSICALLY happened says so in `zoneName`, and
// that wins. Only the Caving lens carries one: a roll in the Caves by somebody
// seated in the Marshes belongs to the Caves GM, and gating it on the seat put
// it in front of the wrong person and hid it from the right one. A Move row
// has no `zoneName` and keeps the seat rule untouched.
//
// A row names the zone it is IN; a GM ticks a zone that has a SEAT. Those two
// vocabularies are not the same list, and comparing them by name silently hid
// the whole cave system: a Zone row reads "Caves" or "Depths", while the only
// pick behind them is "Underground" (they are CAVE_LEVELs with no gmRoleId, so
// listSelectableZones cannot offer them — web/lib/gmZoneView.js). Every
// character standing in a cave, every caving roll, invisible to any GM who had
// ticked anything at all. db:sync-zones already resolves the Discord half this
// way ("pick Underground and you get the cave channels AND the cave rows"); the
// seat match below is the desk half of that same sentence.
//
// Additive on purpose: the exact-name match stays, so a zone name this file
// does not recognise behaves exactly as it does today and nothing visible now
// can become hidden.
export function inVisibleZones(rows, visibleZoneNames) {
  if (!visibleZoneNames) return rows ?? [];
  const allowedNames = new Set(visibleZoneNames);
  const allowedSeats = new Set(visibleZoneNames.map(seatKey).filter(Boolean));
  // A row with no zone at all stays visible to everyone. Better seen twice
  // than by nobody.
  return (rows ?? []).filter((r) => {
    const zone = r.zoneName || r.factionZoneName;
    if (!zone) return true;
    if (allowedNames.has(zone)) return true;
    const seat = seatKey(zone);
    return Boolean(seat) && allowedSeats.has(seat);
  });
}
