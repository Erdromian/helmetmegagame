import { SUPERADMIN_DISCORD_IDS } from "@lifeweb/db/lib/roleIds";

// Canonical list lives in db/lib/roleIds.js so db/lib/localMode.js can read it
// too, without web/ importing back into db/. Re-exported here since this file
// is the established place other web/ modules already import it from.
export { SUPERADMIN_DISCORD_IDS };

// Under LOCAL_MODE a locally-signed-in session still carries a real
// discordUserId (the superadmin id for "Sign in locally", or whichever
// character's id "Start as a player" or dev:session.mjs minted), so the
// allowlist check still applies — only local mode's own Discord-call
// interception (db/lib/localMode.js#localMember) needed a bypass, not this.
export function isSuperadmin(discordUserId) {
  return !!discordUserId && SUPERADMIN_DISCORD_IDS.includes(discordUserId);
}
