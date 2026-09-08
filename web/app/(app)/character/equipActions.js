"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import {
  STOWABLE_SLUGS,
  WATER_TRAVEL_SLUGS,
  BOAT_CONFLICT_SLUGS,
  FAST_TRAVEL_SLUGS,
} from "@lifeweb/db/lib/mounts";
import { MOTION_SICKNESS_SLUG } from "@lifeweb/db/lib/constants";
import { describeSlotClash, checkEquipLimits } from "@lifeweb/db/lib/equipSlots";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";

// A refusal a human caused (no free slots, a clash) rather than a real
// failure — thrown inside the transaction below to roll the write back,
// caught outside it to answer with the sentence a player reads. Never
// crosses that boundary, so nothing else needs to know it exists.
class EquipRefusalError extends Error {}

// Equipping is instant and writes no Request and no AuditLog. That is
// deliberate: it costs nothing, the player can undo it themselves in one tap,
// and at 100+ players a row per toggle would drown /gm/audit and the Requests
// tab in noise. Contrast TRANSFER_RESOURCES, which moves something real and so
// has to be reviewable — see docs/systemdocs/REQUESTS.md.
//
// A slot holds one physical item, so a stackable tag's own count is not one
// on/off flag any more — CharacterTag.equippedQuantity says how many of the
// stack are out, each spending its own slot. equipOne and unequipOne below
// move that number by exactly one at a time; there is no bulk toggle on this
// path (the Dev Panel's GM batch, db/lib/tagOps.js, is the one place that
// still equips or clears a whole holding in one gesture).

// Shared by both directions: the session-resolved living character, and the
// incapacitation gate that blocks equipping AND unequipping alike — a hostage
// who could take the sack off their own head would not be much of a hostage.
// Never trusts a posted id: a server action is a public endpoint.
async function resolveActor() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      location: { select: { indoors: true, name: true } },
      // `equipped` and the tag NAME are both read by the boat/mount clash
      // below, which has to name the thing already out loud.
      tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return { error: "No living character." };

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { error: `You can't work your hands right now — you're ${blocker.name}.` };
  }
  return { character };
}

// Pulls one more unit out of a held stack and gives it its own slot. Equipping
// all 5 of a stack of 5 swords is five of these, not one call that equips the
// whole stack.
export async function equipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: {
      id: true,
      quantity: true,
      equippedQuantity: true,
      tag: { select: { equippable: true, name: true, slug: true } },
    },
  });
  if (!held) return { error: "You aren't holding that." };
  if (!held.tag.equippable) return { error: `${held.tag.name} isn't something you can equip.` };
  if (held.equippedQuantity >= held.quantity) {
    return { error: `You don't have another ${held.tag.name} to equip.` };
  }

  // The gates below only ever fire on the FIRST unit out — none of
  // STOWABLE_SLUGS, FAST_TRAVEL_SLUGS or WATER_TRAVEL_SLUGS is stackable, so
  // this is exactly the old `!held.equipped` check, just spelled for a count.
  const firstUnitOut = held.equippedQuantity === 0;

  // A cart does not come into a chapel (docs/systemdocs/CARRY.md §3). Arriving
  // already unequipped it; this stops it going straight back on. This one
  // gates the equip direction only — taking the cart off at the door is the
  // whole point of it. The incapacitation check above is the gate that runs
  // both ways.
  if (firstUnitOut && STOWABLE_SLUGS.has(held.tag.slug) && character.location?.indoors) {
    return { error: `You can't set up ${held.tag.name} inside ${character.location.name}.` };
  }

  // Motion Sickness: the only gate is here, on equipping a mount or a boat
  // yourself. A dragged passenger with no mount of their own is handled in
  // db/lib/locationTravel.js instead — this can't stop that, only what you equip.
  if (
    firstUnitOut &&
    (FAST_TRAVEL_SLUGS.has(held.tag.slug) || WATER_TRAVEL_SLUGS.has(held.tag.slug)) &&
    character.tags.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG)
  ) {
    return { error: `Your stomach won't have it — you can't ride ${held.tag.name}.` };
  }

  // You are either riding or poling. The boat and the road kit compete for the
  // same free crossing, and having both out would stack two of them, so each
  // refuses while the other is equipped. Checked in both directions — the
  // player may reach this from either tag.
  if (firstUnitOut) {
    const conflicting = WATER_TRAVEL_SLUGS.has(held.tag.slug)
      ? BOAT_CONFLICT_SLUGS
      : BOAT_CONFLICT_SLUGS.has(held.tag.slug)
        ? WATER_TRAVEL_SLUGS
        : null;
    if (conflicting) {
      const other = character.tags.find((ct) => ct.equipped && conflicting.has(ct.tag.slug));
      if (other) {
        return {
          error: `Put ${other.tag.name} away first — you can't have that and ${held.tag.name} out at once.`,
        };
      }
    }
  }

  // Counting inside the transaction is NOT enough on its own: Prisma runs at
  // READ COMMITTED, so two tabs (or one impatient double-tap) both read the
  // same count, both see a free slot, and both write — which is exactly what
  // happens without the lock below. Taking a row lock on the Character first
  // serializes every equip for this one character, so the second attempt reads
  // the first's committed count. Contention is per-character, i.e. only ever
  // between one player's own clients.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${character.id} FOR UPDATE`;
      const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } });
      const slots = config?.equipSlots ?? 10;
      await tx.characterTag.update({
        where: { id: held.id },
        data: { equippedQuantity: { increment: 1 }, equipped: true },
      });

      // Written first, then checked, so this asks the same question the GM
      // batch path asks: "is the resulting set wearable?" — checkEquipLimits
      // is the shared, unit-tested answer to that question (db/lib/equipSlots.js).
      // Inside the same transaction and behind the same row lock taken above,
      // so a double-tap cannot slip a second helmet past it; the throw below
      // rolls the write back.
      const wornRows = await tx.characterTag.findMany({
        where: { characterId: character.id, equippedQuantity: { gt: 0 } },
        select: {
          equippedQuantity: true,
          tag: { select: { name: true, equipSlot: true, equipLayer: true } },
        },
      });
      const { overCap, clash } = checkEquipLimits(wornRows, slots);
      if (overCap) throw new EquipRefusalError("You have no free equipment slots.");
      if (clash) throw new EquipRefusalError(describeSlotClash(clash));
    });
  } catch (err) {
    if (err instanceof EquipRefusalError) return { error: err.message };
    throw err;
  }

  // Equipping a Cart raises the cap, which can clear Overburdened.
  await afterInventoryChange([character.id]);
  revalidatePath("/character");
  return { equipped: true };
}

// Puts one unit back — the last one out also clears `equipped`. Units of a
// stack are fungible, so which physical one comes off makes no difference.
export async function unequipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: { id: true, equippedQuantity: true, tag: { select: { name: true } } },
  });
  if (!held) return { error: "You aren't holding that." };
  if (held.equippedQuantity <= 0) return { error: `${held.tag.name} isn't equipped.` };

  const equippedQuantity = held.equippedQuantity - 1;
  await prisma.characterTag.update({
    where: { id: held.id },
    data: { equippedQuantity, equipped: equippedQuantity > 0 },
  });
  // Unequipping a Cart shrinks the carry cap, so the sheet has to be settled
  // against it — Overburdened goes on. Nothing is dropped for a shrink
  // (CARRY.md §1), so putting the cart down at an inn door is safe.
  await afterInventoryChange([character.id]);
  revalidatePath("/character");
  return { equipped: equippedQuantity > 0 };
}
