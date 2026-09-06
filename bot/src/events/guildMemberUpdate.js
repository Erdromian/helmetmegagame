const { prisma } = require("@lifeweb/db");
const { hasGmRole } = require("@lifeweb/db/lib/roleIds");
const { syncGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");

// The one thing this watches for: somebody being handed a GM role.
//
// A GM's Discord channel access rides the per-zone "GM: <Zone>" roles, not the
// global Gamemaster role (GAMEMASTERS.md §6) — so the moment somebody is
// promoted they hold a role that opens the web desks and NOT ONE Location
// channel, until something grants them their zone seats. Without this handler
// that something is the next bot restart, and a new GM spends the interval
// concluding Discord is broken.
//
// Holding no GmZoneView rows means every zone, so a brand-new GM is seated
// across the whole map here and narrows it later if they want to.
module.exports = {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember) {
    const was = hasGmRole([...(oldMember?.roles?.cache?.keys() ?? [])]);
    const is = hasGmRole([...(newMember?.roles?.cache?.keys() ?? [])]);
    // Only the transition, in either direction: a promotion seats them, and a
    // demotion takes the zone roles back rather than leaving an ex-GM with a
    // sidebar full of Locations. Every other member update — a nickname, an
    // avatar, any other role — is ignored, and there are a lot of those.
    if (was === is) return;

    await syncGmZoneRoles(prisma, newMember.id).catch((err) =>
      console.error(`GM zone view: couldn't reseat ${newMember.id}:`, err.message ?? err),
    );
  },
};
