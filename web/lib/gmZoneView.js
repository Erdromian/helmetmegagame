import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "./discordGuild";
import { sortZones } from "./zones";

// Which zones the viewing GM has chosen to see. Replaced web/lib/gmZone.js's
// getMyZones, and the difference is the whole feature: a seat used to pick
// which zone a table OPENED on and hid nothing, while this decides what the
// desks show at all — and, through the "GM: <Zone>" Discord roles, which
// Location channels exist for them (db/lib/gmZoneRoles.js).
//
// NULL MEANS EVERY ZONE, never an empty list. A GM who has not touched the
// control sees the whole game, which is the only safe default: the alternative
// hands a new GM an empty desk and no channels and lets them conclude the app
// is broken. Callers branch on null rather than on length, so "chose nothing"
// and "chose everything" cannot drift apart as zones are added.
//
// cache()-wrapped like getGmSession/getOpenTurn, so a desk that asks from its
// layout, its page and the nav costs one query rather than three.
export const getVisibleZones = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return null;
  const rows = await prisma.gmZoneView.findMany({
    where: { discordUserId: session.discordUserId },
    include: { zone: { select: { id: true, name: true } } },
  });
  if (rows.length === 0) return null;
  // Canonical zone order, not insertion order — a GM who picked Caves then
  // Town should read "Town, Caves" like everything else in the app does.
  return sortZones(rows.map((r) => r.zone).filter(Boolean));
});

// Every zone a GM can pick — the ones that actually have a seat to hand out.
// That is the SEAT zones: the cave levels are absent because their Locations
// wear the Underground group's role and their factions are keyed to the
// Underground seat, so "Caves" would have been a pick that emptied the desk
// and opened nothing. A zone the sync has not provisioned yet is absent for
// the same reason: there is no role behind it.
export const listSelectableZones = cache(async () => {
  const zones = await prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    select: { id: true, name: true },
  });
  return sortZones(zones);
});
