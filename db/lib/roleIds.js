// Static Discord role IDs (and one user-ID allowlist), hardcoded rather than
// env-configured.
//
// These are not secrets: a role ID is visible to anyone in the guild, and
// Bascinet is a single-guild game, so there is exactly one correct value for
// each and it will never differ between environments. Keeping them in code
// means they cannot be half-configured — the failure mode of an env var here
// was a deploy where the player gate silently locked everyone out or the
// spectator overwrite silently did nothing.
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

// The playtest seat. Counts as on the roster whether or not they hold the
// Player role — so a contributor can test creation and play without being
// seated as a GM. It does NOT open the doors early: a playtester readies up in
// the lobby and waits for the roll like everybody else, because a rehearsal
// that skips the lobby never rehearses the lobby. Only a GM keeps the Skip
// button. Grants nothing else. Reads as "Playtest" in
// the guild; created 2026-09-07 and handed to every Contributor at the time.
// Unmentionable and uncoloured on purpose, so db:prune-orphan-roles never
// mistakes it for a character's name token.
const PLAYTEST_ROLE_ID = "1546259369539280936";

// The people building this game. Distinct from the Playtest seat above:
// Playtest is a testing bypass, while this marks a person who works on
// Bascinet. It grants nothing on its own and is read by exactly one gate —
// GameConfig.playtestModeEnabled, which narrows the roster to the people
// making the thing. Reads as "Contributor" in the guild.
const CONTRIBUTOR_ROLE_ID = "1544753625526440027";

// The trial GM seat. Access-identical to the Gamemaster role everywhere — the
// web panel, the GM channel overwrites, the bot's /gm and /dm — and the only
// difference is the word the GM roster on /gm/dev puts next to the name.
const TRIAL_GM_ROLE_ID = "1545942420271931543";

// Discord user IDs allowed onto the /gm/dev panel, independent of the
// in-game GM role — this is host/developer access, not a game permission.
// Canonical here (not a Discord role at all) so db/lib/localMode.js can read
// it without web/ importing back into db/; web/lib/superadmin.js re-exports
// it rather than keeping its own copy.
const SUPERADMIN_DISCORD_IDS = ["1507184027919057108", "262426987979735040", "216301927242137600"];

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

// Does this list of role ids carry the playtest seat?
function hasPlaytestRole(roleIds) {
  return (roleIds ?? []).includes(PLAYTEST_ROLE_ID);
}

// Does this list of role ids carry the contributor seat?
function hasContributorRole(roleIds) {
  return (roleIds ?? []).includes(CONTRIBUTOR_ROLE_ID);
}

module.exports = {
  PLAYER_ROLE_ID,
  SPECTATOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  TRIAL_GM_ROLE_ID,
  PLAYTEST_ROLE_ID,
  CONTRIBUTOR_ROLE_ID,
  SUPERADMIN_DISCORD_IDS,
  gmRoleIds,
  hasGmRole,
  hasPlaytestRole,
  hasContributorRole,
};
