import "server-only";
import { isPointerDeviceSlug } from "@lifeweb/db/lib/pointerMint";
import { BUTCHER_SLUG, MUTILATE_GATE_SLUGS } from "@lifeweb/db/lib/constants";

// The held-item flags — what is in YOUR pockets, and nothing about the room —
// that decide which of the registry's rows show (actionRegistry.js). Shared by
// the sheet (character/page.js) and /chat (chat/page.js), so an item's own
// verb in either place is lit on the same facts. Every one is re-checked by
// its server action; a hidden button is a hint, not a lock.
//
// `prisma` and `character` ({ locationId }) are only for the Stepstone's
// targets, which are built ONLY for somebody carrying a stone — a sheet with no
// stone shouldn't print the whole map into its page source.
export async function itemPools(prisma, character, heldSlugs) {
  const has = (slug) => heldSlugs.has(slug);
  const hasStepstone = has("stepstone");
  const stepstoneTargets = hasStepstone
    ? (
        await prisma.location.findMany({
          // SURFACE rather than "not a cave", so a new zone kind stays out by default.
          where: {
            zone: { kind: "SURFACE" },
            ...(character.locationId ? { id: { not: character.locationId } } : {}),
          },
          select: { id: true, name: true, zone: { select: { name: true } } },
          orderBy: [{ zone: { sortOrder: "asc" } }, { name: "asc" }],
        })
      ).map((l) => ({ id: l.id, name: l.name, zoneName: l.zone?.name ?? null }))
    : [];
  return {
    canButcher: has(BUTCHER_SLUG),
    canDisguise: has("disguise-kit"),
    // GATE rather than SHOW: the tag is purchasable by anybody now.
    canPickpocket: has("pickpocket") || has("pickpocketing-skilled"),
    canTorture: has("torturer"),
    canMutilate: MUTILATE_GATE_SLUGS.some(has), // Cruel, Torturer or Thanati
    canBrand: has("branding-iron"),
    // The collar's three (COLLAR.md) — never "is anybody here collared".
    canApplyCollar: has("bomb-collar"),
    canUnlockCollar: has("collar-key"),
    canDetonateCollar: has("remote-detonator"),
    // Shackles only give to an Escape Artist (LESSONS.md §3c).
    canBreakRestraints: has("bound") || (has("shackled") && has("escape-artist")),
    hasDatacard: has("nuclear-datacard"),
    hasDevice: has("nuclear-device"),
    // Every Pointer Device Kit pair mints its own `custom-pointer-*` slug.
    hasPointerDevice: [...heldSlugs].some(isPointerDeviceSlug),
    hasStepstone,
    stepstoneTargets,
  };
}
