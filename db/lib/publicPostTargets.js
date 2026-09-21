// Where a staged PUBLIC declaration goes: a zone with a #summary posts to it; a zone without one (the two cave levels, and Space — db/lib/zoneSummary.js)
// posts into EVERY Location channel it holds. One source of truth for the push, Resend and delivery callers (ADJUDICATION.md §1a). Takes `prisma`, off the @lifeweb/db barrel.
const { zoneFansOutToLocations } = require("./zoneSummary");

// `publicKey` becomes the tail of Delivery.dedupeKey (deliveryKeyFor reads that exact field name) — get it wrong and skipDuplicates collapses every
// target into ONE row. A Location target is keyed by the LOCATION, never its channel id, since syncZones.js/channelDoctor.js rewrite it on reprovision.
function publicTargetsFor({ zone, locations = [] } = {}) {
  if (!zone) return [];

  if (zoneFansOutToLocations(zone)) {
    return locations
      .filter((location) => location?.discordChannelId)
      .map((location) => ({
        publicKey: `public:loc:${location.id}`,
        channelId: location.discordChannelId,
        name: location.name,
      }));
  }

  // CAVE_GROUP has no summary and no Locations — empty list. `name` stays NULL: stagedFormat.js#deliveryNotes renders `d.name ?? "the channel"`.
  if (!zone.discordSummaryChannelId) return [];
  return [{ publicKey: "public", channelId: zone.discordSummaryChannelId, name: null }];
}

async function publicPostTargets(prisma, zoneId) {
  if (!zoneId) return { zone: null, targets: [] };

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true, slug: true, kind: true, discordSummaryChannelId: true },
  });
  if (!zone) return { zone: null, targets: [] };

  const locations =
    zoneFansOutToLocations(zone)
      ? await prisma.location.findMany({
          where: { zoneId: zone.id, discordChannelId: { not: null } },
          // Same ordering as worldBroadcast.js#ambientEverywhere.
          orderBy: { name: "asc" },
          select: { id: true, name: true, discordChannelId: true },
        })
      : [];

  return { zone, targets: publicTargetsFor({ zone, locations }) };
}

module.exports = { publicTargetsFor, publicPostTargets };
