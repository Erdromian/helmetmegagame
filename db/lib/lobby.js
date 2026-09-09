// The lobby's database half (docs/systemdocs/LOBBY.md): building the roll's
// input, checking a previewed draft still fits, committing it, and what
// happens when a player turns a seat down. The web action sends the DMs and
// the bot routes the Decline click; both call in here.

const { assignRoles, newSeed } = require("./roleAssignment");
const { roleCapacity, isSpawnOnly } = require("./roleCapacity");
const { heldSeatsByRole } = require("./seatCount");
const { LEADER_WHITELIST_ROLE_ID } = require("./roleIds");
const { getGameConfig } = require("./gameState");
const { pickTurnBanner } = require("./turnBanner");

// Button customId prefix for the assignment DM's Decline. The web builds the
// button and the bot routes the click — the REST/gateway twin convention.
const LOBBY_DECLINE_PREFIX = "lobby-decline:";

// Nine percent over the readied count, for late joins.
const READY_HEADROOM = 1.09;

// Phases a roll may be previewed and committed in. CLOSED with readied rows
// is a FROZEN lobby: Close lobby, Preview, Start is the sequence that keeps
// somebody readying up between the two from spoiling the draft.
const ROLL_PHASES = new Set(["LOBBY", "CLOSED"]);

// Everything assignRoles needs, read fresh: the readied players with their
// preferences and whitelist standing, every role with its capacity inputs,
// and the seats already spoken for. `memberRoles` maps discordUserId ->
// Discord role ids (from listGuildMembers), the only Discord fact the roll
// reads.
async function loadAssignmentInput(db, memberRoles) {
  const [config, entries, prefs, roles] = await Promise.all([
    getGameConfig(db),
    // Ordered, so the seeded shuffle really is reproducible from its seed.
    db.lobbyEntry.findMany({ where: { status: "READY" }, orderBy: [{ readyAt: "asc" }, { id: "asc" }], select: { discordUserId: true } }),
    db.playerPreference.findMany(),
    db.role.findMany({
      select: {
        id: true, slug: true, name: true, isUnique: true, unlimited: true, weight: true,
        requiresWhitelist: true, grantsLeader: true, factionId: true,
      },
    }),
  ]);
  const prefByUser = new Map(prefs.map((p) => [p.discordUserId, p]));
  const players = entries.map((e) => {
    const p = prefByUser.get(e.discordUserId);
    return {
      discordUserId: e.discordUserId,
      priorities: p?.rolePriorities ?? {},
      joblessRole: p?.joblessRole ?? "COMMONER",
      whitelisted: (memberRoles.get(e.discordUserId) ?? []).includes(LEADER_WHITELIST_ROLE_ID),
    };
  });

  const heldById = await heldSeatsByRole(db, roles);
  const taken = new Map(roles.map((r) => [r.slug, heldById.get(r.id) ?? 0]));

  const playerCount = players.length > 0 ? Math.ceil(players.length * READY_HEADROOM) : (config.playerCount ?? 80);
  return {
    players,
    roles: roles.map((r) => ({ ...r, spawnOnly: isSpawnOnly(r) })),
    taken,
    playerCount,
    leaderWhitelistEnabled: config.leaderWhitelistEnabled !== false,
  };
}

// A draft: what Preview shows and Start commits. Hand-set rows carry
// source "GM"; a re-roll replaces the lot with a new seed.
async function buildDraft(db, memberRoles, { seed = newSeed() } = {}) {
  const input = await loadAssignmentInput(db, memberRoles);
  const rolled = assignRoles({ ...input, seed });
  return {
    seed: rolled.seed,
    playerCount: input.playerCount,
    generatedAt: new Date().toISOString(),
    rows: rolled.rows,
    warnings: rolled.warnings,
  };
}

// Does the draft still fit the world? Every row's player must still be READY
// (nobody unreadied or got a character), every seat must still have room for
// the rows that name it, and every slug must still be a role. Returns a list
// of problems; empty means Start may commit.
async function validateDraft(db, draft) {
  const problems = [];
  if (!draft?.rows) return ["There is no preview to commit. ‡"];
  const [ready, roles] = await Promise.all([
    db.lobbyEntry.findMany({ where: { status: "READY" }, select: { discordUserId: true } }),
    db.role.findMany({ select: { id: true, slug: true, name: true, isUnique: true, unlimited: true, weight: true } }),
  ]);
  const readySet = new Set(ready.map((r) => r.discordUserId));
  const bySlug = new Map(roles.map((r) => [r.slug, r]));
  const drafted = new Set(draft.rows.map((r) => r.discordUserId));

  for (const id of readySet) if (!drafted.has(id)) problems.push("Somebody readied up after the preview. ‡");
  for (const row of draft.rows) {
    if (!readySet.has(row.discordUserId)) problems.push("Somebody in the preview is no longer ready. ‡");
    if (row.roleSlug && !bySlug.has(row.roleSlug)) problems.push(`${row.roleSlug} is no longer a role. ‡`);
    if (row.roleSlug && isSpawnOnly(bySlug.get(row.roleSlug))) problems.push(`${bySlug.get(row.roleSlug).name} can only be spawned, never assigned. ‡`);
  }

  // buildDraft always stamps playerCount; the empty draft has no rows to check.
  const playerCount = draft.playerCount ?? 80;
  const wanted = new Map();
  for (const row of draft.rows) if (row.roleSlug) wanted.set(row.roleSlug, (wanted.get(row.roleSlug) ?? 0) + 1);
  const wantedRoles = [...wanted.keys()].map((slug) => bySlug.get(slug)).filter(Boolean);
  const heldById = await heldSeatsByRole(db, wantedRoles);
  for (const role of wantedRoles) {
    const count = wanted.get(role.slug);
    if ((heldById.get(role.id) ?? 0) + count > roleCapacity(role, playerCount)) {
      problems.push(`${role.name} no longer has room for ${count}. ‡`);
    }
  }
  return [...new Set(problems)];
}

// Commits a validated draft: every READY entry becomes ASSIGNED (with a
// window) or UNASSIGNED, the game goes RUNNING, Turn 1 is restamped to now.
// Returns what the caller must DM. Runs the validation again under a lock on
// the GameState row so two Start clicks cannot both commit.
async function commitAssignment(db, draft, { actorDiscordUserId } = {}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GameState" WHERE id = 1 FOR UPDATE`;
    const state = await tx.gameState.findUnique({ where: { id: 1 } });
    if (!ROLL_PHASES.has(state.phase)) throw new Error("NOT_LOBBY");
    const problems = await validateDraft(tx, draft);
    if (problems.length) {
      const err = new Error("DRAFT_STALE");
      err.problems = problems;
      throw err;
    }

    const config = await getGameConfig(tx);
    const roles = await tx.role.findMany({
      include: { faction: { select: { name: true } }, startingLocation: { include: { zone: { select: { name: true } } } } },
    });
    const bySlug = new Map(roles.map((r) => [r.slug, r]));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (config.creationWindowHours ?? 12) * 3600 * 1000);

    const assigned = [];
    const returned = [];
    for (const row of draft.rows) {
      const role = row.roleSlug ? bySlug.get(row.roleSlug) : null;
      if (role) {
        const entry = await tx.lobbyEntry.update({
          where: { discordUserId: row.discordUserId },
          data: { status: "ASSIGNED", assignedRoleId: role.id, assignedAt: now, expiresAt },
        });
        assigned.push({
          entryId: entry.id,
          discordUserId: row.discordUserId,
          roleName: role.name,
          factionName: role.faction?.name ?? null,
          zoneName: role.startingLocation?.zone?.name ?? null,
          expiresAt,
        });
      } else {
        await tx.lobbyEntry.update({
          where: { discordUserId: row.discordUserId },
          data: { status: "UNASSIGNED" },
        });
        returned.push({ discordUserId: row.discordUserId });
      }
    }

    await tx.gameState.update({
      where: { id: 1 },
      data: { phase: "RUNNING", startedAt: now, playerCount: draft.playerCount ?? null, assignmentDraft: null },
    });
    const open = await tx.turn.findFirst({ where: { status: "OPEN" } });
    if (open) await tx.turn.update({ where: { id: open.id }, data: { gameDate: now } });
    else {
      // Turn.number is unique; a resolved Turn 1 with nothing open is rare but
      // possible by hand, and must not turn Start into a constraint error.
      const last = await tx.turn.aggregate({ _max: { number: true } });
      await tx.turn.create({ data: { number: (last._max.number ?? 0) + 1, phase: "DAWN", banner: pickTurnBanner("DAWN"), status: "OPEN", gameDate: now } });
    }

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actorDiscordUserId ?? "system",
        actionType: "game_started",
        details: {
          seed: draft.seed,
          playerCount: draft.playerCount ?? null,
          assigned: assigned.length,
          returned: returned.length,
          rows: draft.rows,
        },
      },
    });

    return { assigned, returned, expiresAt };
  });
}

// --- The DMs ----------------------------------------------------------------

function epoch(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

// The assignment DM. The first line is the one Discord shows in the
// notification, so the seat is in it. `origin` is the site's canonical origin
// (web/lib/auth.js), passed in because db/ must not know it.
function assignmentMessage({ roleName, factionName, zoneName, expiresAt }, origin) {
  const t = epoch(expiresAt);
  return [
    `**You're in. You are the ${roleName}.**`,
    [factionName ? `${factionName}.` : null, zoneName ? `You start in ${zoneName}.` : null].filter(Boolean).join(" "),
    `Build your character here: ${origin}/character`,
    `The seat is yours until <t:${t}:F> (<t:${t}:R>).`,
    "-# Can't make it? Free the seat up by pressing Decline.",
  ].join("\n");
}

function returnedMessage(origin) {
  return `No seat matched what you asked for. The game has started and late join is open at ${origin}/character. ‡`;
}

function reminderMessage({ roleName, expiresAt }, origin) {
  const t = epoch(expiresAt);
  return `Your seat as ${roleName} is still waiting at ${origin}/character. It opens to anyone <t:${t}:R>, at <t:${t}:F>. ‡`;
}

function expiredMessage({ roleName }, origin) {
  return `Your seat as ${roleName} has been released. Late join is open at ${origin}/character. ‡`;
}

function startedLine() {
  return "The game has begun.";
}

// Raw component JSON, the same shape as the threat spawn offer — the web
// sends this and only the bot has discord.js.
function declineComponents(entryId) {
  return [
    {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `${LOBBY_DECLINE_PREFIX}${entryId}`, label: "Decline the seat" }],
    },
  ];
}

// Stamps the assignment DM as delivered, so the sweep knows not to resend it.
async function markNotified(db, entryId) {
  await db.lobbyEntry.update({ where: { id: entryId }, data: { notifiedAt: new Date() } }).catch(() => {});
}

// A character arrived by ANY route — the wizard, a threat spawn — so the
// player's assigned seat, if they held one, is spent: recorded against the
// character and no longer holding a seat. Every character.create runs this
// in its transaction; without it a readied player who took a spawn instead
// would block their rolled seat for the whole window.
async function settleLobbyEntry(tx, discordUserId, characterId) {
  await tx.lobbyEntry.updateMany({
    where: { discordUserId, status: "ASSIGNED" },
    data: { status: "CREATED", characterId },
  });
}

// The Decline click. The seat is free the moment the status changes, since
// capacity only counts ASSIGNED rows (db/lib/seatCount.js).
async function declineAssignment(db, entryId, discordUserId) {
  const entry = await db.lobbyEntry.findUnique({ where: { id: entryId }, include: { assignedRole: { select: { name: true } } } });
  if (!entry) return { ok: false, reason: "That seat's gone." };
  if (entry.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer. ‡" };
  if (entry.status === "CREATED") return { ok: false, reason: "You already built the character. ‡" };
  if (entry.status !== "ASSIGNED") return { ok: false, reason: "That seat was already released. ‡" };
  await db.lobbyEntry.update({ where: { id: entry.id }, data: { status: "DECLINED" } });
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "lobby_seat_declined",
        details: { entryId: entry.id, role: entry.assignedRole?.name ?? null },
      },
    })
    .catch((err) => console.error("Lobby decline audit failed:", err));
  return { ok: true, line: "You turned the seat down. Late join is open. ‡" };
}

module.exports = {
  LOBBY_DECLINE_PREFIX,
  ROLL_PHASES,
  buildDraft,
  commitAssignment,
  assignmentMessage,
  returnedMessage,
  reminderMessage,
  expiredMessage,
  startedLine,
  declineComponents,
  declineAssignment,
  markNotified,
  settleLobbyEntry,
};
