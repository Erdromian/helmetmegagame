"use server";

// The Godard Factory's Refine button (db/lib/refinery.js — read its header first, it's the
// whole rulebook this action enforces). Filed as a Move that commits now and resolves at the
// turn push (db/lib/moveEffects.js's `refined` entry).
//
// The writer is db/lib/verbs/work.js#refineHere, shared with Discord's /work refine; this
// action resolves the character from the session and applies the web's own tail.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { refineHere } from "@lifeweb/db/lib/verbs/work";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll } from "./shared.js";

export async function refineRequestImpl() {
  const { session, character } = await requireCharacter();
  const result = await refineHere(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return { line: result.line };
}
