// Keeps a character's one hunger descriptor tag (Full, Hungry or Starving —
// db/lib/hunger.js#DESCRIPTORS) in step with their meter the moment it moves
// outside the turn close: eating (web/app/(app)/character/actions/misc.js)
// and the Dev Panel's Feed Them (gm/dev/characters/[characterId]/actions.js).
// db/lib/hungerPass.js does the same for the whole roster in one batch.
//
// Takes `tx` first, same convention as db/lib/tagWrites.js, so a caller can
// compose this into a larger transaction.
const { HUNGER_DESCRIPTOR_SLUGS } = require("./constants");
const { bandOf, DESCRIPTORS, HUNGER_MIN } = require("./hunger");

async function syncHungerDescriptor(tx, characterId, { hungerValue, hungerless = false }) {
  const tags = await tx.tag.findMany({
    where: { slug: { in: HUNGER_DESCRIPTOR_SLUGS } },
    select: { id: true, slug: true },
  });
  const want = hungerless ? null : DESCRIPTORS[bandOf(hungerValue)].slug;
  const keepId = tags.find((t) => t.slug === want)?.id ?? null;
  const dropIds = tags.filter((t) => t.id !== keepId).map((t) => t.id);

  if (dropIds.length) {
    await tx.characterTag.deleteMany({ where: { characterId, tagId: { in: dropIds } } });
  }
  if (keepId) {
    await tx.characterTag.createMany({
      data: [{ characterId, tagId: keepId, source: "EVENT", expiresTurn: null }],
      skipDuplicates: true,
    });
  }
  // The zero clock only runs while the meter sits at 0 (hungerPass.js).
  if (hungerless || hungerValue > HUNGER_MIN) {
    await tx.character.update({ where: { id: characterId }, data: { starvingSinceTurn: null } });
  }
}

module.exports = { syncHungerDescriptor };
