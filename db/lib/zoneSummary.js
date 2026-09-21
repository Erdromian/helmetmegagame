// One question, asked in a dozen places: does this zone own a #summary channel?
//
// Most of the game never has to ask — a zone with no #summary simply has a null
// `discordSummaryChannelId`, and every fan-out (worldBroadcast, intercom,
// placeLine, the ordering pass) skips it on its own. This predicate is for the
// two places that must decide BEFORE a channel id exists: what the mirror
// provisions (db/lib/zoneChannelSpec.js), and where a public declaration goes
// instead (db/lib/publicPostTargets.js).
//
// Three zones answer no, for two different reasons:
//   - a CAVE_GROUP is a category and a GM seat, never a place anyone stands;
//   - a CAVE_LEVEL is a place, but you only see the level you are in, so it
//     wears its Location channels and nothing above them (CHANNELS.md §2);
//   - Space is a SURFACE zone with one Location — the Charon, once it has
//     launched. A #summary there would be a second channel for the one room
//     aboard, and a zone-wide announcement into it would be a voice reaching
//     orbit. It behaves like a cave level: what reaches everyone reaches the
//     Location channel instead.
//
// Slug-keyed for the db/lib/roleIds.js reason: there is one map, Space is one
// zone in it, and a column nobody could ever set differently is a column that
// only gets set wrong.
const NO_SUMMARY_ZONE_SLUGS = new Set(["space"]);

function zoneHasSummary(zone) {
  if (!zone) return false;
  if (zone.kind === "CAVE_GROUP" || zone.kind === "CAVE_LEVEL") return false;
  return !NO_SUMMARY_ZONE_SLUGS.has(zone.slug);
}

// Zones whose announcements go to their Location channels instead. A CAVE_GROUP
// is excluded: it has no Locations, and nothing is standing in it to be told.
function zoneFansOutToLocations(zone) {
  return Boolean(zone) && zone.kind !== "CAVE_GROUP" && !zoneHasSummary(zone);
}

module.exports = { zoneHasSummary, zoneFansOutToLocations, NO_SUMMARY_ZONE_SLUGS };
