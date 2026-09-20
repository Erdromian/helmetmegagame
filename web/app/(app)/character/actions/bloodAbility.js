"use server";

// The Blood menu (docs/systemdocs/VAMPIRE.md §6 — design doc pages 4-5): one
// shared action for all ten abilities, dispatched by key off
// db/lib/vampireBloodAbilities.js's pure catalog. Modelled on ./mine.js's
// shape (fast-fail checks outside the transaction, the real checks again
// under the Character row lock inside it), but unlike Mine this never
// touches the Move economy — the design doc's own cost is blood and a
// cooldown, nothing about a turn's Routine/Gambit.
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { blockerFor, ACT, INCAPACITATING_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { grantTagSlugs, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { VAMPIRE_SLUG, HEART_SLUG, THRALL_SLUG, VAMPIRE_BLOOD_ADDICT_SLUG } from "@lifeweb/db/lib/constants";
import { clampBlood } from "@lifeweb/db/lib/vampire";
import { syncVampireBandsNow } from "@lifeweb/db/lib/vampireBands";
import { expiryFrom } from "@lifeweb/db/lib/turnFormat";
import { abilityByKey, abilityCooldownTurns, isOnCooldown } from "@lifeweb/db/lib/vampireBloodAbilities";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";
import { sendDm } from "@/lib/discordGuild";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

// Regeneration's own list (VAMPIRE.md's table: "health-wound, health-ilness
// and health-infection"), deliberately NOT db/lib/constants.js's
// WOUND_TAG_GROUPS — that set is Second Wind's ([health-wounds,
// health-maiming, health-infection], no illness), a different rule for a
// different button.
const REGENERATION_GROUP_SLUGS = ["health-wounds", "health-illness", "health-infection"];
// No burn-specific tag GROUP exists in the catalog (checked against
// docs/tags.yaml) — burns are two ordinary health-wounds slugs, so the "not
// related to burns" carve-out is a slug list, hand-kept, not a group check.
const BURN_SLUGS = new Set(["burned", "severe-burns"]);

function requiredTagLabel(ability) {
  const map = {
    corruptor: "Corruptor",
    celerity: "Celerity",
    "bat-form": "Bat Form",
    solidarity: "Solidarity",
    obfuscate: "Obfuscate",
  };
  return map[ability.requiredTagSlug] ?? ability.requiredTagSlug;
}

// Public entry point — StorePanel.js/buyTags's own shape: an Impl that
// throws UserError for a refusal, guarded() into { ok, error } data so a
// validation failure never crosses the server-action boundary as a thrown
// error (actionResult.js's own header explains why).
export async function castBloodAbility(input) {
  return guarded(() => castBloodAbilityImpl(input));
}

async function castBloodAbilityImpl({
  abilityKey,
  targetCharacterId = null,
  locationId = null,
  message = null,
}) {
  const { session, character } = await requireCharacter();

  const ability = abilityByKey(abilityKey);
  if (!ability) throw new UserError("That isn't a Blood Ability.");

  const heldSlugs = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  if (!heldSlugs.has(VAMPIRE_SLUG)) throw new UserError("You aren't a Vampire.");
  if (ability.requiredTagSlug && !heldSlugs.has(ability.requiredTagSlug)) {
    throw new UserError(`You need ${requiredTagLabel(ability)} to use ${ability.name}.`);
  }
  // The one ability the design doc itself conditions on capacity — see
  // db/lib/vampireBloodAbilities.js's own header for why the other nine
  // deliberately skip this (Regeneration must work while Dying).
  if (ability.requiresAct) {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) throw new UserError(`You're in no state to do that — you're ${blocker.name}.`);
  }

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const cooldowns = character.vampireBloodAbilityCooldowns ?? {};
  if (isOnCooldown(cooldowns, ability.key, openTurn.number)) {
    throw new UserError(`${ability.name} is still recovering.`);
  }

  const bloodLevel = clampBlood(character.vampireBloodLevel);
  if (bloodLevel < ability.bloodCost) {
    throw new UserError(`You don't have enough blood — ${ability.name} costs ${ability.bloodCost}.`);
  }

  // Corrupt's item cost — checked against the loaded roster before the
  // transaction, same "fast fail outside" split as everything else here.
  let heartHeld = null;
  if (ability.itemCost) {
    heartHeld = (character.tags ?? []).find((ct) => ct.tag?.slug === ability.itemCost.slug);
    if (!heartHeld || heartHeld.quantity < ability.itemCost.quantity) {
      throw new UserError(`${ability.name} needs ${ability.itemCost.quantity} Heart — you don't have one.`);
    }
  }

  // Bat Form's destination — validated, not trusted; a live Location, not
  // gated on travel links since this is flight, not walking (VAMPIRE.md §6:
  // "quickly fly to ANY region").
  let destination = null;
  if (ability.effect === "teleport") {
    destination = locationId
      ? await prisma.location.findUnique({
          where: { id: locationId },
          select: { id: true, name: true, zoneId: true },
        })
      : null;
    if (!destination) throw new UserError("Choose where to fly to.");
  }

  // Solidarity's message — required, and length-capped the way any
  // player-composed DM body should be (Discord's own 2000-char ceiling,
  // postDmBatched already splits over that, but a vampire typing an essay
  // into every other vampire's DMs at once is worth refusing outright).
  if (ability.effect === "broadcast") {
    if (!message?.trim()) throw new UserError("Write a message to send.");
    if (message.trim().length > 500) throw new UserError("That message is too long.");
  }

  // Enthral / Nourish targets — must be ALIVE, at the SAME location, and
  // (Enthral) incapacitated or (Nourish) already a thrall. Re-checked again
  // under the row lock inside the transaction below.
  let target = null;
  if (ability.requiresIncapacitatedTarget || ability.requiresThrallTarget) {
    if (!targetCharacterId) throw new UserError("Choose someone here.");
    target = await prisma.character.findUnique({
      where: { id: targetCharacterId },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!target || target.status !== "ALIVE" || target.locationId !== character.locationId) {
      throw new UserError("They aren't here.");
    }
    const targetSlugs = new Set((target.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
    if (ability.requiresIncapacitatedTarget) {
      const incapacitated = [...targetSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug));
      if (!incapacitated) throw new UserError(`${target.name} isn't incapacitated.`);
    }
    if (ability.requiresThrallTarget && !targetSlugs.has(THRALL_SLUG)) {
      throw new UserError(`${target.name} isn't your thrall.`);
    }
  }

  const cooldownTurns = await resolveCooldownTurns(ability);
  const newBlood = clampBlood(bloodLevel - ability.bloodCost);

  let fromLocationId = null;
  let toLocationId = null;

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);

    const fresh = await tx.character.findUnique({
      where: { id: character.id },
      select: { vampireBloodLevel: true, vampireBloodAbilityCooldowns: true, locationId: true },
    });
    if (!fresh) throw new UserError("Character not found.");
    const freshCooldowns = fresh.vampireBloodAbilityCooldowns ?? {};
    if (isOnCooldown(freshCooldowns, ability.key, openTurn.number)) {
      throw new UserError(`${ability.name} is still recovering.`);
    }
    const freshBlood = clampBlood(fresh.vampireBloodLevel);
    if (freshBlood < ability.bloodCost) {
      throw new UserError(`You don't have enough blood — ${ability.name} costs ${ability.bloodCost}.`);
    }

    const updatedBlood = clampBlood(freshBlood - ability.bloodCost);
    await tx.character.update({
      where: { id: character.id },
      data: {
        vampireBloodLevel: updatedBlood,
        vampireBloodAbilityCooldowns: { ...freshCooldowns, [ability.key]: openTurn.number + cooldownTurns },
      },
    });
    // Spending blood can cross a checkpoint (Flush -> Satiated, etc) — resync
    // now rather than waiting for the next turn close, same reasoning
    // db/lib/vampireBands.js gives for a GM's own edit.
    await syncVampireBandsNow(tx, character.id, updatedBlood, character.vampireHumanity);

    if (ability.grantsTagSlugs?.length) {
      await grantTagSlugs(tx, character.id, ability.grantsTagSlugs, openTurn.number);
    }

    if (ability.itemCost) {
      await dropCharacterTag(tx, character.id, heartHeld.tagId, ability.itemCost.quantity);
    }

    if (ability.effect === "cure-non-burn-wounds") {
      const wounds = await tx.characterTag.findMany({
        where: {
          characterId: character.id,
          tag: { group: { slug: { in: REGENERATION_GROUP_SLUGS } } },
        },
        select: { id: true, tag: { select: { slug: true } } },
      });
      const toRemove = wounds.filter((ct) => !BURN_SLUGS.has(ct.tag.slug)).map((ct) => ct.id);
      if (toRemove.length) {
        await tx.characterTag.deleteMany({ where: { id: { in: toRemove } } });
      }
    }

    if (ability.effect === "teleport") {
      fromLocationId = fresh.locationId ?? null;
      toLocationId = destination.id;
      await tx.character.update({
        where: { id: character.id },
        data: { locationId: destination.id, zoneId: destination.zoneId },
      });
    }

    if (ability.effect === "enthral") {
      await lockCharacter(tx, target.id);
      const freshTarget = await tx.character.findUnique({
        where: { id: target.id },
        select: {
          status: true,
          locationId: true,
          tags: { select: { tag: { select: { slug: true } } } },
        },
      });
      const freshTargetSlugs = new Set((freshTarget?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
      if (
        freshTarget?.status !== "ALIVE" ||
        freshTarget.locationId !== character.locationId ||
        ![...freshTargetSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))
      ) {
        throw new UserError(`${target.name} isn't here and incapacitated any more.`);
      }
      await grantTagSlugs(tx, target.id, [THRALL_SLUG, VAMPIRE_BLOOD_ADDICT_SLUG], openTurn.number);
    }

    if (ability.effect === "nourish") {
      const woundRows = await tx.characterTag.findMany({
        where: { characterId: target.id, tag: { group: { slug: "health-wounds" } } },
        select: { id: true },
      });
      if (woundRows.length) {
        await tx.characterTag.deleteMany({ where: { id: { in: woundRows.map((r) => r.id) } } });
      }
      const addictTag = await tx.tag.findUnique({
        where: { slug: VAMPIRE_BLOOD_ADDICT_SLUG },
        select: { id: true },
      });
      if (addictTag) {
        const freshExpiry = expiryFrom(openTurn.number, 9);
        await tx.characterTag.upsert({
          where: { characterId_tagId: { characterId: target.id, tagId: addictTag.id } },
          create: { characterId: target.id, tagId: addictTag.id, source: "EVENT", expiresTurn: freshExpiry },
          update: { expiresTurn: freshExpiry },
        });
      }
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_vampire_blood_ability",
      targetCharacterId: target?.id ?? character.id,
      turnId: openTurn.id,
      details: {
        ability: ability.key,
        bloodCost: ability.bloodCost,
        cooldownTurns,
        ...(destination ? { locationId: destination.id } : {}),
      },
    });
  });

  if (ability.effect === "teleport" && toLocationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: character.id,
      fromLocationId,
      toLocationId,
      walked: false,
    }).catch((err) => console.error(`Bat Form: side effects failed for ${character.id}:`, err));
  }

  if (ability.effect === "broadcast") {
    const vampires = await prisma.character.findMany({
      where: { status: "ALIVE", id: { not: character.id }, tags: { some: { tag: { slug: VAMPIRE_SLUG } } } },
      select: { discordUserId: true },
    });
    for (const vampire of vampires) {
      await sendDm(vampire.discordUserId, `${character.name} reaches out through the blood: "${message.trim()}"`, {
        kind: DM_KIND.CONVERSATION,
      }).catch((err) => console.error(`Solidarity: DM failed for ${vampire.discordUserId}:`, err));
    }
  }

  revalidateAll();
  return { line: `You used ${ability.name}.` };
}

async function resolveCooldownTurns(ability) {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { vampireBloodAbilityCooldownVariable: true },
  });
  return abilityCooldownTurns(ability, config?.vampireBloodAbilityCooldownVariable ?? 5);
}
