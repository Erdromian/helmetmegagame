import { prisma, startingTagSlugs } from "@lifeweb/db";
import { TAG_CHIP_FIELDS, stripEmptyUnlocks } from "@/lib/referenceData";

// A buy menu is not a recipe book. It prints a recipe only where the trade
// that gates it is public knowledge — every wax seal in the game is made by a
// Forger, a `catalog: gm` Brigand skill, and a "Recipe: Forger" line under a
// seal in the shop would tell every courtier that seals get forged. The tag
// keeps its point price either way; that is the honest route and it stays
// visible. See web/lib/recipeCatalog.js for the same rule on the catalogs.
function recipeFields(t) {
  const skills = t.requirementSkills ?? [];
  if (skills.some((s) => s.catalogVisibility !== "ALL")) {
    return {
      craftable: false,
      requirementSkills: [],
      requirementTurns: null,
      requirementResources: null,
      requirementGambit: false,
    };
  }
  return {
    craftable: t.craftable,
    requirementSkills: skills.map(({ id, slug, name }) => ({ id, slug, name })),
    requirementTurns: t.requirementTurns,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
  };
}

// The tag catalog exactly as PointBuy consumes it, shared by the creation
// wizard's loader and /store so the two menus can never disagree about a
// tag's shape. The group's requiredTagId is the hidden-category gate
// (docs/systemdocs/TAGS.md §3) — drop it and every gated category silently
// opens for everyone. `extraTagIds` widens the query beyond purchasable tags
// (the store passes the buyer's held ids, so an unpurchasable held tag still
// reaches the client's byId map). `includeRoleStartingTags` does the same for
// role-locked starting tags the creation wizard needs to display.
export async function loadPointBuyCatalog(extraTagIds = [], { includeRoleStartingTags = false } = {}) {
  const or = [{ purchasable: true }];
  if (extraTagIds.length) or.push({ id: { in: extraTagIds } });
  if (includeRoleStartingTags) {
    // startingTagSlugs holds slugs — roles.yaml authors display names
    // (`starting_tags: [Pale]`) and db:sync-roles resolves each one as it
    // validates it. An entry may carry a count ("obol x5") which has to come
    // off before the lookup.
    const roles = await prisma.role.findMany({ select: { startingTagSlugs: true } });
    const slugs = [...new Set(roles.flatMap((r) => startingTagSlugs(r.startingTagSlugs)))];
    if (slugs.length) or.push({ slug: { in: slugs } });
  }
  const tags = await prisma.tag.findMany({
    where: or.length === 1 ? or[0] : { OR: or },
    select: {
      // The shared shape TagDetails.js was written against. This menu used to
      // hand-roll its own narrower one, and the two drifted exactly the way
      // TAG_CHIP_FIELDS exists to stop: the armour columns fell out of it, so
      // formatTagArmor() had nothing to read and the armour line silently
      // rendered nothing on the whole buying screen. Spread it, don't retype
      // it. The group gate and requiredTag ride along inside it.
      ...TAG_CHIP_FIELDS,
      // One override, then a buying menu's own business. TAG_CHIP_FIELDS asks
      // each requirement skill for id/slug/name only, and recipeFields() below
      // has to know that skill's own catalog gate — without this every skill
      // reads `undefined !== "ALL"` and EVERY recipe gets redacted. Overridden
      // here rather than added to the shared select: a chip has no use for it,
      // and the shared one rides on /gm/turns' busiest query.
      requirementSkills: { select: { id: true, slug: true, name: true, catalogVisibility: true } },
      purchasable: true,
      purchasableAfterStart: true,
      // roleExcluded() reads this off the projection — drop it and Devoted
      // Follower reappears in a Migrant's menu.
      excludedRoleSlugs: true,
      // The whitelist half of the same gate — drop it and Mime's Vow shows
      // up in every seat's menu.
      onlyRoleSlugs: true,
      parentTagId: true,
      // At most one of these per character (the Beliefs). PointBuy's byId map
      // is built from this projection, so exclusiveConflict() reads the flag
      // off it — drop the field and the rule silently stops applying.
      exclusive: true,
      // exclusiveConflict() scopes the rule to the group (one Belief, one
      // Addiction): without the id every exclusive tag looks like one group.
      groupId: true,
      // conflictingTag() reads conflictsWithIds off this projection — drop it
      // and a conflict silently stops applying in the menu.
      conflictsWith: { select: { id: true } },
      // Where the thing goes on the body, for TagDetails' "Worn" line. A
      // shopper buying a coif needs to know it sits under a helm rather than
      // instead of one, and that a poleaxe eats two of three hands.
      equipSlot: true,
      equipLayer: true,
      twoHanded: true,
    },
  });
  // Spread rather than retyped, for the reason the select above gives: a
  // hand-copied field list is a second shape that drifts, and every field it
  // forgets fails silently as a line that renders nothing.
  //
  // Two edits on the way out. `conflictsWith` becomes the plain id array
  // conflictingTag() scopes on, and `catalogVisibility` is dropped: it was
  // selected only so recipeFields() could decide whether to print the recipe,
  // and shipping a tag's own catalog gate to the browser tells a reader which
  // rows are secret.
  return tags.map(({ conflictsWith, catalogVisibility, ...t }) =>
    stripEmptyUnlocks({
      ...t,
      conflictsWithIds: conflictsWith.map((c) => c.id),
      ...recipeFields(t),
    }),
  );
}
