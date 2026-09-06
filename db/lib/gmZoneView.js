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
  return new Set(rows.map((r) => r.zoneId));
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
