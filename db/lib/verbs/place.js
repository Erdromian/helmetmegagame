// The verbs tied to one place or to the player rather than their character,
// both faces: Feedback, and readying up in the lobby. (The Merchant's credit
// line lived here until the Depot Overhaul took it away, and the Meister's tax
// until the Meister's Terminal did — db/lib/meisterTerminal.js.) Each was a web
// server action (feedbackActions.js, character/lobbyActions.js) and still is —
// that action calls the function here, and so does the Discord bot
// (bot/src/lib/verbs/meta.js). See ./common.js for the result shape.
const { readGameState } = require("../gameState");
const { hasGmRole, hasPlaytestRole, hasContributorRole, PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID, SUPERADMIN_DISCORD_IDS } = require("../roleIds");
const {
  FEEDBACK_BURST,
  FEEDBACK_WINDOW_MS,
  MAX_FEEDBACK_LENGTH,
  feedbackWaitMessage,
  feedbackWaitMs,
} = require("../feedbackLimits");
const { postFeedbackToDiscord } = require("../feedback");
const { refuse, asResult } = require("./common");

// --- Feedback (web: feedbackActions.js#submitFeedback) ----------------------------

// Open to anybody still in the guild — a spectator noticing a broken page is
// worth hearing from. `username` and `avatarUrl` are the face's to look up.
function submitFeedback(prisma, { discordUserId, username, avatarUrl, body }) {
  return asResult(async () => {
    const text = String(body ?? "").trim();
    if (!text) refuse("Write something first.");
    if (text.length > MAX_FEEDBACK_LENGTH) refuse(`It must be under ${MAX_FEEDBACK_LENGTH} characters.`);
    const now = Date.now();
    const recent = await prisma.feedback.findMany({
      where: { discordUserId, createdAt: { gt: new Date(now - FEEDBACK_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: FEEDBACK_BURST,
      select: { createdAt: true },
    });
    const waitMs = feedbackWaitMs(recent.map((f) => f.createdAt), now);
    if (waitMs > 0) refuse(feedbackWaitMessage(waitMs));
    const character = await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { name: true } });
    const who = username || "Someone";
    await prisma.feedback.create({
      data: { discordUserId, discordUsername: who, characterName: character?.name ?? null, body: text },
    });
    // Best effort, and awaited: postFeedbackToDiscord swallows its own failures.
    await postFeedbackToDiscord({ username: who, avatarUrl, characterName: character?.name ?? null, body: text });
    return { line: "Thanks — it's with the GMs." };
  });
}

// --- The lobby (web: character/lobbyActions.js) -------------------------------------

// Who counts as on the roster (web/lib/discordGuild.js#onRoster): with the
// playtest door shut, GMs, playtesters and Contributors; otherwise the Player
// role or a playtester. `roleIds` are the member's Discord role ids.
function onRoster(roleIds, { playtestMode = false } = {}) {
  const roles = roleIds ?? [];
  if (playtestMode) return hasGmRole(roles) || hasPlaytestRole(roles) || hasContributorRole(roles);
  return roles.includes(PLAYER_ROLE_ID) || hasPlaytestRole(roles);
}

function playtestRosterClosed(config) {
  return config?.playtestModeEnabled === true && config?.playtestRequiresRole !== false;
}

// LOBBY.md §2: the phase is LOBBY, the player is on the roster (a superadmin
// always is), and they have no living character yet.
async function lobbyGate(prisma, { discordUserId, roleIds }) {
  if (!discordUserId) return { error: "Sign in first." };
  const [state, config, alive] = await Promise.all([
    readGameState(prisma, { phase: true }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playtestModeEnabled: true, playtestRequiresRole: true } }),
    prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { id: true } }),
  ]);
  const superadmin = SUPERADMIN_DISCORD_IDS.includes(discordUserId);
  if (state?.phase !== "LOBBY") return { error: "The lobby isn't open." };
  const playtestMode = playtestRosterClosed(config);
  if (!superadmin && !onRoster(roleIds, { playtestMode })) {
    return {
      error: playtestMode
        ? "The game isn't open yet."
        : "You aren't on the roster for this game. Ask a GM if you think that's wrong.",
    };
  }
  if (alive) return { error: "You already have a character." };
  return { discordUserId, whitelisted: superadmin || (roleIds ?? []).includes(LEADER_WHITELIST_ROLE_ID) };
}

// One row per player per game; an upsert, because two Readies from one player
// both find nothing and a plain create threw on the loser's unique key.
function setReady(prisma, { discordUserId, roleIds }) {
  return asResult(async () => {
    const gate = await lobbyGate(prisma, { discordUserId, roleIds });
    if (gate.error) refuse(gate.error);
    const existing = await prisma.lobbyEntry.findUnique({ where: { discordUserId } });
    if (existing && existing.status !== "READY") refuse("Your seat for this game was already decided.");
    const entry =
      existing ??
      (await prisma.lobbyEntry.upsert({
        where: { discordUserId },
        create: { discordUserId, status: "READY" },
        update: {},
      }));
    if (entry.status !== "READY") refuse("Your seat for this game was already decided.");
    // Every preference row exists once somebody is readied, so Start never has
    // to special-case a player who touched nothing.
    if (!existing) {
      await prisma.playerPreference.upsert({ where: { discordUserId }, create: { discordUserId }, update: {} });
    }
    return { readyAt: entry.readyAt.toISOString(), line: "You're ready. The GMs will seat you when the game starts." };
  });
}

function setUnready(prisma, { discordUserId, roleIds }) {
  return asResult(async () => {
    const gate = await lobbyGate(prisma, { discordUserId, roleIds });
    if (gate.error) refuse(gate.error);
    const { count } = await prisma.lobbyEntry.deleteMany({ where: { discordUserId, status: "READY" } });
    // Nothing READY to delete but a row still there: Start got to it first.
    if (count === 0 && (await prisma.lobbyEntry.findUnique({ where: { discordUserId } }))) {
      refuse("Your seat for this game was already decided.");
    }
    return { line: "You're not ready any more." };
  });
}

module.exports = {
  submitFeedback,
  onRoster,
  playtestRosterClosed,
  lobbyGate,
  setReady,
  setUnready,
};
