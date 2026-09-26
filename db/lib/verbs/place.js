// The verbs tied to one place or to the player rather than their character,
// both faces: the Merchant's credit line at the Depot, the Meister's sell tax
// in his office, Feedback, and readying up in the lobby. Each was a web server
// action (depot/actions.js, treasury/actions.js, feedbackActions.js,
// character/lobbyActions.js) and still is — that action calls the function
// here, and so does the Discord bot (bot/src/lib/verbs/place.js). See
// ./common.js for the result shape.
const { blockerFor, ACT } = require("../incapacitation");
const { loadDepot, creditAvailableObols } = require("../depotState");
const { bumpBankAccount } = require("../bankAccounts");
const { COMPANY, DEPOT_DEBT, record, turnStamp } = require("../economyLedger");
const { canReadTreasury } = require("../depotCounter");
const { MERCHANT_LICENSE_SLUG, DEPOT_LOCATION_SLUG } = require("../depot");
const { RAILYARD_ROOM_SLUG } = require("../train");
const { placeKeyForRoom } = require("../placeKey");
const { readGameState } = require("../gameState");
const { hasGmRole, hasPlaytestRole, hasContributorRole, PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID, SUPERADMIN_DISCORD_IDS } = require("../roleIds");
const { FEEDBACK_COOLDOWN_MESSAGE, FEEDBACK_COOLDOWN_MS, MAX_FEEDBACK_LENGTH } = require("../feedbackLimits");
const { postFeedbackToDiscord } = require("../feedback");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");

// --- The Merchant's credit line (web: depot/actions.js#depotCreditImpl) --------

// The acting row with what the counter reads: tags, where they stand, the account.
const DEPOT_ACTOR_INCLUDE = {
  tags: { include: { tag: true } },
  location: { select: { slug: true, id: true } },
  bankAccount: true,
};

// Standing at the Depot with the Merchant's License — the web's
// requireLicensedMerchant, as a refusal.
function requireLicensedMerchant(character) {
  if (character.location?.slug !== DEPOT_LOCATION_SLUG) refuse("You're not standing at the Depot.");
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) refuse(`You can't act — you're ${blocker.name}.`);
  if (!character.tags.some((ct) => ct.tag?.slug === MERCHANT_LICENSE_SLUG)) refuse("You don't have the Merchant's License.");
}

// Draw on the line (cash into the account, debt up) or repay it (the reverse).
// The conditional update IS the check, so two tabs drawing the last of the
// line can't both succeed.
function depotCredit(prisma, { character, discordUserId, direction, amount: rawAmount, openTurn }) {
  return asResult(async () => {
    requireLicensedMerchant(character);
    const account = character.bankAccount;
    if (!account) refuse("You don't have an account yet.");
    const depot = await loadDepot(prisma);
    const draw = direction !== "REPAY";
    const amount = Number(rawAmount);
    if (!Number.isInteger(amount) || amount < 1) refuse("That isn't an amount.");
    if (draw && amount > creditAvailableObols(depot)) refuse(`The line only has ${creditAvailableObols(depot)} ¢ left on it.`);
    if (!draw && amount > (depot.debtObols ?? 0)) refuse(`You only owe ${depot.debtObols ?? 0} ¢.`);
    if (!draw && amount > (account.balanceObols ?? 0)) refuse(`Your account only holds ${account.balanceObols ?? 0} ¢.`);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.depot.updateMany({
        where: draw ? { id: 1, debtObols: { lte: (depot.creditCapObols ?? 0) - amount } } : { id: 1, debtObols: { gte: amount } },
        data: { debtObols: draw ? { increment: amount } : { decrement: amount } },
      });
      if (count === 0) refuse("The line was edited. Try again.");
      // Two legs: the debt (form DEBT) and the cash it puts in the account; repay is the pair backward.
      await record(
        tx,
        { from: draw ? COMPANY : DEPOT_DEBT, to: draw ? DEPOT_DEBT : COMPANY, form: "DEBT", amount },
        { reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
      );
      const moved = await bumpBankAccount(tx, account.id, draw ? amount : -amount, {
        holderName: account.holderName,
        econ: { other: COMPANY, reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
      });
      const room = await tx.room.findUnique({ where: { slug: RAILYARD_ROOM_SLUG }, select: { id: true } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_depot_credit",
        targetCharacterId: character.id,
        place: room ? placeKeyForRoom(room.id) : null,
        turnId: openTurn?.id ?? null,
        details: {
          direction: draw ? "DRAW" : "REPAY",
          amount,
          debtBefore: depot.debtObols ?? 0,
          debtAfter: (depot.debtObols ?? 0) + (draw ? amount : -amount),
          balanceAfter: moved.after,
        },
      });
    });
    return {
      direction: draw ? "DRAW" : "REPAY",
      amount,
      line: draw ? `You drew ${amount} ¢ on the line.` : `You paid ${amount} ¢ back on the line.`,
    };
  });
}

// What the Merchant is looking at before choosing: the line's head-room, what
// is owed, and what the account holds.
async function creditState(prisma, character) {
  const depot = await loadDepot(prisma);
  return {
    available: creditAvailableObols(depot),
    owed: depot.debtObols ?? 0,
    balance: character.bankAccount?.balanceObols ?? 0,
  };
}

// --- The Meister's sell tax (web: treasury/actions.js#setSellTaxRateImpl) --------

// The terminal in the Meister's office. canReadTreasury is the gate — standing
// there, behind a door that opens for you — and the dial is game permission.
function setSellTax(prisma, { discordUserId, rate: rawRate, openTurn }) {
  return asResult(async () => {
    const gate = await canReadTreasury(prisma, discordUserId);
    if (!gate.ok) refuse(gate.error);
    const character = await prisma.character.findUnique({
      where: { id: gate.character.id },
      include: { tags: { include: { tag: true } } },
    });
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You can't act — you're ${blocker.name}.`);
    const rate = Number(rawRate);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) refuse("A rate is a whole number from 0 to 100.");
    const before = (await prisma.depot.findUnique({ where: { id: 1 }, select: { sellTaxRate: true } }))?.sellTaxRate ?? 0;
    await prisma.$transaction(async (tx) => {
      await tx.depot.upsert({ where: { id: 1 }, update: { sellTaxRate: rate }, create: { id: 1, sellTaxRate: rate } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "sell_tax_rate_set",
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        details: { before, after: rate },
      });
    });
    return { rate, before, line: `The sell tax is ${rate}% now.` };
  });
}

// --- Feedback (web: feedbackActions.js#submitFeedback) ----------------------------

// Open to anybody still in the guild — a spectator noticing a broken page is
// worth hearing from. `username` and `avatarUrl` are the face's to look up.
function submitFeedback(prisma, { discordUserId, username, avatarUrl, body }) {
  return asResult(async () => {
    const text = String(body ?? "").trim();
    if (!text) refuse("Write something first.");
    if (text.length > MAX_FEEDBACK_LENGTH) refuse(`It must be under ${MAX_FEEDBACK_LENGTH} characters.`);
    const newest = await prisma.feedback.findFirst({
      where: { discordUserId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (newest && Date.now() - newest.createdAt.getTime() < FEEDBACK_COOLDOWN_MS) refuse(FEEDBACK_COOLDOWN_MESSAGE);
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
  DEPOT_ACTOR_INCLUDE,
  depotCredit,
  creditState,
  setSellTax,
  submitFeedback,
  onRoster,
  playtestRosterClosed,
  lobbyGate,
  setReady,
  setUnready,
};
