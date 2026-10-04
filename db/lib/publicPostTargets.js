// Where a staged PUBLIC declaration goes: a zone with a #summary posts to it; a zone without one (the two cave levels, and Space — db/lib/zoneSummary.js)
// posts into EVERY Location channel it holds. A declaration staged for one PLACE posts there instead: a Room's thread, or a Location's channel.
// One source of truth for the push, Resend and delivery callers (ADJUDICATION.md §1a). Takes `prisma`, off the @lifeweb/db barrel.
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

// One place's chat. A Room is keyed by the ROOM and a Location by the LOCATION, for the reason above; the Location key is the cave
// fan-out's own shape, which is fine — keys are per message, and one message has one kind of target.
function placeTargetsFor({ room = null, location = null } = {}) {
  if (room) {
    if (!room.discordThreadId) return [];
    return [{ publicKey: `public:room:${room.id}`, channelId: room.discordThreadId, name: room.name }];
  }
  if (location) {
    if (!location.discordChannelId) return [];
    return [{ publicKey: `public:loc:${location.id}`, channelId: location.discordChannelId, name: location.name }];
  }
  return [];
}

// `message` is the StagedMessage (or the push's copy of it): zoneId, and for a place post locationId / roomId / placeName.
// `place` is null for a zone post, and otherwise says what the Hall row and a "nowhere to post" failure should name.
async function publicPostTargets(prisma, message) {
  const { zoneId = null, locationId = null, roomId = null, placeName = null } =
    typeof message === "string" ? { zoneId: message } : (message ?? {});

  // A place post whose place has since been deleted: SetNull emptied both ids and left the name. It must not fall back to the #summary.
  if (placeName && !locationId && !roomId) {
    return { zone: null, targets: [], place: { kind: "gone", name: placeName } };
  }

  if (roomId) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true, discordThreadId: true, location: { select: { name: true } } },
    });
    if (!room) return { zone: null, targets: [], place: { kind: "gone", name: placeName } };
    const name = placeName ?? `${room.location?.name ?? "?"} — ${room.name}`;
    return {
      zone: null,
      targets: placeTargetsFor({ room: { ...room, name } }),
      place: { kind: "room", roomId: room.id, name },
    };
  }

  if (locationId) {
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, discordChannelId: true },
    });
    if (!location) return { zone: null, targets: [], place: { kind: "gone", name: placeName } };
    return {
      zone: null,
      targets: placeTargetsFor({ location }),
      place: { kind: "location", locationId: location.id, name: location.name },
    };
  }

  if (!zoneId) return { zone: null, targets: [], place: null };

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true, slug: true, kind: true, discordSummaryChannelId: true },
  });
  if (!zone) return { zone: null, targets: [], place: null };

  const locations =
    zoneFansOutToLocations(zone)
      ? await prisma.location.findMany({
          where: { zoneId: zone.id, discordChannelId: { not: null } },
          // Same ordering as worldBroadcast.js#ambientEverywhere.
          orderBy: { name: "asc" },
          select: { id: true, name: true, discordChannelId: true },
        })
      : [];

  return { zone, targets: publicTargetsFor({ zone, locations }), place: null };
}

module.exports = { publicTargetsFor, placeTargetsFor, publicPostTargets };
