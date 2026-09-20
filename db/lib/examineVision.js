// Whether a character's eyes are good enough to look somebody over right now. Gates the **Look at**
// button on /character only — the 🔍 reaction in Discord stays open, since it needs the subject to
// have just spoken beside you, close enough to see regardless. No Prisma import, same posture as
// inspectVision.js — the sheet greys a button and the server action refuses, and neither should drift
// from the other.
const NEARSIGHTED_SLUG = "nearsighted";
const SPECTACLES_SLUG = "spectacles";
// Blind stops looking at anything, with no corrective and no schedule.
const BLIND_SLUG = "blind";

// Accepts CharacterTag[] ({ tag: { slug } }) or a bare Tag[]. Same as inspectVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Only EQUIPPED gear counts — spectacles in a sack correct nothing, and `spectacles` is already
// `equippable: true`, so CharacterTag.equipped is the honest test.
function equippedSet(characterTags) {
  return new Set(
    (characterTags ?? [])
      .filter((ct) => ct?.equipped === true)
      .map((ct) => ct?.tag?.slug ?? ct?.slug)
      .filter(Boolean),
  );
}

// Why this character cannot look anyone over, or null if they can. `where` used to carry the two
// facts Sun Sensitivity needed (whether the sun is up, whether indoors). That tag went with the
// surface on 2026-09-20 — there is no daylight to be blinded by underground — so nothing in here
// reads `where` any more. It is still accepted, and still threaded in by every caller, because
// db/lib/reading.js takes the same shape and unpicking the plumbing is its own pass.
function examineBlock(characterTags = []) {
  const slugs = slugSet(characterTags);

  // First — nothing below can rescue it.
  if (slugs.has(BLIND_SLUG)) {
    return "You can't see.";
  }

  if (slugs.has(NEARSIGHTED_SLUG) && !equippedSet(characterTags).has(SPECTACLES_SLUG)) {
    return "Everything past arm's length is a blur. Put your spectacles on.";
  }

  return null;
}

module.exports = {
  examineBlock,
  BLIND_SLUG,
};
