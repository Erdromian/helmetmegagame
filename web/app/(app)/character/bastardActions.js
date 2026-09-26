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
// Both rules are db/lib/verbs/roles.js's, shared with Discord's
// /reinforcements and /sound horn, and both re-check every gate the sheet
// already applied. A server action is a public endpoint and a hidden button is
// a hint, not a lock.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { broadcastDeepBeastHorn } from "@lifeweb/db/lib/deepBeastHorn";
import { sessionGate } from "@lifeweb/db/lib/betweenSessions";
import { callReinforcements as callReinforcementsVerb, soundHorn } from "@lifeweb/db/lib/verbs/roles";
import { auth } from "@/lib/auth";

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

export async function callReinforcements({ roleSlug, quantity = 1 } = {}) {
  const { discordUserId, character } = await me();
  // Shut between sittings: a player may talk and nothing else (SESSIONS.md §5).
  const gate = await sessionGate(prisma);
  if (!gate.ok) return { ok: false, error: gate.message };
  if (!character) return { ok: false, error: "No living character." };
  const result = await callReinforcementsVerb(prisma, { character, discordUserId, roleSlug, quantity });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/character");
  revalidatePath("/gm/dev");
  return { ok: true, message: result.line };
}

export async function soundDeepBeastHorn() {
  const { discordUserId, character } = await me();
  // Shut between sittings: a player may talk and nothing else (SESSIONS.md §5).
  const gate = await sessionGate(prisma);
  if (!gate.ok) return { ok: false, error: gate.message };
  if (!character) return { ok: false, error: "No living character." };
  const result = await soundHorn(prisma, { character, discordUserId });
  if (!result.ok) return { ok: false, error: result.error };
  // Post-commit and catch-logged (ARCHITECTURE.md §5).
  after(() =>
    broadcastDeepBeastHorn(prisma).catch((err) => console.error("Deep Beast Horn broadcast failed:", err)),
  );
  revalidatePath("/character");
  return { ok: true };
}
