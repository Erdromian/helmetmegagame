"use server";

// The Late joins verbs, behind /gm/dev?s=latejoins.
//
// A late join is a seat the GM has OPENED rather than one they have handed to
// a named person: the Dev Panel says which of db/lib/lateJoin.js's candidate
// roles are on and how many chairs each has, and whoever wants one takes it
// from the creation picker's Special section. That is the whole difference
// from a threat spawn (THREATS.md §4), which picks the person.
//
// GM-tier, not superadmin, for the reason threatActions.js gives: running the
// game is what seats are. Re-checks everything the UI already checked, since a
// server action is a public endpoint.
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { isLateJoinRoleSlug, setLateJoinRole } from "@lifeweb/db/lib/lateJoin";
import { requireDev } from "@/lib/devAccess";

function repaint() {
  revalidatePath("/gm/dev");
  revalidatePath("/character");
}

export async function updateLateJoinRole(formData) {
  const session = await requireDev("gm");
  const roleSlug = formData.get("roleSlug")?.toString() ?? "";
  if (!isLateJoinRoleSlug(roleSlug)) return { error: "Not a late-join role." };

  // A checkbox that is off posts nothing at all, so absence is false.
  const enabled = formData.get("enabled") === "on";
  const rawSlots = Number.parseInt(formData.get("slots")?.toString() ?? "", 10);
  if (!Number.isInteger(rawSlots) || rawSlots < 0 || rawSlots > 999) {
    return { error: "Slots must be a whole number from 0 to 999." };
  }

  await setLateJoinRole(prisma, roleSlug, { enabled, slots: rawSlots });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "late_join_set",
        details: { roleSlug, enabled, slots: rawSlots },
      },
    })
    .catch((err) => console.error("Late join audit log failed:", err));

  repaint();
  return { ok: true };
}
