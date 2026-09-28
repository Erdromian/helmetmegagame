// Shared "a GM just set blood/humanity by hand, sync the chips right now"
// clean-up (docs/systemdocs/VAMPIRE.md) — mirrors db/lib/hungerDescriptor.js's
// shape for the same reason: a GM restoring a vampire's blood to 100 after
// judging a feeding Gambit should see Pale/Bloodcrazed clear immediately
// rather than waiting for the next turn close.
//
// Deliberately NOT how db/lib/vampirePass.js manages its own grant/drop —
// that pass already batches every vampire through one $transaction of
// createMany/deleteMany arrays; this helper exists purely for the single-
// character, immediate-effect caller (the GM character-edit screen), and
// unlike the pass it may need to GRANT a worse band (a GM lowering blood by
// hand), not just drop a recovered one, so it resolves its own open turn for
// the grant's expiry the way db/lib/tagWrites.js#grantTagSlugs requires.
//
// Takes `tx` first, same convention as db/lib/tagWrites.js, so a caller can
// compose this into a larger transaction.
const {
  FLUSH_SLUG,
  SATIATED_SLUG,
  THIRSTY_SLUG,
  FAMISHED_SLUG,
  BLOODCRAZED_SLUG,
  BLACK_SCLERA_SLUG,
  PALE_SLUG,
  HUMANE_SLUG,
  ESTRANGED_SLUG,
  DISTURBED_SLUG,
  WARPED_SLUG,
  BESTIAL_SLUG,
} = require("./constants");
const { expiryFrom } = require("./turnFormat");
const {
  bloodUrgencyBand,
  isPale,
  hasBlackSclera,
  humanityBand,
} = require("./vampire");

const URGENCY_SLUGS = [FLUSH_SLUG, SATIATED_SLUG, THIRSTY_SLUG, FAMISHED_SLUG, BLOODCRAZED_SLUG];
const HUMANITY_BAND_SLUGS = [HUMANE_SLUG, ESTRANGED_SLUG, DISTURBED_SLUG, WARPED_SLUG];
const CYCLIC_SLUGS = [...URGENCY_SLUGS, BLACK_SCLERA_SLUG, PALE_SLUG, ...HUMANITY_BAND_SLUGS];

// Does NOT touch Bestial/Wight — those are permanent and one-time-earned by
// db/lib/vampirePass.js crossing into 0 humanity, never re-derived from a
// GM's raw number. A GM who wants to undo them removes the tags directly.
//
// `openTurnNumber` is for a caller that already knows which turn the grants
// land in — the turn push (db/lib/stagedScalesApply.js), where the closing
// turn and the next one are both in play and a lookup would have to guess.
async function syncVampireBandsNow(tx, characterId, bloodLevel, humanity, { openTurnNumber = null } = {}) {
  const tags = await tx.tag.findMany({
    where: { slug: { in: [...CYCLIC_SLUGS, BESTIAL_SLUG] } },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));
  const missing = CYCLIC_SLUGS.filter((slug) => !bySlug.has(slug));
  if (missing.length) {
    console.error(`syncVampireBandsNow skipped: missing tag(s) ${missing.join(", ")} — run npm run db:sync-tags.`);
    return;
  }

  const held = await tx.characterTag.findMany({
    where: { characterId, tagId: { in: tags.map((t) => t.id) } },
    select: { tagId: true },
  });
  const heldIds = new Set(held.map((row) => row.tagId));
  const heldBestial = heldIds.has(bySlug.get(BESTIAL_SLUG).id);

  const openTurn =
    openTurnNumber != null
      ? { number: openTurnNumber }
      : await tx.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  const toGrant = [];
  const toDropIds = [];

  const wantUrgency = bloodUrgencyBand(bloodLevel);
  const wantPale = isPale(bloodLevel);
  const wantBlackSclera = hasBlackSclera(bloodLevel);
  const wantHumanityBand = heldBestial ? null : humanityBand(humanity);

  const wants = new Map([
    ...URGENCY_SLUGS.map((slug) => [slug, slug === wantUrgency]),
    [PALE_SLUG, wantPale],
    [BLACK_SCLERA_SLUG, wantBlackSclera],
    ...HUMANITY_BAND_SLUGS.map((slug) => [slug, !heldBestial && slug === wantHumanityBand]),
  ]);

  for (const slug of CYCLIC_SLUGS) {
    const tag = bySlug.get(slug);
    const isHeld = heldIds.has(tag.id);
    const isWanted = wants.get(slug);
    if (isWanted && !isHeld) toGrant.push(tag);
    else if (!isWanted && isHeld) toDropIds.push(tag.id);
  }

  if (toDropIds.length) {
    await tx.characterTag.deleteMany({ where: { characterId, tagId: { in: toDropIds } } });
  }
  for (const tag of toGrant) {
    const expiresTurn = openTurn ? expiryFrom(openTurn.number, tag.defaultDurationTurns ?? 1) : null;
    await tx.characterTag.upsert({
      where: { characterId_tagId: { characterId, tagId: tag.id } },
      create: { characterId, tagId: tag.id, source: "EVENT", expiresTurn },
      update: { expiresTurn },
    });
  }
}

module.exports = { syncVampireBandsNow };
