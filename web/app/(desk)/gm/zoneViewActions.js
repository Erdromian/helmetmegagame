"use server";

import { revalidatePath } from "next/cache";
import { prisma, setVisibleZones } from "@lifeweb/db";
import { syncGmZoneRoles } from "@lifeweb/db/lib/gmZoneRoles";
import { getGmSession } from "@/lib/discordGuild";

// Sets which zones the CALLING GM sees. Never takes a target id: a server
// action is a public endpoint, and the only person anyone may re-scope is
// themselves.
export async function setVisibleZonesAction(zoneIds) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };

  const wanted = Array.isArray(zoneIds) ? zoneIds.map(String).filter(Boolean) : [];
  // Re-resolved against the table rather than trusted: a posted id that is not
  // a zone would otherwise become a row nothing can ever clear.
  const zones = wanted.length > 0
    ? await prisma.zone.findMany({ where: { id: { in: wanted } }, select: { id: true } })
    : [];
  if (zones.length !== wanted.length) return { ok: false, error: "That zone doesn't exist." };

  await setVisibleZones(prisma, session.discordUserId, zones.map((z) => z.id));

  // The Discord half. Outside the write and best-effort, the same posture
  // every other Discord fan-out in the app takes — a rate-limited guild
  // should not fail the click, and the next call reconciles anyway.
  await syncGmZoneRoles(prisma, session.discordUserId).catch((err) =>
    console.error("GM zone view: role sync failed:", err.message ?? err),
  );

  revalidatePath("/gm/players", "layout");
  revalidatePath("/gm/turns", "layout");
  return { ok: true };
}
