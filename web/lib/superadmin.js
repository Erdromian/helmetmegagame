import { isLocalMode } from "@lifeweb/db/lib/localMode";

// Discord user IDs allowed onto the /gm/dev panel, independent of the
// in-game GM role — this is host/developer access, not a game permission.
export const SUPERADMIN_DISCORD_IDS = [
  "1507184027919057108",
  "262426987979735040",
  "216301927242137600",
];

// The one check db/lib/localMode.js's discordRequest interception can't
// reach: this is a hardcoded id list with no Discord call in it at all, so
// local mode is checked here directly instead.
export function isSuperadmin(discordUserId) {
  if (isLocalMode()) return true;
  return !!discordUserId && SUPERADMIN_DISCORD_IDS.includes(discordUserId);
}
