// Consumables that quietly take something off the sheet.
//
// Not the cure ladder (TAGS.md §5c), not Tag.removesInto, and deliberately
// not in the catalog: a tag that ADVERTISED its own cure would stop being a
// discovery. Nothing in a description, a systemdoc or the handbook says any of
// this. A player finds out by eating one and noticing.
//
// Keyed by the slug of the thing CONSUMED; the value is what comes off the
// eater. Ordinary consumesInto grants are untouched and still apply — this
// runs after them, so Bliss still leaves you Euphoric and High.
//
// Takes a tx as a parameter, the db/lib/dm.js convention, and stays off the
// @lifeweb/db barrel.
//
// leeches' entry moved onto Tag.cures (the medical pass's item-cure field,
// TAGS.md §5c) — it was the one ADVERTISED entry here, so it belongs on the
// mechanism a player can actually read rather than this hidden one.

const HIDDEN_CURES = {
  bliss: ["depressed"],
};

// Drops whatever the consumed slug cures, if the character is holding it.
// Returns the slugs actually taken off, for the caller's own logging — the
// consume request records nothing about it, so an Undo of the consume does
// NOT put the cured tag back. That is the intent: the cure is a thing that
// happened to them, not a line item in a receipt.
async function applyHiddenCures(tx, characterId, consumedSlug) {
  const slugs = HIDDEN_CURES[consumedSlug];
  if (!slugs?.length) return [];

  const rows = await tx.characterTag.findMany({
    where: { characterId, tag: { slug: { in: slugs } } },
    select: { tagId: true, tag: { select: { slug: true } } },
  });
  for (const row of rows) await tx.characterTag.delete({ where: { characterId_tagId: { characterId, tagId: row.tagId } } });
  return rows.map((r) => r.tag.slug);
}

module.exports = { applyHiddenCures };
