// Cooking (docs/systemdocs/COOKING.md): what a dish is made of, and what that
// makes it do.
//
// A dish is a MINTED Tag row (mintCustomCraft) carrying `cookedFrom` — the
// ingredient slugs, in the order the cook slotted them. Everything a dish
// does is worked out from that list AT THE MOMENT SOMEBODY EATS IT, not baked
// into the row when it was cooked. This module is where that happens.
//
// Deriving late rather than early is the one decision the whole feature hangs
// off, and it buys three things:
//
//   The RAW/COOKED SPLIT. A tag's own `consumesInto` is what eating it plain
//   does; `cooked.into` overrides that for the cooked case, and an ingredient
//   that omits `into` simply contributes its own. A deep morel is nausea raw
//   and dinner in a stew.
//
//   A FREE HAND-OFF TO THE MEDICAL REWORK. Nothing here names a medicine.
//   When that PR changes what White Honey's `consumesInto` does, every dish
//   already sitting in somebody's pocket does the new thing on the next bite
//   — no re-mint, no backfill, no code. If you are merging it and hunting for
//   the cooking hook: there isn't one, and that is the design.
//
//   TUNING. An ingredient's mood is a number in docs/tags.yaml. Changing it
//   changes every dish ever made with it, including the ones already cooked.
//
// Pure — no prisma, no React — so the Craft dialog and the server action can
// both read it, the way web/lib/customCraft.js is shared.

// One ingredient's contribution, as consumesInto-shaped entries. Two sources:
// `cooked.into` is already in the normalised quad shape the sync writes
// ({ slug, unlessTags, durationTurns, oneOf }), and a tag's OWN grants live
// across four parallel columns that ownEntries zips back into it.
//
// NULL AND [] ARE DIFFERENT and the distinction is load-bearing: a null
// `into` means "use my own consumesInto", an authored `[]` means
// "contribute nothing". Blind Fish and Deep Morel are the second — cooking is
// what takes their nausea off.
function ingredientEntries(tag) {
  // `cooked.into` is stored in exactly this shape already — the sync writes
  // it through the same normalizer — so it needs no reshaping, only choosing.
  return tag?.cooked?.into ?? ownEntries(tag);
}

// A tag's own grants, zipped out of the four parallel columns.
function ownEntries(tag) {
  const slugs = tag?.consumesInto ?? [];
  const oneOf = tag?.consumesIntoOneOf ?? null;
  const unless = tag?.consumesIntoUnless ?? null;
  const durations = tag?.consumesIntoDurations ?? null;
  return slugs.map((slug, i) => ({
    slug,
    oneOf: oneOf?.[i] ?? null,
    unlessTags: unless?.[slug] ?? [],
    durationTurns: durations?.[slug] ?? null,
  }));
}

// The dish and its ingredients, merged into ONE consumesInto-shaped tag for
// resolveConsumeGrants.
//
// One call, never one per ingredient. resolveConsumeGrants tracks what the
// character WILL hold across the list it is given — that is how the drinking
// ladder resolves against a rung the same swallow just granted — so calling
// it twice would resolve each half against a stale sheet and double-grant.
//
// `unlessTags` merges by union: two ingredients that both block on `blind`
// still block on `blind`, and a slug granted by one ingredient unconditionally
// stays unconditional. `durationTurns` takes the LONGEST, because two sources
// of the same status is not a reason for it to end sooner.
export function mergeDishGrants(mealTag, ingredientTags = []) {
  const entries = [...ownEntries(mealTag)];
  for (const ing of ingredientTags) entries.push(...ingredientEntries(ing));

  const consumesInto = [];
  const consumesIntoOneOf = [];
  const unless = {};
  const durations = {};
  let anyOneOf = false;
  for (const e of entries) {
    consumesInto.push(e.slug);
    consumesIntoOneOf.push(e.oneOf ?? null);
    if (e.oneOf) anyOneOf = true;
    if (e.unlessTags?.length) {
      unless[e.slug] = [...new Set([...(unless[e.slug] ?? []), ...e.unlessTags])];
    }
    if (e.durationTurns != null) {
      durations[e.slug] = Math.max(durations[e.slug] ?? 0, e.durationTurns);
    }
  }
  return {
    consumesInto,
    consumesIntoOneOf: anyOneOf ? consumesIntoOneOf : null,
    consumesIntoUnless: Object.keys(unless).length ? unless : null,
    consumesIntoDurations: Object.keys(durations).length ? durations : null,
    // A dish never pays out ⬢ — that is the Purse and the Supply Kit, and an
    // ingredient's Resources half has no business surviving the pot.
    consumesIntoResources: null,
  };
}

// The line the eater reads (NoticeProvider, bottom-right).
//
// The ‡ sits here and nowhere else. A taste is a FRAGMENT dropped into the
// middle of this sentence, so marking each one would print "honey ‡ and
// onions ‡" — one mark per message, at the very end, is the convention
// (CLAUDE.md), and db/lib/tagShapes.js#normalizeCooked refuses a ‡ in a taste
// to keep it that way.
// An empty taste is dropped rather than printed as a gap — that is Phrygian
// Tears and Adder's Bite, the two things a cook can hide in a meal with no
// tell at all.
export function tasteLine(tastes = []) {
  tastes = tastes.filter(Boolean);
  if (!tastes.length) return "You ate a meal. ‡";
  if (tastes.length === 1) return `You ate a meal. It tastes like ${tastes[0]}. ‡`;
  return `You ate a meal. It tastes like ${tastes.slice(0, -1).join(", ")} and ${tastes[tastes.length - 1]}. ‡`;
}
