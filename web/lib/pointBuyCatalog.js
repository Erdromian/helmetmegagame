import { prisma, startingTagSlugs } from "@lifeweb/db";
import { TAG_CHIP_FIELDS, APPRAISAL_SELECT, stripEmptyUnlocks, cookedTasteOnly } from "@/lib/referenceData";
import { appraise } from "@/lib/appraisal";
import { withoutSecrets } from "@/lib/secretTags";

// A buy menu is not a recipe book: prints a recipe only where the gating trade is public knowledge.
function recipeFields(t) {
  const skills = t.requirementSkills ?? [];
  if (skills.some((s) => s.catalogVisibility !== "ALL")) {
    return {
      craftable: false,
      requirementSkills: [],
      requirementTurns: null,
      requirementPerTurn: null,
      requirementResources: null,
      requirementGambit: false,
    };
  }
  return {
    craftable: t.craftable,
    requirementSkills: skills.map(({ id, slug, name }) => ({ id, slug, name })),
    requirementTurns: t.requirementTurns,
    requirementPerTurn: t.requirementPerTurn,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
  };
}

export async function loadSecretTagIds() {
  const rows = await prisma.tag.findMany({ where: { catalogVisibility: "SECRET" }, select: { id: true } });
  return new Set(rows.map((t) => t.id));
}

// Shared by the creation wizard's loader and /store so the two menus can never disagree about a
// tag's shape. The group's requiredTagId is the hidden-category gate (docs/systemdocs/TAGS.md §3),
// and it is applied HERE for secrets (web/lib/secretTags.js), not only in the browser.
// `extraTagIds` are the tags the character holds. `roleStartingTagSlugs` is the kit of every role
// the wizard is offering — only those, so a hidden fate's kit stays off the page.
export async function loadPointBuyCatalog(
  extraTagIds = [],
  { roleStartingTagSlugs = [], canAppraise = false } = {},
) {
  const or = [{ purchasable: true }];
  if (extraTagIds.length) or.push({ id: { in: extraTagIds } });
  const kitSlugs = [...new Set(startingTagSlugs(roleStartingTagSlugs))];
  if (kitSlugs.length) or.push({ slug: { in: kitSlugs } });
  const [tags, secretIds] = await Promise.all([loadRows(or), loadSecretTagIds()]);
  const kit = new Set(kitSlugs);
  const allowed = [...extraTagIds, ...tags.filter((t) => kit.has(t.slug)).map((t) => t.id)];
  return shapeRows(withoutSecrets(tags, secretIds, allowed), canAppraise);
}

function loadRows(or) {
  return prisma.tag.findMany({
    where: or.length === 1 ? or[0] : { OR: or },
    select: {
      // Spread, not retyped — a dropped field fails silently as a line rendering nothing.
      ...TAG_CHIP_FIELDS,
      ...APPRAISAL_SELECT,
      requirementSkills: { select: { id: true, slug: true, name: true, catalogVisibility: true } },
      purchasable: true,
      purchasableAfterStart: true,
      excludedRoleSlugs: true,
      onlyRoleSlugs: true,
      parentTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
      equipSlot: true,
      equipLayer: true,
      twoHanded: true,
    },
  });
}

// `conflictsWith` becomes the plain id array conflictingTag() scopes on, narrowed to rows that
// ship — an id the page cannot look up is only a pointer at something withheld. `catalogVisibility`
// is dropped so a tag's own secrecy gate never ships to the browser.
function shapeRows(tags, canAppraise) {
  const shipped = new Set(tags.map((t) => t.id));
  return tags.map(({ conflictsWith, catalogVisibility, ...t }) =>
    // cookedTasteOnly: an ingredient's mood and hidden effects must not cross, only its taste.
    appraise(
      cookedTasteOnly(
        stripEmptyUnlocks({
          ...t,
          conflictsWithIds: conflictsWith.map((c) => c.id).filter((id) => shipped.has(id)),
          ...recipeFields(t),
        }),
      ),
      canAppraise,
    ),
  );
}
