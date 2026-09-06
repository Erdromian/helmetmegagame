// Static Discord role IDs, hardcoded rather than env-configured.
//
// These are not secrets: a role ID is visible to anyone in the guild, and
// Bascinet is a single-guild game, so there is exactly one correct value for
// each and it will never differ between environments. Keeping them in code
// means they cannot be half-configured — the failure mode of an env var here
// was a deploy where the player gate silently locked everyone out or the
// spectator overwrite silently did nothing.
//
// Same reasoning as web/lib/superadmin.js's SUPERADMIN_DISCORD_IDS.
//
// Contrast with DISCORD_TOKEN/DISCORD_GUILD_ID/DISCORD_GM_ROLE_ID, which stay
// in the environment — the token is a real credential, and the others predate
// this and are still wired through .env.

// Who may create a character or ready up. Paired with GameState.phase: the
// phase says the doors are open, this role says who is on the list.
const PLAYER_ROLE_ID = "1539805619903791219";

// The standing read-only observer seat — sees every Location channel and both
// narrowcast channels, can never contribute anything anywhere.
const SPECTATOR_ROLE_ID = "1540054129752154292";

// Who may pick a role flagged `whitelist:` in docs/roles.yaml. Such a seat is
// reserved for players who can vouch for availability and roleplay, so the
// role is handed out by a GM, not earned in-game.
//
// Reads as "Whitelist" in the guild's role list — match it by name if you ever
// have to check this ID. The previous value here pointed at a role the
// pre-launch cleanup had deleted, which nobody could hold, so every
// whitelisted seat greyed out for everyone with no error anywhere. The gate
// fails closed on purpose, and that is exactly why it was silent.
const LEADER_WHITELIST_ROLE_ID = "1545070354295169214";

// The trial GM seat. Access-identical to the Gamemaster role everywhere — the
// web panel, the GM channel overwrites, the bot's /gm and /dm — and the only
// difference is the word the GM roster on /gm/dev puts next to the name.
const TRIAL_GM_ROLE_ID = "1545942420271931543";

// Every role that counts as a GM, in one place. Nothing reads
// DISCORD_GM_ROLE_ID directly any more: two roles meaning the same thing is
// exactly the shape that drifts, and a site still checking one of them would
// be a GM who can open the web panel but not the channels, or the reverse.
function gmRoleIds() {
  return [process.env.DISCORD_GM_ROLE_ID, TRIAL_GM_ROLE_ID].filter(Boolean);
}

// Does this list of role ids carry any GM seat?
function hasGmRole(roleIds) {
  const ids = gmRoleIds();
  return (roleIds ?? []).some((id) => ids.includes(id));
}

module.exports = {
  PLAYER_ROLE_ID,
  SPECTATOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  TRIAL_GM_ROLE_ID,
  gmRoleIds,
  hasGmRole,
};
