// Tired -> Exhausted ladder (docs/systemdocs/TAGS.md). Six unrelated things climb it and they
// all climb it identically: a day's mining, a day on the Factory floor, a day in the fields (all
// db/lib/moveEffects.js), a bad night (db/lib/dawnAfflictionPass.js), pushing on through a
// travel gate (db/lib/locationTravel.js) and a push spent in combat mode (db/lib/combatModePass.js). The Exhausted->Tired decay is the ordinary
// `expiresInto` chain (TAGS.md §5c).
const { TIRED_SLUG, EXHAUSTED_SLUG, RECENTLY_FARMED_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

// Returns the slug to grant, or null if already at the top of the ladder.
function nextFatigueSlug(heldSlugs) {
  if (heldSlugs.has(EXHAUSTED_SLUG)) return null;
  return heldSlugs.has(TIRED_SLUG) ? EXHAUSTED_SLUG : TIRED_SLUG;
}

// The escalation step itself: nothing -> Tired -> Exhausted, one rung per call. Shared by every
// MOVE_EFFECTS entry that climbs the ladder this way rather than granting Exhausted outright
// (db/lib/moveEffects.js's `exhausted` entry for Mining, `refined` entry for Refine, `farmed` for Farm).
// `turnNumber` is the CLOSING turn's number, same "+1" convention as grantRecentlyFarmed.
//
// `exhaustedFrom` is for a caller stepping someone up MID-TURN (db/lib/crateHaul.js): the open
// turn's number. Exhausted is meant to cover one turn — granted at a close, it blocks the next —
// so one granted partway through turn N is stamped N and turns back into Tired when N closes.
// Stamped N+1 like a close's, it held the rest of N and all of N+1, a "2t" badge. Tired keeps
// N+1 either way: it blocks nothing, and carrying into the next turn is what makes a second
// day's haul step up.
async function applyFatigueStep(tx, characterId, turnNumber, { exhaustedFrom = null } = {}) {
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
  const firstLiveTurn = targetSlug === EXHAUSTED_SLUG && exhaustedFrom != null ? exhaustedFrom : turnNumber + 1;
  // skipDuplicates: an existing Tired/Exhausted keeps its own clock (same rule as db/lib/tagExpiryPass.js).
  await tx.characterTag.createMany({
    data: [{
      characterId,
      tagId: tag.id,
      source: "EVENT",
      expiresTurn: expiryFrom(firstLiveTurn, tag.defaultDurationTurns ?? 1),
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

// Farming's lockout (db/lib/soilery.js#farmRefusalFor): a day in the fields grants Recently Farmed,
// which refuses the Farm button for its 2 turns, so a farmer farms one turn in three. The Tired step
// that comes with it is the ordinary applyFatigueStep above, called beside this. It stands apart
// from the ladder: Recently Farmed stops farming and nothing else. `turnNumber` is the CLOSING
// turn's number, same "+1" convention as applyFatigueStep. Returns true when it wrote the row, so
// db/lib/moveEffects.js's `farmed` entry only takes back on Undo what it gave.
async function grantRecentlyFarmed(tx, characterId, turnNumber) {
  const tag = await tx.tag.findUnique({
    where: { slug: RECENTLY_FARMED_SLUG },
    select: { id: true, defaultDurationTurns: true },
  });
  if (!tag) {
    console.error(`Farm payout: no "${RECENTLY_FARMED_SLUG}" tag — run npm run db:sync-tags. Farming won't be limited.`);
    return null;
  }
  // skipDuplicates: an existing row keeps its own clock (same rule as db/lib/tagExpiryPass.js).
  const { count } = await tx.characterTag.createMany({
    data: [{
      characterId,
      tagId: tag.id,
      source: "EVENT",
      expiresTurn: expiryFrom(turnNumber + 1, tag.defaultDurationTurns ?? 2),
    }],
    skipDuplicates: true,
  });
  return count > 0 ? true : null;
}

module.exports = { nextFatigueSlug, applyFatigueStep, revertFatigueStep, grantRecentlyFarmed };
