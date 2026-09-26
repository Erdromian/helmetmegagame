"use server";

// The Farm button (db/lib/soilery.js — read its header first, it's the whole rulebook this action
// enforces). Filed as a Move that commits now and resolves its dice at push
// (db/lib/moveEffects.js's `farmed` entry).
//
// The writer is db/lib/verbs/work.js#farmHere, shared with Discord's /work farm; this action
// resolves the character from the session and applies the web's own tail.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { SFX } from "@lifeweb/db/lib/sfx";
import { getOpenTurn } from "@/lib/turn";
import { farmHere } from "@lifeweb/db/lib/verbs/work";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll } from "./shared.js";

// Takes nothing from the client: a farmer always plants the same field. Every gate re-runs
// server-side against what the character holds right now.
export async function farmRequestImpl() {
  const { session, character } = await requireCharacter();
  const result = await farmHere(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return { sfx: SFX.FARM, line: result.line };
}
