"use server";

// The Farm button (db/lib/soilery.js — read its header first, it's the whole rulebook this action
// enforces). Modeled on extractGodfleshRequestImpl (./misc.js) — the closest
// existing analog: a Location-attribute-gated action with its own refusal chain, filed as a Move
// that commits now and resolves its dice at push (db/lib/moveEffects.js's `farmed` entry).
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { SFX } from "@lifeweb/db/lib/sfx";
import { getOpenTurn } from "@/lib/turn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { hasAttribute, SOILERY_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import { farmRefusalFor, FARM_PLANTS } from "@lifeweb/db/lib/soilery";
import { FERTILIZED_FIELDS_SLUG } from "@lifeweb/db/lib/constants";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

// Takes nothing from the client: a farmer always plants the same field. Every gate re-runs
// server-side against what the character holds right now.
export async function farmRequestImpl() {
  const { session, character } = await requireCharacter();

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!hasAttribute(location, SOILERY_ATTRIBUTE)) {
    throw new UserError("There's nothing to farm here.");
  }

  // The farming skill and the Exhausted/Tired lockout — the SAME function the Farm button's own
  // tooltip reads, so the refusal text on the sheet and the one a bypassed request hits can never
  // drift apart.
  const refusal = farmRefusalFor(character.tags, false);
  if (refusal) throw new UserError(refusal);

  // Bound, Dying, Paralyzed, Catatonic — mirrors extractGodfleshRequestImpl's gate (misc.js).
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    throw new UserError(`You're in no state to work a field — you're ${blocker.name}.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const gameConfig = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { farmMaxCrops: true },
  });
  const planted = gameConfig?.farmMaxCrops ?? FARM_PLANTS;

  // Fertilizer (SOILERY.md): not spent here, and not re-checked under the lock — the buff is a
  // 2-turn status and nothing spends it at farm time, so the outer snapshot is exactly as good as
  // a fresh one.
  const fertilized = character.tags.some((ct) => ct.tag?.slug === FERTILIZED_FIELDS_SLUG);

  const farmPlan = { v: 3, locationId: location.id, planted, fertilized };
  const description = `Working the fields: planting ${planted} crops.`;

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);

    // Commits now, but defers the wither die and the Exhausted lockout to the turn push
    // (db/lib/moveEffects.js's `farmed` entry), exactly like `refined`.
    const action = await fileAutoRoutine(tx, character, openTurn, description, "auto:farm", null, {
      deferEffects: true,
      farmPlan,
    });

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_farm",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { farmPlan, locationName: location?.name ?? null, actionId: action.id },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();

  return {
    sfx: SFX.FARM,
    line: `You planted ${planted} crops. The harvest comes in when the turn closes.`,
  };
}
