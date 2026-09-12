// Where a staged PUBLIC declaration actually goes.
//
// For a SURFACE zone the answer has always been "its #summary channel", and
// that stayed true for so long that db/lib/stagedPush.js could just carry the
// id along in the push payload. It is not true underground. A CAVE_LEVEL zone
// (Caves, Depths) has no #summary and never did — db/lib/zoneChannelSpec.js
// gives it no channels at all, because its Locations parent straight onto the
// Underground category (CHANNELS.md §2). So a declaration staged against one
// was marked "no summary channel configured" and never reached a player, while
// the composer's zone picker went on offering both levels.
//
// The fix is the blunt one: underground, a declaration posts into EVERY
// Location channel in the level. There is nowhere else for it to go, and a
// player standing in the dark should still hear what the turn decided.
//
// Why this is its own module rather than a branch inside stagedDelivery.js:
// three callers need the same answer — the push, the Resend button, and the
// delivery itself — and they used to read the channel from two different
// places (a frozen payload and a live query). Two sources of truth about where
// a message goes is the shape of problem ADJUDICATION.md §1a exists to prevent.
//
// Why not db/lib/zoneChannelSpec.js: that module describes the layout the sync
// is trying to BUILD, takes no `prisma`, and knows nothing about what exists
// right now. This is a live read. db/lib/worldBroadcast.js is the real sibling
// — same size, same job, same "which channels does this reach" question.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

// The mapping on its own, with no database in it, so the rule is testable.
//
// A target's `publicKey` becomes the tail of its Delivery.dedupeKey — that
// exact field name, because a target is handed straight to ensureDeliveries as
// if it were a recipient and deliveryKeyFor reads it there. Spell it anything
// else and every target silently falls through to the same null tail, which
// skipDuplicates then collapses into ONE row: the declaration posts to the
// first channel and nowhere else. The summary target's key is the bare word
// "public", which is EXACTLY the key a public
// row has always had — production is full of `staged:<id>:public` rows, and a
// changed tail there would write a second row on every declaration ever pushed
// and invite the Resend button to post it again.
//
// A Location target is keyed by the LOCATION, never by its channel id.
// db/lib/syncZones.js and db/lib/channelDoctor.js both rewrite
// Location.discordChannelId when a channel is re-provisioned or adopted, and a
// channel-id tail would orphan a SENT row the moment that happened — so the
// next push would find a PENDING row and post the declaration into the same
// room twice. Same lesson as "the character, not their Discord account".
function publicTargetsFor({ zone, locations = [] } = {}) {
  if (!zone) return [];

  if (zone.kind === "CAVE_LEVEL") {
    return locations
      .filter((location) => location?.discordChannelId)
      .map((location) => ({
        publicKey: `public:loc:${location.id}`,
        channelId: location.discordChannelId,
        name: location.name,
      }));
  }

  // A CAVE_GROUP ("Underground") is a category and a GM seat, never a place,
  // and it has no summary either — it falls out here with an empty list.
  if (!zone.discordSummaryChannelId) return [];

  // `name` stays NULL on purpose. stagedFormat.js#deliveryNotes renders
  // `d.name ?? "the channel"`, so leaving it null keeps every surface message's
  // tray line reading exactly as it reads today, while a cave row gets to say
  // "Customs: Missing Access" for free.
  return [{ publicKey: "public", channelId: zone.discordSummaryChannelId, name: null }];
}

// The live read. `zoneId` may legitimately be null: StagedMessage.zoneId is
// optional with onDelete: SetNull, so a deleted zone leaves a PUBLIC row
// pointing at nothing. That is an empty target list, not a throw — the caller
// turns it into a sentence a GM can read.
async function publicPostTargets(prisma, zoneId) {
  if (!zoneId) return { zone: null, targets: [] };

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true, kind: true, discordSummaryChannelId: true },
  });
  if (!zone) return { zone: null, targets: [] };

  // Only a cave level needs the second query.
  const locations =
    zone.kind === "CAVE_LEVEL"
      ? await prisma.location.findMany({
          where: { zoneId: zone.id, discordChannelId: { not: null } },
          // Same ordering worldBroadcast.js#ambientEverywhere uses, so every
          // fan-out in the game walks its channels in the same order.
          orderBy: { name: "asc" },
          select: { id: true, name: true, discordChannelId: true },
        })
      : [];

  return { zone, targets: publicTargetsFor({ zone, locations }) };
}

module.exports = { publicTargetsFor, publicPostTargets };
