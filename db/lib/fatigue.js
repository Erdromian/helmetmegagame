// Tired -> Exhausted ladder (docs/systemdocs/TAGS.md). Four unrelated things climb it and they
// all climb it identically: a day's mining, a day on the Factory floor (both
// db/lib/moveEffects.js), a bad night (db/lib/dawnAfflictionPass.js) and pushing on through a
// travel gate (db/lib/locationTravel.js). The Exhausted->Tired decay is the ordinary
// `expiresInto` chain (TAGS.md §5c).
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

// Returns the slug to grant, or null if already at the top of the ladder.
function nextFatigueSlug(heldSlugs) {
  if (heldSlugs.has(EXHAUSTED_SLUG)) return null;
  return heldSlugs.has(TIRED_SLUG) ? EXHAUSTED_SLUG : TIRED_SLUG;
}

// The escalation step itself: nothing -> Tired -> Exhausted, one rung per call. Shared by every
// MOVE_EFFECTS entry that climbs the ladder this way rather than granting Exhausted outright
// (db/lib/moveEffects.js's `exhausted` entry for Mining, `refined` entry for Refine).
// `turnNumber` is the CLOSING turn's number, same "+1" convention as grantExhaustedOutright.
async function applyFatigueStep(tx, characterId, turnNumber) {
  const heldTired = await tx.characterTag.findFirst({
    where: { characterId, tag: { slug: TIRED_SLUG } },
    select: { id: true, expiresTurn: true },
  });
  // The caller's own refusal gate already blocks an Exhausted character, so this is always
  // Tired or nothing.
  const targetSlug = nextFatigueSlug(new Set(heldTired ? [TIRED_SLUG] : []));
  if (!targetSlug) return null; // defensive: nothing left to escalate to
  const tag = await tx.tag.findUnique({
    where: { slug: targetSlug },
    select: { id: true, defaultDurationTurns: true },
  });
  if (!tag) {
    console.error(`Fatigue step: no "${targetSlug}" tag — run npm run db:sync-tags. Fatigue won't be limited.`);
    return null;
  }
  // Escalating: the Tired row is consumed by the upgrade, or the character ends up holding both.
  if (heldTired) await tx.characterTag.delete({ where: { id: heldTired.id } });
  // skipDuplicates: an existing Tired/Exhausted keeps its own clock (same rule as db/lib/tagExpiryPass.js).
  await tx.characterTag.createMany({
    data: [{
      characterId,
      tagId: tag.id,
      source: "EVENT",
      expiresTurn: expiryFrom(turnNumber + 1, tag.defaultDurationTurns ?? 1),
    }],
    skipDuplicates: true,
  });
  // Snapshotted for revert: which tag this granted, and (if escalated) the exact expiry the consumed Tired row carried.
  return { slug: targetSlug, replacedTired: heldTired ? { expiresTurn: heldTired.expiresTurn } : null };
}

// Exact inverse of applyFatigueStep. `snapshot` is what that call returned (or the legacy bare
// `1`, which always meant a plain Exhausted grant, from rows pushed before this ladder existed).
async function revertFatigueStep(tx, characterId, snapshot) {
  const grantedSlug = snapshot && typeof snapshot === "object" ? snapshot.slug : EXHAUSTED_SLUG;
  const grantedTag = await tx.tag.findUnique({ where: { slug: grantedSlug }, select: { id: true } });
  if (grantedTag) {
    await tx.characterTag.deleteMany({ where: { characterId, tagId: grantedTag.id } });
  }
  const replacedTired = snapshot && typeof snapshot === "object" ? snapshot.replacedTired : null;
  if (replacedTired) {
    const tiredTag = await tx.tag.findUnique({ where: { slug: TIRED_SLUG }, select: { id: true } });
    if (tiredTag) {
      await tx.characterTag.createMany({
        data: [{
          characterId,
          tagId: tiredTag.id,
          source: "EVENT",
          expiresTurn: replacedTired.expiresTurn,
        }],
        skipDuplicates: true,
      });
    }
  }
}

// Farming's lockout (db/lib/soilery.js; Context §2 of the Soilery plan): unlike the ladder above,
// which ESCALATES Tired into Exhausted, a day sowing a field grants Exhausted OUTRIGHT — there is
// no lesser rung to climb through first. If the character already holds Tired (say, from an
// unrelated day of mining earlier the same turn), it's replaced rather than left to stack alongside
// Exhausted; its `expiresTurn` is snapshotted so db/lib/moveEffects.js's `farmed` entry can restore
// it exactly on Undo. `turnNumber` is the CLOSING turn's number — this adds one itself, the same
// "+1" the `exhausted` MOVE_EFFECTS entry already applies when it grants at push.
async function grantExhaustedOutright(tx, characterId, turnNumber) {
  const heldTired = await tx.characterTag.findFirst({
    where: { characterId, tag: { slug: TIRED_SLUG } },
    select: { id: true, expiresTurn: true },
  });
  const exhaustedTag = await tx.tag.findUnique({
    where: { slug: EXHAUSTED_SLUG },
    select: { id: true, defaultDurationTurns: true },
  });
  if (!exhaustedTag) {
    console.error(`Farm payout: no "${EXHAUSTED_SLUG}" tag — run npm run db:sync-tags. Farming won't be limited.`);
    return null;
  }
  if (heldTired) await tx.characterTag.delete({ where: { id: heldTired.id } });
  // skipDuplicates: an existing Exhausted keeps its own clock (same rule as db/lib/tagExpiryPass.js).
  await tx.characterTag.createMany({
    data: [{
      characterId,
      tagId: exhaustedTag.id,
      source: "EVENT",
      expiresTurn: expiryFrom(turnNumber + 1, exhaustedTag.defaultDurationTurns ?? 1),
    }],
    skipDuplicates: true,
  });
  return { replacedTired: heldTired ? { expiresTurn: heldTired.expiresTurn } : null };
}

module.exports = { nextFatigueSlug, applyFatigueStep, revertFatigueStep, grantExhaustedOutright };
