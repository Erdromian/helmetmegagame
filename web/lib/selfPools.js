import "server-only";
import { prisma } from "@lifeweb/db";
import {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
} from "@lifeweb/db/lib/desireGates";
import { desireFamilies, desireFamilyGroups } from "@lifeweb/db/lib/desireFamilies";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";

// Everything a surface needs to draw a character's OWN state, the way
// web/lib/peoplePools.js does for the people standing near them. It lived
// inside web/app/(app)/character/page.js while the sheet was the only place
// that drew it; the Hall's YOU column is the second.
//
// Every gate is evaluated HERE, server-side. The client never runs the gate
// logic and never receives a hidden template.
//
// `character` needs { id, tags: [{ tagId, tag }], role: { slug } }.
//
// `withCatalog: false` is the Hall's ask: the picker is closed on almost
// every page load, and the evaluated catalog is ~271 templates. The slot half
// — which slots are open, what was last claimed in each — costs one query, so
// that is what the first paint carries. The Hall fetches the other half
// through a server action the first time somebody opens the picker.
export async function loadDesireView(character, { openTurn, gameConfig, withCatalog = true } = {}) {
  const desireSlots = gameConfig?.desireSlots ?? 2;
  const desireSlotLockTurns = gameConfig?.desireSlotLockTurns ?? 2;
  const heldTags = (character.tags ?? []).map((ct) => ct.tag);
  const heldDesireTagIds = new Set((character.tags ?? []).map((ct) => ct.tagId));
  const openTurnNumber = openTurn?.number ?? 0;

  // ALL statuses — the gate evaluator needs the whole history.
  const history = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: {
      id: true,
      templateId: true,
      slotIndex: true,
      status: true,
      text: true,
      points: true,
      setTurnNumber: true,
      endedTurnNumber: true,
      template: { select: { tier: true, cooldownTurns: true, onceEver: true } },
    },
  });

  const view = {
    desiresEnabled: gameConfig?.desiresEnabled ?? true,
    desireSlots,
    desireSlotLockTurns,
    slotStates: slotStates({
      history,
      openTurnNumber,
      desireSlots,
      lockTurns: desireSlotLockTurns,
    }),
    lockNotes: describeDesireLocks(heldTags, new Map(desireFamilies().map((f) => [f.key, f.name]))),
    addiction: bottomSlotAddiction(heldTags),
    families: desireFamilies(),
    familyGroups: desireFamilyGroups(),
    catalog: [],
  };
  if (!withCatalog) return view;

  const templateRows = await prisma.desireTemplate.findMany({
    where: { retired: false },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      tier: true,
      families: true,
      onceEver: true,
      cooldownTurns: true,
      retired: true,
      requiresAnyOf: true,
      requiresAnyRoleSlugs: true,
      requiresNotRoleSlugs: true,
      requiresAnyTags: { select: { id: true, name: true } },
      requiresAllTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });

  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldDesireTagIds);
  const roleBySlug = await loadRoleBySlugForTemplates(prisma, templateRows);
  const projected = templateRows.map((t) => projectDesireTemplateForGates(roleBySlug, t));
  const { visible } = evaluateDesireCatalog({
    templates: projected,
    heldTags,
    hiddenTagIds,
    roleSlug: character.role?.slug ?? null,
    history,
    openTurnNumber,
    desireSlots,
  });

  // The `hidden` half (db/lib/desireGates.js) never reaches this variable.
  // A "locked" entry (unmet requires, or a family a held tag shuts) is
  // dropped here too. Cooldown/once-ever-done rows stay, since those are
  // claimed already, just not claimable right now.
  view.catalog = visible
    .filter(({ state }) => state !== "locked")
    .map(({ template, state, availableFromTurn, slotLocks }) => ({
      slug: template.slug,
      name: template.name,
      description: template.description,
      tier: template.tier,
      families: template.families,
      state,
      availableFromTurn,
      slotLocks,
      cooldownTurns: template.cooldownTurns ?? template.tier,
      onceEver: Boolean(template.onceEver),
      unlockedBy: unlockedBy(template, {
        heldTagIds: heldDesireTagIds,
        roleSlug: character.role?.slug ?? null,
      }),
    }));
  return view;
}
