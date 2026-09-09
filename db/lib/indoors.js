// Parking a cart or a mount — at an indoor door, or on a way too narrow for
// it (docs/systemdocs/CARRY.md §3, MAP.md §3).
//
// A Location marked `indoors: true` in docs/zones.yaml is a place you walk
// INTO — the Cathedral, the Sanctuary, the Inn, the Keep, the Undercroft, the
// Factory. You cannot bring a horse into a chapel, so arriving unequips
// anything stowable and says so. A LocationLink marked `onFoot: true` is the
// other trigger for the same thing: a crawl, a cliff path, a lift, a culvert
// too tight for a horse or a cart — crossing one unequips it instead of
// refusing the crossing outright. Either way the carry bonus goes with it,
// which is the whole point: the cap shrinks, and the character is very likely
// Overburdened until they take the reins again.
//
// Nothing is ever DROPPED for this. settleCarry's overflow is
// acquisition-driven, so losing capacity makes someone Overburdened and no
// more — never dumps a cart's contents on the ground.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the same
// posture as carry.js, because locationMove.js requires it.
const { STOWABLE_SLUGS } = require("./mounts");

// Unequips every stowable a character currently has out. Returns the display
// names, so a caller can DM them — this module does no Discord work of its
// own. Shared by both triggers below: whatever brought them here, the
// character ends up on their own two feet the same way.
async function unequipStowables(prisma, characterId) {
  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { slug: { in: [...STOWABLE_SLUGS] } } },
    select: { id: true, tag: { select: { name: true } } },
  });
  if (held.length === 0) return [];

  await prisma.characterTag.updateMany({
    where: { id: { in: held.map((ct) => ct.id) } },
    // equippedQuantity too, not just the boolean — left stale it would go on
    // spending a slot nobody can see is spent. None of STOWABLE_SLUGS is
    // stackable, so 0 is exactly "not equipped" for these.
    data: { equipped: false, equippedQuantity: 0 },
  });
  return held.map((ct) => ct.tag.name);
}

// Arriving somewhere indoors.
async function parkMountsIndoors(prisma, characterId, locationId) {
  if (!characterId || !locationId) return [];
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { indoors: true },
  });
  if (!location?.indoors) return [];
  return unequipStowables(prisma, characterId);
}

// Crossing a way too narrow for what they had out. `link` is whatever
// db/lib/locationGraph.js#linkBetween found for this move, or null on a first
// placement — nothing to dismount for, since nobody crossed anything.
async function dismountForNarrowWay(prisma, characterId, link) {
  if (!characterId || !link?.onFoot) return [];
  return unequipStowables(prisma, characterId);
}

// The sentence the DM carries. Kept here beside the rule so the bot and the
// web app can never word it differently.
function parkedMessage(names, locationName) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You leave your ${list} outside ${locationName}. You can take ${names.length === 1 ? "it" : "them"} up again on your way out.`;
}

// Same shape, for a crossing rather than a doorway — there is no "outside
// {place}" to name, since the way itself was the obstacle.
function dismountedMessage(names) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The way was too narrow for your ${list}. You leave ${names.length === 1 ? "it" : "them"} behind and go on foot. ‡`;
}

module.exports = { parkMountsIndoors, parkedMessage, dismountForNarrowWay, dismountedMessage };
