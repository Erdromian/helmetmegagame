"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { broadcastTrumpet } from "@lifeweb/db/lib/trumpet";
import { sessionGate } from "@lifeweb/db/lib/betweenSessions";
import { soundTrumpet as soundTrumpetVerb } from "@lifeweb/db/lib/verbs/roles";
import { auth } from "@/lib/auth";

// Sounding a trumpet is heard across the Location graph — db/lib/trumpet.js
// for reach, db/lib/soundBroadcast.js for how it carries. The rule, and the
// cooldown the two faces share, is db/lib/verbs/roles.js#soundTrumpet (Discord's
// /sound trumpet). Writes an AuditLog row, unlike equipping — heard by most of
// the barony and can't be taken back (bell rope's reasoning).
export async function soundTrumpet() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // Shut between sittings: a player may talk and nothing else (SESSIONS.md §5).
  const gate = await sessionGate(prisma);
  if (!gate.ok) return { ok: false, error: gate.message };

  // From the session, never a posted id — a server action is a public endpoint.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return { ok: false, error: "No living character." };

  const result = await soundTrumpetVerb(prisma, { character, discordUserId: session.discordUserId });
  if (!result.ok) return { ok: false, error: result.error };

  // Post-commit and catch-logged (requestActions.js#speakAtSite discipline, ARCHITECTURE.md §5).
  after(() =>
    broadcastTrumpet(prisma, result.locationId).catch((err) => console.error("Trumpet broadcast failed:", err)),
  );

  revalidatePath("/character");
  return { ok: true };
}
