// Poisoning + resistance (the medical pass, M4). Pure, Prisma-free, required
// by both db/lib/tagWrites.js (the stack primitives) and the web app's own
// server actions — one home for the two bits of math the feature needs
// rather than two answers drifting apart.
//
// Secrecy note: nothing here ever returns the raw poisonedCount/poisonPayload
// a caller hands it back out unfiltered — this module only ever hands back a
// COUNT drawn or a yes/no on detection. What a client is allowed to see is
// decided at the serialization boundary (web/app/(app)/character/page.js,
// db/lib/examine.js), not here.

// The two ways a character can tell a stack is tainted: the trait (a
// sensitive palate, docs/tags.yaml `poison-sense`) or the held gadget
// (`poison-snooper`, multi-use — holding one is the whole check, it is never
// consumed). Either is enough on its own.
const POISON_SENSE_SLUG = "poison-sense";
const POISON_SNOOPER_SLUG = "poison-snooper";

// `characterTags` is the `{ tag: { slug } }` shape used everywhere else
// (db/lib/incapacitation.js#slugSet is the same convention) — tolerant of a
// bare Tag[] too, so a caller with either shape in hand can call this
// directly.
function canDetectPoison(characterTags) {
  return (characterTags ?? []).some((ct) => {
    const slug = ct?.tag?.slug ?? ct?.slug;
    return slug === POISON_SENSE_SLUG || slug === POISON_SNOOPER_SLUG;
  });
}

// A hypergeometric draw: out of `total` units on a stack where `poisoned` of
// them carry the taint, how many of the `take` units actually LEAVING are
// poisoned ones. One formula for two callers — a single Consume draw
// (`take: 1`, the odds `poisonedCount / quantity` the plan calls for) and a
// Transfer/Loot move of many units at once (`take: quantity`), which "draws
// proportionally at random" by running the same single-unit odds `take`
// times without replacement, so the expected split matches the stack's own
// ratio without ever landing on a fixed rounding.
function drawPoisonedUnits(total, poisoned, take) {
  let remainingTotal = Math.max(0, Math.trunc(total ?? 0));
  let remainingPoisoned = Math.max(0, Math.min(Math.trunc(poisoned ?? 0), remainingTotal));
  let drawn = 0;
  const draws = Math.max(0, Math.trunc(take ?? 0));
  for (let i = 0; i < draws && remainingTotal > 0; i += 1) {
    if (Math.random() * remainingTotal < remainingPoisoned) {
      drawn += 1;
      remainingPoisoned -= 1;
    }
    remainingTotal -= 1;
  }
  return drawn;
}

module.exports = { POISON_SENSE_SLUG, POISON_SNOOPER_SLUG, canDetectPoison, drawPoisonedUnits };
