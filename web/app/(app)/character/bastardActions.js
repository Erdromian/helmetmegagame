"use server";

// The two Bastard verbs on the character sheet.
//
// CALL REINFORCEMENTS spends ¢ or ⬢ and OPENS A LATE-JOIN SEAT
// (db/lib/lateJoin.js). It summons nobody: what it buys is a chair, and a real
// player walks into it from the creation picker's Special section. That is the
// whole reason this is not a threat spawn — a spawn picks the person.
//
// SOUND HORN is the Deep Beast Horn (db/lib/deepBeastHorn.js): one line in
// every surface Location in the game, and none in the caves.
//
// Both re-check every gate the sheet already applied. A server action is a
// public endpoint and a hidden button is a hint, not a lock.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import {
  BASTARD_TAG_SLUG,
  DEEP_BEAST_HORN_SLUG,
  MAX_REINFORCEMENTS_PER_CALL,
  openLateJoinSlots,
  reinforcementFor,
} from "@lifeweb/db/lib/lateJoin";
import { broadcastDeepBeastHorn, HORN_COOLDOWN_MS } from "@lifeweb/db/lib/deepBeastHorn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { OBOL_SLUG } from "@lifeweb/db/lib/depotState";
import { readCharacterResources, takeCharacterResources } from "@lifeweb/db/lib/resourceStack";
import { auth } from "@/lib/auth";

// One clock per character, in process memory — the trumpet's pattern
// (trumpetActions.js) and for the same reason: a courtesy against spam, not
// game state, so a deploy clearing it costs nothing.
const lastSounded = new Map();

// From the session, never a posted id.
async function me() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  return { discordUserId: session.discordUserId, character };
}

function holds(character, slug) {
  return character.tags.some((ct) => ct.tag.slug === slug);
}

export async function callReinforcements({ roleSlug, quantity = 1 } = {}) {
  const { discordUserId, character } = await me();
  if (!character) return { ok: false, error: "No living character." };
  if (!holds(character, BASTARD_TAG_SLUG)) {
    return { ok: false, error: "Only the Bastard calls reinforcements." };
  }

  const reinforcement = reinforcementFor(String(roleSlug ?? ""));
  if (!reinforcement) return { ok: false, error: "There's nobody by that name to call." };

  const count = Math.trunc(Number(quantity));
  if (!Number.isInteger(count) || count < 1 || count > MAX_REINFORCEMENTS_PER_CALL) {
    return { ok: false, error: `Call between 1 and ${MAX_REINFORCEMENTS_PER_CALL} at a time.` };
  }
  const total = reinforcement.price * count;

  const obolTag = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });

  try {
    await prisma.$transaction(async (tx) => {
      // PRICED AND DRAWN INSIDE THE TRANSACTION, off a read taken there —
      // thanatiActions.js#purchaseGearImpl's reasoning: a purse planned outside
      // it can shrink in between, and the refusal then names the wrong pocket.
      // Obols first, then ⬢, at par (one obol is one ⬢ — DEPOT.md §0).
      const [obolRow, resources] = await Promise.all([
        obolTag
          ? tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId: character.id, tagId: obolTag.id } },
              select: { quantity: true },
            })
          : null,
        readCharacterResources(tx, character.id),
      ]);
      const obols = obolRow?.quantity ?? 0;
      if (obols + resources < total) throw new Error("TOO_POOR");

      const fromObols = Math.min(total, obols);
      const fromResources = total - fromObols;

      if (fromObols > 0) {
        // A conditional decrement, so two clicks racing cannot both spend the
        // same coin: the update matches nothing if the pile has since shrunk.
        const hit = await tx.characterTag.updateMany({
          where: { characterId: character.id, tagId: obolTag.id, quantity: { gte: fromObols } },
          data: { quantity: { decrement: fromObols } },
        });
        if (hit.count === 0) throw new Error("TOO_POOR");
        await tx.characterTag.deleteMany({
          where: { characterId: character.id, tagId: obolTag.id, quantity: { lte: 0 } },
        });
      }
      // Strict, not clamped: takeCharacterResources takes the whole amount or
      // nothing and says which.
      if (fromResources > 0 && !(await takeCharacterResources(tx, character.id, fromResources))) {
        throw new Error("TOO_POOR");
      }

      await openLateJoinSlots(tx, reinforcement.roleSlug, count);

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "reinforcements_called",
          targetCharacterId: character.id,
          details: {
            characterName: character.name,
            roleSlug: reinforcement.roleSlug,
            quantity: count,
            paidObols: fromObols,
            paidResources: fromResources,
          },
        },
      });
    });
  } catch (err) {
    if (err?.message === "TOO_POOR") {
      return { ok: false, error: `You can't cover ${total} ¢.` };
    }
    throw err;
  }

  revalidatePath("/character");
  revalidatePath("/gm/dev");
  return {
    ok: true,
    message: `${count} ${reinforcement.name} ${count === 1 ? "seat is" : "seats are"} open.`,
  };
}

export async function soundDeepBeastHorn() {
  const { discordUserId, character } = await me();
  if (!character) return { ok: false, error: "No living character." };
  if (!holds(character, DEEP_BEAST_HORN_SLUG)) {
    return { ok: false, error: "You aren't carrying the horn." };
  }
  if (!character.locationId) return { ok: false, error: "You're nowhere." };

  // ACT, not SPEAK: a horn takes breath AND hands, so Bound stops it where a
  // shout deliberately isn't stopped (trumpetActions.js).
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { ok: false, error: `You can't raise it — you're ${blocker.name}.` };
  }

  const since = Date.now() - (lastSounded.get(character.id) ?? 0);
  if (since < HORN_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((HORN_COOLDOWN_MS - since) / 60_000));
    return {
      ok: false,
      error: `Your lungs need about ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    };
  }
  // Claimed BEFORE the posting loop — this is a fan-out over every surface
  // Location, long enough for a second click to slip past a cooldown stamped
  // at the end.
  lastSounded.set(character.id, Date.now());

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "deep_beast_horn_sounded",
        targetCharacterId: character.id,
        details: { characterName: character.name, locationId: character.locationId },
      },
    })
    .catch((err) => console.error("Horn audit log failed:", err));

  // Post-commit and catch-logged (ARCHITECTURE.md §5).
  after(() =>
    broadcastDeepBeastHorn(prisma).catch((err) =>
      console.error("Deep Beast Horn broadcast failed:", err),
    ),
  );

  revalidatePath("/character");
  return { ok: true };
}
