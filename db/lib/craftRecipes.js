// Which recipes and tags a character's own verbs reach — Craft's picker, and
// the Destroy and Consume lists. Pure, and ZERO requires, ever: the web's
// client bundle imports these through web/lib/tagRequests.js and
// web/lib/characterCreation.js, which re-export them, and the Discord bot's
// Actions menu (db/lib/actionPools.js) asks the same questions from the other
// side of the monorepo. One copy, so the two faces can't disagree about
// whether a verb has anything to act on.

// A tag and every tier below it, walking parentTagId down to the root.
function chainOf(tag, tagsById) {
  const chain = [];
  let current = tag;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentTagId ? tagsById.get(current.parentTagId) : null;
  }
  return chain;
}

function tagsById(tags) {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

// Non-empty means acquiring `tag` would be a downgrade, which every purchase path rejects.
function heldHigherTiers(tag, tagsById, heldOrSelectedIds) {
  return heldOrSelectedIds.filter((id) => {
    if (id === tag.id) return false;
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === tag.id);
  });
}

function craftableTags(tags, heldTagIds = [], knownRecipeIds = null) {
  const held = new Set(heldTagIds);
  const known = knownRecipeIds ? new Set(knownRecipeIds) : null;
  return tags.filter(
    (tag) => tag.craftable && (!known || known.has(tag.id)) && (tag.stackable || !held.has(tag.id)),
  );
}

// Which recipe ids may be offered: every requirementSkills skill satisfied, and — for a non-public recipe — every ingredient already held.
function computeKnownRecipeIds(
  tagCatalog,
  satisfied,
  characterTags,
  { visibilityBySlug = new Map(), nonAllGroupSlugs = new Set() } = {},
) {
  function isNonPublicRecipe(tag) {
    if (tag.recipePublic) return false;
    if (tag.catalogVisibility !== "ALL") return true;
    return (tag.requirementItems ?? []).some((item) => {
      if (item.kind === "group") return nonAllGroupSlugs.has(item.slug);
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return slugs.some((s) => visibilityBySlug.get(s) !== "ALL");
    });
  }
  // Mirrors resolveRecipeItems' HOLD semantics (requestActions.js) at qty 1.
  function satisfiesIngredientsAtQuantityOne(tag) {
    return (tag.requirementItems ?? []).every((item) => {
      if (item.kind === "group") {
        return characterTags.some((ct) => ct.tag.group?.slug === item.slug);
      }
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return characterTags.some((ct) => slugs.includes(ct.tag.slug));
    });
  }
  // A non-public skill (catalog:gm) is itself the anti-spam gate; holding it
  // should reveal the whole ladder, greyed for missing ingredients, rather
  // than hiding rungs behind the pantry check.
  function skillsAreAllNonPublic(tag) {
    const skills = tag.requirementSkills ?? [];
    if (skills.length === 0) return false;
    return skills.every((s) => s.catalogVisibility && s.catalogVisibility !== "ALL");
  }
  return tagCatalog
    .filter(
      (t) =>
        t.craftable &&
        (t.requirementSkills ?? []).every((skill) => satisfied.has(skill.id)) &&
        (!isNonPublicRecipe(t) || skillsAreAllNonPublic(t) || satisfiesIngredientsAtQuantityOne(t)),
    )
    .map((t) => t.id);
}

// Menu hygiene mirroring db/lib/structures.js; openBuildSiteImpl refuses server-side too.
function placementOfferedHere(
  tag,
  { buildable = false, buildableUnderground = false, sites = [], locationSlug = null } = {},
) {
  if (!tag?.placement) return true;
  const gate = tag.placement.locations;
  const named = Array.isArray(gate) && gate.length > 0;
  if (named && locationSlug && !gate.includes(locationSlug)) return false;
  const namedHere = named && Boolean(locationSlug) && gate.includes(locationSlug);
  // structures.js#buildGround: an underground type is judged on its own answer, which is the only one a cave gives.
  const groundOk = buildable || (buildableUnderground && tag.placement.underground === true);
  if (!groundOk && !namedHere) return false;
  const PRESENT = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];
  const sameType = sites.filter((s) => s.typeSlug === tag.slug && PRESENT.includes(s.status));
  if (sameType.some((s) => s.status === "UNDER_CONSTRUCTION")) return false;
  return tag.placement.unique === false || sameType.length === 0;
}

function destroyableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Never listed here: drinking it opens its own naming dialog instead.
const MULLIGAN_SLUG = "mulligan-potion";

function consumableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.consumable && ct.tag.slug !== MULLIGAN_SLUG)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1, poisonMarker: Boolean(ct.poisonMarker) }));
}

module.exports = {
  chainOf,
  tagsById,
  heldHigherTiers,
  craftableTags,
  computeKnownRecipeIds,
  placementOfferedHere,
  destroyableTags,
  consumableTags,
  MULLIGAN_SLUG,
};
