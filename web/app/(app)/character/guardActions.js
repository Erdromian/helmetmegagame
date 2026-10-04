"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { setEscort, stopEscort, escortPicker } from "@lifeweb/db/lib/verbs/guard";

// ESCORT, from the character sheet and /chat (docs/systemdocs/ATTACK.md §6a, MAP.md §3d). The
// interceptActions.js posture: the actor comes from the session, never from a posted id, and every
// refusal is a UserError through guarded(). The rule is db/lib/verbs/guard.js, shared with Discord's
// /escort guard and /escort stop, and it re-checks everything this dialog greys.

async function me() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true },
  });
  if (!character) redirect("/character");
  return { session, character };
}

// The DMs the verb built — the charge told they are being escorted, or no longer — sent after the
// response, so the click never waits on Discord.
function tell(dms) {
  if (!dms?.length) return;
  after(async () => {
    for (const dm of dms) {
      await sendDm(dm.discordUserId, dm.content, { kind: dm.kind }).catch((err) =>
        console.error("Escort: DM failed:", err.message ?? err),
      );
    }
  });
}

async function loadEscortImpl() {
  const { character } = await me();
  return { ok: true, ...(await escortPicker(prisma, { character })) };
}

async function setEscortImpl({ targetKey, defends, attacks }) {
  const { session, character } = await me();
  const result = await setEscort(prisma, {
    character,
    discordUserId: session.discordUserId,
    targetKey: String(targetKey ?? ""),
    // The dialog's two boxes. Anything but a real boolean reads as that box's default.
    defends: defends !== false,
    attacks: attacks === true,
  });
  if (!result.ok) throw new UserError(result.error);
  tell(result.dms);
  revalidatePath("/character");
  return { ok: true, line: result.line };
}

async function stopEscortImpl() {
  const { session, character } = await me();
  const result = await stopEscort(prisma, { character, discordUserId: session.discordUserId });
  if (!result.ok) throw new UserError(result.error);
  tell(result.dms);
  if (result.changed) revalidatePath("/character");
  return { ok: true, line: result.line };
}

export async function loadEscort() {
  return guarded(() => loadEscortImpl());
}
export async function startEscort(input) {
  return acting(() => setEscortImpl(input ?? {}));
}
export async function endEscort() {
  return acting(() => stopEscortImpl());
}
