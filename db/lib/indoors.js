// Leaving a cart or a mount behind on a way too narrow for it (CARRY.md §3, MAP.md §3). A
// LocationLink marked `onFoot: true` unequips on crossing instead of refusing it. No Location takes
// the reins at its door any more, underground included (Bascinet's call, 2026-09-27): the file keeps
// its name from when an indoors roof did. Nothing is ever DROPPED for this — settleCarry's overflow
// just makes someone Overburdened. Takes `prisma`, off the @lifeweb/db barrel (carry.js posture).
const { STOWABLE_SLUGS } = require("./mounts");

// Unequips every stowable a character currently has out. Returns display names for a caller to DM.
async function unequipStowables(prisma, characterId) {
  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { slug: { in: [...STOWABLE_SLUGS] } } },
    select: { id: true, tag: { select: { name: true } } },
  });
  if (held.length === 0) return [];

  await prisma.characterTag.updateMany({
    where: { id: { in: held.map((ct) => ct.id) } },
    // equippedQuantity too, not just the boolean — left stale it spends a slot nobody can see is spent.
    data: { equipped: false, equippedQuantity: 0 },
  });
  return held.map((ct) => ct.tag.name);
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
function dismountedMessage(names) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The way was too narrow for your ${list}. You leave ${names.length === 1 ? "it" : "them"} behind and go on foot.`;
}

module.exports = {
  dismountForNarrowWay,
  dismountedMessage,
};
