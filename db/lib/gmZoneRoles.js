// Turns a GM's GmZoneView rows into actual Discord roles.
//
// The choice has to be MATERIALIZED, because Discord has no way to subtract a
// role grant from one member: "everybody sees Town" and "this GM does not"
// cannot both be expressed by one "GM: Town" overwrite. So the overwrite is
// unconditional on the channel and the ROLE is what varies per person.
//
// Why a role per zone rather than a per-member overwrite on each channel: the
// channel doctor deletes any member overwrite on a zone or Location channel as
// a stray, on every bot start and after every turn, because it derives their
// legitimacy purely from who is standing there (CHANNELS.md §3). Roles it
// already reconciles.
//
// There is deliberately no superadmin special case. A superadmin who wants
// every zone holds no GmZoneView rows, which already means every zone; one who
// picks three wanted three.
const { addMemberRole, removeMemberRole, getGuildMember } = require("./discordRest");
const { visibleZoneIds } = require("./gmZoneView");
const { hasGmRole } = require("./roleIds");

// Every zone that has a GM role to hand out. A zone with none is one the sync
// has not provisioned yet, and is skipped rather than treated as invisible.
async function gmRoleZones(prisma) {
  return prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    select: { id: true, name: true, gmRoleId: true },
  });
}

// Grants and revokes so `discordUserId` holds exactly the GM roles for the
// zones they can see. Idempotent and safe to re-run: adding a role somebody
// already has and removing one they never had are both no-ops at Discord.
//
// Best-effort per role rather than all-or-nothing — a single failed grant
// should not cost the GM the other five zones.
async function syncGmZoneRoles(prisma, discordUserId) {
  if (!discordUserId) return { granted: 0, revoked: 0 };

  const zones = await gmRoleZones(prisma);
  if (zones.length === 0) return { granted: 0, revoked: 0 };

  // Read what they hold rather than blindly PUT/DELETE all seven: two REST
  // calls per zone per GM on every desk load would be a rate-limit problem
  // long before it was a correctness one.
  const member = await getGuildMember(discordUserId).catch(() => null);
  const held = new Set(member?.roles ?? []);

  // Somebody who is not a GM wants no zones, whatever the table says. Without
  // this the no-rows-means-everything rule reads an ex-GM's empty table as
  // "grant them the lot" — so a demotion would have HANDED them the map.
  // It is also what makes this the whole answer on the way down: revoke the
  // zone seats and the global role is already gone.
  const isGm = member ? hasGmRole(member.roles) : false;
  const visible = isGm ? await visibleZoneIds(prisma, discordUserId) : new Set();
  const wanted = new Set(
    zones.filter((z) => visible === null || visible.has(z.id)).map((z) => z.gmRoleId),
  );

  let granted = 0;
  let revoked = 0;
  for (const zone of zones) {
    const want = wanted.has(zone.gmRoleId);
    const has = held.has(zone.gmRoleId);
    if (want && !has) {
      await addMemberRole(discordUserId, zone.gmRoleId).catch((err) =>
        console.error(`GM zone view: couldn't grant ${zone.name} to ${discordUserId}:`, err.message ?? err),
      );
      granted += 1;
    } else if (!want && has) {
      await removeMemberRole(discordUserId, zone.gmRoleId).catch((err) =>
        console.error(`GM zone view: couldn't revoke ${zone.name} from ${discordUserId}:`, err.message ?? err),
      );
      revoked += 1;
    }
  }
  return { granted, revoked };
}

// Catch-up for everyone holding a GM seat, so a brand-new GM is seated without
// having to find the control first, and somebody who left and came back gets
// their zones back. Sequential on purpose — this runs at startup, where being
// polite to the rate limiter matters more than being quick.
async function syncAllGmZoneRoles(prisma, gmDiscordUserIds) {
  let touched = 0;
  for (const id of gmDiscordUserIds ?? []) {
    const { granted, revoked } = await syncGmZoneRoles(prisma, id);
    if (granted || revoked) touched += 1;
  }
  return touched;
}

module.exports = { syncGmZoneRoles, syncAllGmZoneRoles };
