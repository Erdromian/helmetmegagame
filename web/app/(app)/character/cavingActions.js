"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { cavingResultFor, respondToCaving } from "@lifeweb/db/lib/cavingResponse";

// An alert caver's response to a failed Caving roll, from /chat, the sheet and the DM thread
// (docs/systemdocs/COMBAT-MODE.md §6). attackActions.js's posture: the caver is resolved from the session and
// never from a posted id, and the rules are db/lib/cavingResponse.js, shared with the bot's modal.

async function me() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");
  return character;
}

// What the write box opens with: whether they may write, and what they wrote.
async function loadImpl() {
  const character = await me();
  const turn = await getOpenTurn();
  const result = turn ? await cavingResultFor(prisma, character.id, turn) : null;
  if (!result) throw new UserError("Nothing has gone wrong down here this turn.");
  return { canWrite: result.alert, response: result.response ?? "", locationName: result.locationName };
}

async function respondImpl({ rollId, text }) {
  const character = await me();
  const turn = await getOpenTurn();
  if (!turn) throw new UserError("There's no turn open right now.");
  const out = await respondToCaving(prisma, {
    characterId: character.id,
    rollId: rollId ? String(rollId) : null,
    text: String(text ?? ""),
    turn,
  });
  if (!out.ok) throw new UserError(out.error);
  revalidatePath("/gm/turns");
  return { line: out.line };
}

export async function loadMyCavingResponse() {
  return guarded(() => loadImpl());
}
export async function respondToCavingRequest(input) {
  return acting(() => respondImpl(input ?? {}));
}
