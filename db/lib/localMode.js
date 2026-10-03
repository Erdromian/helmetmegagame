// Runs this app with no real Discord credentials, no live writes reaching a
// real guild. Hooks into `db/lib/discordRest.js#discordRequest` (the ONE
// place every REST call goes through, ARCHITECTURE.md §5): a recognized
// superadmin id (db/lib/roleIds.js#SUPERADMIN_DISCORD_IDS) fakes the full
// GM/Playtest/Leader-Whitelist bundle, the fixed LOCAL_ECONOMIST_DISCORD_ID
// below fakes the Economist role alone (no GM role, so /gm/* still bounces
// it), LOCAL_SPECTATOR_DISCORD_ID the Spectator role alone, any other id gets only Player (so /gm/* and /econ/* both bounce it),
// and writes are appended to LOCAL_OUTBOX_PATH with a
// stand-in so `.id` reads don't throw. Nothing else should grow its own
// `if (isLocalMode())` Discord branch — extend localDiscordRequest/localMember
// here instead (web/lib/superadmin.js already just checks the same allowlist).
// Turn on with LOCAL_MODE=true; DISCORD_TOKEN/DISCORD_GUILD_ID still need to
// be SET to a placeholder (web/lib/discordGuild.js returns early if either is
// falsy) but their real values are never read.

const fs = require("node:fs");
const path = require("node:path");
const {
  PLAYER_ROLE_ID,
  CONTRIBUTOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  PLAYTEST_ROLE_ID,
  TRIAL_GM_ROLE_ID,
  ECONOMIST_ROLE_ID,
  SPECTATOR_ROLE_ID,
  SUPERADMIN_DISCORD_IDS,
} = require("./roleIds");

function isLocalMode() {
  return process.env.LOCAL_MODE === "true";
}

// Every role a superadmin's local session is granted. TRIAL_GM_ROLE_ID alone
// satisfies hasGmRole() with no DISCORD_GM_ROLE_ID needed. Cursed and Spectator
// are deliberately absent — those are personas, not access.
const LOCAL_ROLES = [TRIAL_GM_ROLE_ID, PLAYTEST_ROLE_ID, CONTRIBUTOR_ROLE_ID, PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID];

// A fixed, obviously-fake id (never a real Discord snowflake — those are
// time-derived off Discord's own epoch) for exercising the Economist-but-not-
// GM path locally: `npm run dev:session -- --economist` mints a cookie for
// it. Nothing else should ever answer to this id.
const LOCAL_ECONOMIST_DISCORD_ID = "1000000000000000001";

// The same for the Spectator seat (`npm run dev:session -- --spectator`):
// Spectator alone, no Player, so it can never be mistaken for somebody between
// characters. Spectator is still absent from LOCAL_ROLES above — a superadmin
// testing the game is not watching it.
const LOCAL_SPECTATOR_DISCORD_ID = "1000000000000000002";

// Only a recognized superadmin id fakes the full GM bundle; the local
// Economist test id gets Economist + Player (no GM role, so /gm/* still
// bounces it); anything else gets just Player.
function localMember(userId) {
  const roles = SUPERADMIN_DISCORD_IDS.includes(userId)
    ? [...LOCAL_ROLES]
    : userId === LOCAL_ECONOMIST_DISCORD_ID
      ? [ECONOMIST_ROLE_ID, PLAYER_ROLE_ID]
      : userId === LOCAL_SPECTATOR_DISCORD_ID
        ? [SPECTATOR_ROLE_ID]
        : [PLAYER_ROLE_ID];
  return {
    user: { id: userId, username: "local-dev", global_name: "Local Tester", avatar: null },
    roles,
  };
}

// Append-only, one JSON object per line, so a stubbed call is one line to tail. Gitignored.
const LOCAL_OUTBOX_PATH = path.resolve(__dirname, "..", "..", "local-discord-outbox.jsonl");

function logStub(method, discordPath, body) {
  const line = JSON.stringify({ at: new Date().toISOString(), method, path: discordPath, body }) + "\n";
  try {
    fs.appendFileSync(LOCAL_OUTBOX_PATH, line);
  } catch (err) {
    console.error("localMode: failed to write the outbox log:", err);
  }
}

// Unique across PROCESSES, not just within one — the counter used to restart
// at 1 every run, so two separate local runs could each mint "local-1" and
// hand it to a different row. A real Discord id is never reused, so neither is
// this one.
const fakeIdPrefix = `local-${process.pid.toString(36)}`;
let fakeIdSeq = 0;

// The local answer to discordRequest(path, opts) — never touches the network.
function localDiscordRequest(discordPath, { method = "GET", body } = {}) {
  const segments = discordPath.split("?")[0].split("/").filter(Boolean);

  // GET /guilds/:id/members/:userId — the one lookup every permission check rests on.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members" && segments[3]) {
    return Promise.resolve(localMember(segments[3]));
  }

  // The roster: a local session is a guild of one. Empty also terminates
  // listGuildMembers()'s `after`-cursor pagination loop on the first page.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members") {
    return Promise.resolve([]);
  }

  // Create/edit/delete: logged instead of sent, stand-in shaped so `.id` reads don't throw.
  if (method !== "GET") {
    logStub(method, discordPath, body);
    fakeIdSeq += 1;
    return Promise.resolve({
      id: `${fakeIdPrefix}-${fakeIdSeq}`,
      channel_id: segments[1] ?? null,
      content: body?.content ?? null,
      token: "local-webhook-token",
    });
  }

  // fetchActiveThreads/listArchivedThreads read `.threads`/`.has_more` directly — a bare `[]` would throw.
  if (method === "GET" && segments.at(-1) === "active") return Promise.resolve({ threads: [] });
  if (method === "GET" && segments.includes("archived")) {
    return Promise.resolve({ threads: [], has_more: false });
  }

  // Every other read: nothing exists locally. List endpoints end pluralized; a single-item fetch ends in an id.
  const tail = segments.at(-1) ?? "";
  const looksSingular = /^\d+$/.test(tail);
  return Promise.resolve(looksSingular ? null : []);
}

module.exports = {
  isLocalMode,
  localDiscordRequest,
  LOCAL_ECONOMIST_DISCORD_ID,
  LOCAL_SPECTATOR_DISCORD_ID,
};
