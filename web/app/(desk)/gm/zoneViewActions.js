"use server";

import { after } from "next/server";
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
    ? await prisma.zone.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
    : [];
  if (zones.length !== wanted.length) return { ok: false, error: "That zone doesn't exist." };

  await setVisibleZones(prisma, session.discordUserId, zones.map((z) => z.id));

  // The Discord half runs AFTER the response, not inside it. It is one
  // getGuildMember plus up to seven sequential role PUT/DELETEs, each with its
  // own rate-limit budget, and awaiting that here is what made a click take
  // twenty seconds to register. Nothing depends on it having finished: the
  // rows are already written, /zone and the bot-start catch-up reconcile from
  // the same table, and it was best-effort before this too.
  after(async () => {
    await syncGmZoneRoles(prisma, session.discordUserId).catch((err) =>
      console.error("GM zone view: role sync failed:", err.message ?? err),
    );
  });

  // No revalidatePath. The desks re-filter from client state
  // (web/app/components/GmZoneViewProvider.js) off these names, because
  // revalidating both desk layouts refetched the entire payload before the
  // click could paint. Null, not [], for "every zone" — see inVisibleZones.
  return { ok: true, zoneNames: zones.length > 0 ? zones.map((z) => z.name) : null };
}
