// Where a Move happened, for the adjudication desk. No imports on purpose: web/lib/__tests__ loads this file by path with no Prisma and no "@/" alias behind it.
//
// The Location stamped on the Move at filing (Action.locationId, written by db/lib/moves.js#fileMove) and the zone stamped beside it. Else — a row filed before the stamp existed, or a Move the game filed that never set one — where the character is standing now. A free zone move costs no Action, so by the time a GM rules the two are often different places, and the Move's description is about the first. The pair is taken whole, never one half from each: a stamped Location is named under the stamped zone, a live one under the live zone.
//
// `a` needs { location, zone, character: { location, zone } }, each { id, name } or null (MOVE_INCLUDE in moveRows.js loads all four).
export function moveWhere(a) {
  const filed = a.location != null;
  const zone = (filed ? a.zone : a.character?.zone) ?? null;
  const location = (filed ? a.location : a.character?.location) ?? null;
  return {
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? "",
    locationId: location?.id ?? null,
    label: location?.name ? `${zone?.name ?? "?"} · ${location.name}` : zone?.name || "Unassigned",
  };
}

// The Location whose structures the desk lists under a Move, which is the one moveRow() prints. The bulk loaders (deskRows.js, the /gm/turns page) call this so they load the same place.
export function moveLocationId(a) {
  return moveWhere(a).locationId;
}
