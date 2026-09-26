"use server";

// The Mine button (db/lib/mining.js — read its header first, it's the whole rulebook this
// action enforces). Paid AT THE PRESS, not at the turn push — a day in the seam is a roll
// against a range, not a judgement anybody makes, so there is nothing for a GM to arbitrate and
// nothing worth making the player wait for.
//
// The writer is db/lib/verbs/work.js#mineHere, shared with Discord's /work mine; this action
// resolves the character from the session and applies the web's own tail.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { SFX } from "@lifeweb/db/lib/sfx";
import { getOpenTurn } from "@/lib/turn";
import { mineHere } from "@lifeweb/db/lib/verbs/work";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll } from "./shared.js";

export async function mineRequestImpl() {
  const { session, character } = await requireCharacter();
  const result = await mineHere(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  // The clink of something coming out of the rock, in this player's own tab (sfx.js).
  return { sfx: SFX.MINE, line: result.line };
}
