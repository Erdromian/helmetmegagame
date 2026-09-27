// Poisoning an item or a character. See the medical pass, M4.

import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import {
  creditResources,
  dropCharacterTag,
  grantTagSlugs,
} from "@/lib/tagEffects";
import {
  isHere,
  notHereMessage,
} from "@/lib/peopleHere";
import {
  resolveConsumeGrants,
  heldSlugsOf,
  resistSlugsOf,
} from "@/lib/consumeGrants";
import { poisonHeldItem } from "@lifeweb/db/lib/verbs/self";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { notifyCharacter } from "@/lib/notifyCharacter";
import {
  INCAPACITATING_SLUGS,
  ACT,
} from "@lifeweb/db/lib/incapacitation";
import {
  requireCharacter,
  revalidateAll,
  lockCharacter,
} from "./shared.js";

// --- Poisoning (the medical pass, M4) ----------------------------------
// Dosing a meal or drink you're already holding. Drinking it yourself is
// the ordinary Consume path (poisons are consumable, `consumesInto`
// wired); dosing a helpless person is poisonCharacterRequestImpl below,
// its own deliberate door, not a loosening of the M1 medicine-administer gate.
export async function poisonItemRequestImpl({ poisonTagId, targetTagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/self.js#poisonHeldItem, shared with Discord's /item poison.
  const result = await poisonHeldItem(prisma, {
    character,
    discordUserId: session.discordUserId,
    poisonTagId,
    targetTagId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return {};
}

// Dosing a helpless person standing here. Poison's own deliberate door: the
// target must be in INCAPACITATING_SLUGS (bound, dying, paralyzed,
// unconscious, crucified, catatonic — same class HARM/LOOT use) and
// co-located; a conscious victim is never dosable this way. Grants land
// through the same resolveConsumeGrants the Consume path uses, resists
// filter included, so a forced dose is countered by Iron Constitution like a swallowed one.
export async function poisonCharacterRequestImpl({ poisonTagId, targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const heldPoison = character.tags.find((ct) => ct.tagId === poisonTagId);
  if (!heldPoison) throw new UserError("You don't have that.");
  if (!heldPoison.tag.poison) throw new UserError("That isn't a poison.");

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("Pick someone else.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: {
      tags: { include: { tag: { select: { id: true, slug: true, name: true, resists: true } } } },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const heldSlugs = new Set(target.tags.map((ct) => ct.tag.slug));
  if (![...heldSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
    throw new UserError(
      "You can't poison a conscious, able person.",
    );
  }

  const openTurn = await getOpenTurn();
  const resistSlugs = resistSlugsOf(target.tags);
  // No ladder walk here, unlike Consume's: every `poison: true` item is a
  // status vial, never a drinking-ladder rung, so that extra query resolves
  // nothing (see consumeGrants.js's own comment on this assumption).
  const grants = resolveConsumeGrants(heldPoison.tag, heldSlugsOf(target.tags), null, resistSlugs);

  await prisma.$transaction(async (tx) => {
    // Deadlock avoidance, same shape as consumeTagRequestImpl: lock in sorted-id order, never actor-then-target.
    const lockIds = [character.id, target.id].sort();
    for (const id of lockIds) await lockCharacter(tx, id);

    // Double-fire (fix round, M4): re-verify the vial is still held under the lock.
    const freshPoison = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: poisonTagId } },
    });
    if (!freshPoison || freshPoison.quantity < 1) throw new UserError("You don't have that any more.");

    // Patient-side race: re-verify helplessness under the lock.
    const freshTags = await tx.characterTag.findMany({
      where: { characterId: target.id },
      select: { tag: { select: { slug: true } } },
    });
    const freshSlugs = new Set(freshTags.map((ct) => ct.tag.slug));
    if (![...freshSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
      throw new UserError("They're no longer helpless.");
    }

    await dropCharacterTag(tx, character.id, poisonTagId, 1);
    const granted = await grantTagSlugs(
      tx,
      target.id,
      grants.slugs,
      openTurn?.number ?? null,
      grants.durations,
    );
    if (grants.resources) {
      await creditResources(
        tx,
        { kind: "character", id: target.id, name: target.name },
        grants.resources,
      );
    }
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_poison_character",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: {
        poisonTagId,
        poisonName: heldPoison.tag.name,
        targetName: target.name,
        granted: granted.map((g) => g.tagName),
        resisted: grants.resisted.length ? grants.resisted : undefined,
      },
    });
  });

  await afterInventoryChange([character.id, target.id]);
  // Anonymous, same posture as harmCharacterRequestImpl's "Someone hurt you."
  notifyCharacter(target, "Someone forced something down your throat.");
  revalidateAll();
  return {};
}

