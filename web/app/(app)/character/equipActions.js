"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { equipOneTag, unequipOneTag } from "@lifeweb/db/lib/verbs/self";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";

// Equipping writes no Request/AuditLog — costs nothing, undoable in one tap, and a row per toggle at 100+ players would drown /gm/audit (contrast TRANSFER_RESOURCES, REQUESTS.md). A slot holds one physical item: CharacterTag.equippedQuantity counts a stack's units out, each its own slot; equipOne/unequipOne move one at a time (db/lib/tagOps.js is the one bulk path, for the Dev Panel).

// Shared by both directions: resolved character plus the incapacitation gate blocking equip AND unequip alike. Never trusts a posted id.
async function resolveActor() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      location: { select: { indoors: true, attributes: true, name: true, zone: { select: { kind: true } } } },
      tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } }, // name is read by the boat/mount clash below
    },
  });
  if (!character) return { error: "No living character." };

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { error: `You can't work your hands right now — you're ${blocker.name}.` };
  }
  return { character };
}

// Pulls one more unit out of a held stack and gives it its own slot. Equipping all 5 of a stack of 5 swords is five of these, not one call that equips the whole stack.
// The rule is db/lib/verbs/self.js#equipOneTag, shared with Discord's /item equip.
export async function equipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const result = await equipOneTag(prisma, { character: actor.character, characterTagId });
  if (!result.ok) return { error: result.error };
  // Equipping a Cart raises the cap, which can clear Overburdened.
  await afterInventoryChange(result.touched);
  revalidatePath("/character");
  // The wearer hears it go on — cloth rustles, a buckle clicks (db/lib/equipSlots.js#equipSfx).
  // Taking something off says nothing: the room is quiet when you put a helmet down.
  return { equipped: true, sfx: result.sfx };
}

// Puts one unit back — the last one out also clears `equipped`.
// The rule is db/lib/verbs/self.js#unequipOneTag, shared with Discord's /item unequip.
export async function unequipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const result = await unequipOneTag(prisma, { character: actor.character, characterTagId });
  if (!result.ok) return { error: result.error };
  // Unequipping a Cart shrinks the carry cap; Overburdened goes on but nothing is dropped for a shrink (CARRY.md §1).
  await afterInventoryChange(result.touched);
  revalidatePath("/character");
  return { equipped: result.equipped };
}

// Take from a room stash and put it on in one gesture (EquipBoard.js). TWO ACTS, deliberately not merged: the take goes through the ordinary transferRequest (re-resolves actor, re-checks reach) so it costs what reaching in from the dialog costs. If the wear half refuses, THE TAKE STILL STANDS — it's in your pack rather than an unwound transfer.
export async function takeAndEquip({ roomId, tagId }) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;
  if (!roomId || !tagId) return { error: "Nothing to take." };

  const { transferRequest } = await import("./requestActions");
  const took = await transferRequest({
    fromKey: `room:${roomId}`,
    toKey: `character:${character.id}`,
    tags: [{ tagId: String(tagId), quantity: 1 }],
    amount: 0,
  });
  if (took?.error) return { error: took.error };

  // Found by tag, not the transfer's returned id — a part-held stack merges into the existing row instead of creating one.
  const held = await prisma.characterTag.findFirst({
    where: { characterId: character.id, tagId: String(tagId) },
    select: { id: true },
  });
  if (!held) return { error: "You took it, but it isn't on your sheet. Tell a GM." };

  const wore = await equipOne(held.id);
  if (wore?.error) {
    return { error: `${wore.error} It is in your pack.` };
  }
  return wore;
}
