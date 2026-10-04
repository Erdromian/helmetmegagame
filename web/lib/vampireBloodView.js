// Builds the Blood menu's server-resolved view (docs/systemdocs/VAMPIRE.md
// §6) for web/app/(app)/character/page.js — same posture as
// web/lib/selfPools.js's loadDesireView: everything BloodPanel.js needs to
// render is decided here, so the client component only draws it. The action
// itself (web/app/(app)/character/actions/bloodAbility.js) re-checks every
// one of these independently; this is a UI convenience, never the authority.
import { prisma } from "@lifeweb/db";
import { pickerName } from "@/lib/peopleHere";
import { INCAPACITATING_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { THRALL_SLUG } from "@lifeweb/db/lib/secretSlugs";
import { clampBlood, bloodUrgencyBand } from "@lifeweb/db/lib/vampire";
import {
  ABILITIES,
  abilityCooldownTurns,
  batFormDestinationWhere,
  isOnCooldown,
  requiredTagName,
} from "@lifeweb/db/lib/vampireBloodAbilities";
import { batFormHeldReason, NO_ROAD_FROM } from "@lifeweb/db/lib/batForm";
import { isOffRoad } from "@lifeweb/db/lib/offRoad";

const URGENCY_LABELS = {
  flush: "Flush",
  satiated: "Satiated",
  thirsty: "Thirsty",
  famished: "Famished",
  bloodcrazed: "Bloodcrazed",
};

async function resolveCooldownVariable() {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { vampireBloodAbilityCooldownVariable: true },
  });
  return config?.vampireBloodAbilityCooldownVariable ?? 1;
}

export async function loadVampireBlood(character, { here, openTurn }) {
  const heldSlugs = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const bloodLevel = clampBlood(character.vampireBloodLevel);
  const cooldowns = character.vampireBloodAbilityCooldowns ?? {};
  const variable = await resolveCooldownVariable();
  const openTurnNumber = openTurn?.number ?? 0;
  // Aboard the Charon, Bat Form has nowhere to leave from (db/lib/offRoad.js).
  const offRoad = await isOffRoad(prisma, character.locationId);

  const abilities = ABILITIES.map((ability) => {
    const reasons = [];
    if (ability.requiredTagSlug && !heldSlugs.has(ability.requiredTagSlug)) {
      reasons.push(`Needs ${requiredTagName(ability)}.`);
    }
    // Held or incapacitated: the Fly button greys out with the sentence the
    // action would refuse with. The row-only half of db/lib/batForm.js — the
    // action asks the rest (the pre-push lock, the Caving Die) itself.
    if (ability.effect === "teleport") {
      const held = batFormHeldReason(character);
      if (held) reasons.push(held);
      if (offRoad) reasons.push(NO_ROAD_FROM);
    }
    if (bloodLevel < ability.bloodCost) reasons.push("Not enough blood.");
    if (isOnCooldown(cooldowns, ability.key, openTurnNumber)) reasons.push("Recovering.");
    if (ability.itemCost) {
      const held = (character.tags ?? []).find((ct) => ct.tag?.slug === ability.itemCost.slug);
      if (!held || held.quantity < ability.itemCost.quantity) reasons.push("Needs a Heart.");
    }
    return {
      key: ability.key,
      name: ability.name,
      description: ability.description,
      bloodCost: ability.bloodCost,
      cooldownTurns: abilityCooldownTurns(ability, variable),
      available: reasons.length === 0,
      reason: reasons[0] ?? null,
    };
  });

  // Bare character ids, deliberately NOT pickerKey's hood-token shape —
  // Enthral/Nourish resolve their target with a plain
  // prisma.character.findUnique in the action, so a concealed identity here
  // would resolve to nothing rather than the wrong person. A narrow, known
  // gap: a hooded incapacitated victim or thrall doesn't show up to pick.
  const incapacitatedHere = (here ?? [])
    .filter((c) => c.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug)))
    .map((c) => ({ id: c.id, name: pickerName(c) }));
  const boundHere = (here ?? [])
    .filter((c) => c.tags.some((ct) => ct.tag.slug === THRALL_SLUG))
    .map((c) => ({ id: c.id, name: pickerName(c) }));
  // Only where a flock of bats can go (the action looks the destination up
  // with the same where), and not the one you stand in.
  const locations = await prisma.location.findMany({
    where: {
      ...batFormDestinationWhere(),
      ...(character.locationId ? { id: { not: character.locationId } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return {
    bloodLevel,
    urgencyLabel: URGENCY_LABELS[bloodUrgencyBand(bloodLevel)] ?? "Flush",
    abilities,
    locations,
    incapacitatedHere,
    boundHere,
    // The two prompts that name the seat. Sent from here, to a vampire only:
    // BloodPanel.js is in every player's bundle and so says nothing of it itself.
    copy: {
      messagePlaceholder: "Message to every vampire…",
      boundPlaceholder: "Choose a thrall here…",
    },
  };
}
