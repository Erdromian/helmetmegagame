"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGameState } from "@lifeweb/db/lib/gameState";
import { DM_ACTION, dmAction } from "@lifeweb/db/lib/dmActions";
import {
  buildDraft,
  commitAssignment,
  assignmentMessage,
  returnedMessage,
  startedLine,
  declineComponents,
  markNotified,
  ROLL_PHASES,
} from "@lifeweb/db/lib/lobby";
import { isSpawnOnly } from "@lifeweb/db/lib/roleCapacity";
import { newSeed } from "@lifeweb/db/lib/roleAssignment";
import { endGameInDb, resumeGameInDb, postGameEnded } from "@lifeweb/db/lib/gameEnd";
import { syncSpectatorAccess } from "@lifeweb/db/lib/spectatorAccess";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { auth, CANONICAL_ORIGIN } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { listGuildMembers, sendDm } from "@/lib/discordGuild";

// The game's lifecycle: CLOSED -> LOBBY -> RUNNING -> ENDED, and the two ways
// back (Close lobby, Resume). Every transition is superadmin-only and checks
// the phase it is leaving, so a double click or a stale tab is a refusal
// rather than a second transition. See docs/systemdocs/LOBBY.md §1.
//
// Every action returns { ok } or { ok: false, error } — the Game section's
// client component renders the error in place, since there is no error.js
// under /gm/dev to land on.

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

async function audit(session, actionType, details = {}) {
  await prisma.auditLog
    .create({ data: { actorDiscordUserId: session.discordUserId, actionType, details } })
    .catch((err) => console.error(`${actionType} audit failed:`, err));
}

function refresh() {
  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// Every phase change re-checks who may watch: spectators see the channels
// only while the game is on (db/lib/spectatorAccess.js). Post-commit and
// best-effort; the doctor's cheap scope catches a sweep that died.
function sweepSpectators() {
  after(() =>
    syncSpectatorAccess(prisma).catch((err) => console.error("Spectator sweep failed:", err)),
  );
}

export async function openLobby() {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (state.phase !== "CLOSED") {
    return { ok: false, error: "The lobby can only open from Closed. ‡" };
  }
  await prisma.gameState.update({
    where: { id: 1 },
    data: { phase: "LOBBY", lobbyOpenedAt: new Date() },
  });
  await audit(session, "game_lobby_opened");
  refresh();
  sweepSpectators();
  return { ok: true };
}

// Back to Closed. Readied players keep their rows — the entries are per game
// and the lobby may reopen — but nobody can ready or change anything until it
// does.
export async function closeLobby() {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (state.phase !== "LOBBY") {
    return { ok: false, error: "There is no open lobby to close. ‡" };
  }
  await prisma.gameState.update({ where: { id: 1 }, data: { phase: "CLOSED" } });
  await audit(session, "game_lobby_closed");
  refresh();
  sweepSpectators();
  return { ok: true };
}

// The Discord roles of every guild member, for the roll's whitelist check.
async function memberRoleMap() {
  const members = await listGuildMembers();
  return new Map(members.map((m) => [m.id, m.roles]));
}

// Rolls the lobby and stores the result as the draft Start will commit
// (docs/systemdocs/LOBBY.md §3). Called by Preview and by Re-roll — the only
// difference is the seed.
export async function previewAssignment() {
  await requireSuperadmin();
  const state = await getGameState(prisma);
  if (!ROLL_PHASES.has(state.phase)) return { ok: false, error: "Preview needs a lobby, open or frozen. ‡" };
  const draft = await buildDraft(prisma, await memberRoleMap(), { seed: newSeed() });
  await prisma.gameState.update({ where: { id: 1 }, data: { assignmentDraft: draft } });
  refresh();
  return { ok: true };
}

// Hand-sets one row of the draft. A superadmin may name any role, whitelist
// or not — that is the override — but commit still refuses a seat over
// capacity. An empty slug sends the player back to the lobby.
export async function setDraftRow({ discordUserId, roleSlug }) {
  await requireSuperadmin();
  const state = await getGameState(prisma);
  const draft = state.assignmentDraft;
  if (!ROLL_PHASES.has(state.phase) || !draft?.rows) return { ok: false, error: "There is no preview to edit. ‡" };
  const slug = roleSlug ? String(roleSlug) : null;
  if (slug) {
    const role = await prisma.role.findUnique({ where: { slug }, select: { id: true, slug: true } });
    if (!role) return { ok: false, error: "No such role." };
    if (isSpawnOnly(role)) return { ok: false, error: "That seat can only be spawned, never assigned. ‡" };
  }
  const rows = draft.rows.map((r) =>
    r.discordUserId === discordUserId ? { ...r, roleSlug: slug, source: "GM" } : r,
  );
  await prisma.gameState.update({ where: { id: 1 }, data: { assignmentDraft: { ...draft, rows } } });
  refresh();
  return { ok: true };
}

// Starts the clock. With readied players this commits the previewed draft —
// re-validated under a lock, so a lobby that changed since the preview is a
// refusal rather than a wrong roll. With nobody readied (a GM test game) it
// just flips the phase. Turn 1 is already open — the wipe creates it — so it
// is restamped to now; the bot's cron does the rest from the next midnight.
// The DMs go out after the commit, one at a time.
export async function startGame() {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (!ROLL_PHASES.has(state.phase)) return { ok: false, error: "Start Game needs a lobby, open or frozen. ‡" };

  const ready = await prisma.lobbyEntry.count({ where: { status: "READY" } });
  let draft = state.assignmentDraft;
  if (ready > 0 && !draft?.rows) return { ok: false, error: "Preview the assignment first." };
  if (ready === 0) draft = { seed: null, playerCount: null, rows: [], warnings: [] };

  let outcome;
  try {
    outcome = await commitAssignment(prisma, draft, { actorDiscordUserId: session.discordUserId });
  } catch (err) {
    if (err.message === "DRAFT_STALE") {
      return { ok: false, error: `The lobby changed since the preview. Preview again. ${(err.problems ?? []).join(" ")}` };
    }
    if (err.message === "NOT_LOBBY") return { ok: false, error: "Start Game needs a lobby, open or frozen. ‡" };
    throw err;
  }

  refresh();
  sweepSpectators();
  after(async () => {
    // Sequential on purpose: eighty DMs at once is a rate-limit incident.
    for (const a of outcome.assigned) {
      // Stamped only on success: the sweep resends anything still unstamped
      // five minutes on (db/lib/lobbySweep.js).
      await sendDm(a.discordUserId, assignmentMessage(a, CANONICAL_ORIGIN), {
        authorDiscordUserId: session.discordUserId,
        source: "lobby_assignment",
        components: declineComponents(a.entryId),
        meta: dmAction(DM_ACTION.LOBBY_SEAT, a.entryId),
      })
        .then(() => markNotified(prisma, a.entryId))
        .catch((err) => console.error(`Assignment DM failed for ${a.discordUserId}:`, err));
    }
    for (const r of outcome.returned) {
      await sendDm(r.discordUserId, returnedMessage(CANONICAL_ORIGIN), {
        authorDiscordUserId: session.discordUserId,
        source: "lobby_returned",
      }).catch((err) => console.error(`Return-to-lobby DM failed for ${r.discordUserId}:`, err));
    }
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { turnsConsoleChannelId: true } });
    if (config?.turnsConsoleChannelId) {
      await postMessage(config.turnsConsoleChannelId, startedLine()).catch((err) =>
        console.error("Game started announcement failed:", err),
      );
    }
  });
  return { ok: true, assigned: outcome.assigned.length, returned: outcome.returned.length };
}

// Stops the clock, opens the archive, writes the reveal (db/lib/gameEnd.js)
// and posts it to #turns. The closing note is the superadmin's epilogue,
// shown above the roster.
export async function endGame(formData) {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (state.phase !== "RUNNING") {
    return { ok: false, error: "Only a running game can be ended. ‡" };
  }
  const closingNote = formData?.get("closingNote")?.toString().trim().slice(0, 4000) || null;
  const result = await endGameInDb(prisma, { closingNote, reason: "gm", actorDiscordUserId: session.discordUserId });
  if (!result.ended) return { ok: false, error: "The game had already ended. ‡" };
  refresh();
  revalidatePath("/archive");
  sweepSpectators();
  after(() => postGameEnded(prisma, result.post).catch((err) => console.error("Game Ended post failed:", err)));
  return { ok: true };
}

// The undo for End Game. The archive stays open — closing it again would
// re-hide what every player has already seen.
export async function resumeGame() {
  const session = await requireSuperadmin();
  const result = await resumeGameInDb(prisma, { actorDiscordUserId: session.discordUserId });
  if (!result.resumed) return { ok: false, error: "Only an ended game can be resumed. ‡" };
  refresh();
  sweepSpectators();
  return { ok: true };
}
