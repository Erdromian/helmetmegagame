"use server";

// Breaking in an unruly arelitz (db/lib/arelitz.js — read its header first,
// and ARELITZ.md §6, the whole rulebook this action enforces). A Gambit that
// rolls at filing and resolves at turn push (db/lib/moveEffects.js's
// `brokeIn` entry) instead of waiting on a GM, since a stable's worth of
// attempts can't sit in limbo.
//
// The writer is db/lib/verbs/work.js#breakInArelitz, shared with Discord's
// /work breakin; this action resolves the character from the session and
// applies the web's own tail.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import { breakInArelitz } from "@lifeweb/db/lib/verbs/work";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll } from "./shared.js";

export async function breakInArelitzRequestImpl({ tagId, sourceKey }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const result = await breakInArelitz(prisma, {
    character,
    discordUserId: session.discordUserId,
    tagId,
    sourceKey,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return { line: result.line };
}
