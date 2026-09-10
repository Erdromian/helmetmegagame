// Which zones one GM has chosen to see. The single reader of GmZoneView, so
// the web desks, the Discord role sync and the /zone command cannot disagree
// about what a GM is looking at.
//
// NO ROWS MEANS EVERY ZONE, and that is represented as `null` rather than as
// a list of every id. Callers can then skip filtering entirely in the common
// case, and — more importantly — "I picked nothing" and "I picked all seven"
// stay the same thing however the roster of zones changes later.
async function visibleZoneIds(prisma, discordUserId) {
  if (!discordUserId) return null;
  const rows = await prisma.gmZoneView.findMany({
    where: { discordUserId },
    select: { zoneId: true },
  });
  if (rows.length === 0) return null;
  const picked = rows.map((r) => r.zoneId);

  // A GM can only ever PICK a seat, and a seat is not always a place.
  // listSelectableZones offers the zones that have a gmRoleId, so the whole
  // cave system is one tick — "Underground" — while the Locations, Rooms and
  // stamped rows underneath it belong to Caves and Depths, which are never in
  // the table. Returning the picked ids alone therefore handed every id-side
  // caller a zone with no Locations in it: a GM watching Underground read no
  // cave places on /chat at all, and could not speak a line into one.
  //
  // So the seat is expanded to the zones it OWNS before it leaves this
  // function. Zone.seatZoneId is the sync's own denormalization of
  // `parentZoneId ?? id` (db/lib/seatZone.js), so a surface zone matches
  // itself and a cave level matches its group; parentZoneId is checked too so
  // a zone the sync has not backfilled behaves exactly as it did before.
  //
  // The NAME side of this fold lives in web/lib/zones.js#inVisibleZones, which
  // learned it first — the desks compare zone names, everything here compares
  // ids, and the two have to say the same thing.
  const owned = await prisma.zone.findMany({
    where: { OR: [{ seatZoneId: { in: picked } }, { parentZoneId: { in: picked } }] },
    select: { id: true },
  });
  return new Set([...picked, ...owned.map((z) => z.id)]);
}

// Replaces a GM's whole selection in one statement pair, so a partial failure
// cannot leave them holding half of two different answers. An empty list is a
// real request — it means "back to everything" — and is stored as no rows,
// which is exactly what visibleZoneIds reads as all.
async function setVisibleZones(prisma, discordUserId, zoneIds) {
  const wanted = [...new Set((zoneIds ?? []).filter(Boolean))];
  await prisma.$transaction([
    prisma.gmZoneView.deleteMany({ where: { discordUserId } }),
    ...(wanted.length > 0
      ? [prisma.gmZoneView.createMany({ data: wanted.map((zoneId) => ({ discordUserId, zoneId })) })]
      : []),
  ]);
  return wanted;
}

module.exports = { visibleZoneIds, setVisibleZones };
