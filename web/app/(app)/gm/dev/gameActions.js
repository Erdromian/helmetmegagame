"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGameConfig, getGameState } from "@lifeweb/db/lib/gameState";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";

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
  return { ok: true };
}

// Starts the clock. Turn 1 is already open — the wipe creates it — so this
// restamps its date to now and flips the phase; the bot's cron does the rest
// from the next midnight. The player count is stamped from the readied roster
// with 9% headroom for late joins; with nobody readied (a GM test game) the
// config knob keeps standing in.
export async function startGame() {
  const session = await requireSuperadmin();
  const [state, config] = await Promise.all([getGameState(prisma), getGameConfig(prisma)]);
  if (state.phase !== "LOBBY") {
    return { ok: false, error: "Start Game needs an open lobby. ‡" };
  }

  const ready = await prisma.lobbyEntry.count({ where: { status: "READY" } });
  const playerCount = ready > 0 ? Math.ceil(ready * 1.09) : null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.gameState.update({
      where: { id: 1 },
      data: { phase: "RUNNING", startedAt: now, playerCount },
    });
    const open = await tx.turn.findFirst({ where: { status: "OPEN" } });
    if (open) {
      await tx.turn.update({ where: { id: open.id }, data: { gameDate: now } });
    } else {
      await tx.turn.create({
        data: { number: 1, phase: "DAWN", weather: "CLEAR", status: "OPEN", gameDate: now },
      });
    }
  });

  await audit(session, "game_started", {
    readied: ready,
    playerCount: playerCount ?? config.playerCount,
  });
  refresh();
  return { ok: true };
}

// Stops the clock and opens the archive. The closing note is the superadmin's
// epilogue, shown above the reveal.
export async function endGame(formData) {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (state.phase !== "RUNNING") {
    return { ok: false, error: "Only a running game can be ended. ‡" };
  }
  const closingNote = formData?.get("closingNote")?.toString().trim().slice(0, 4000) || null;
  await prisma.gameState.update({
    where: { id: 1 },
    data: { phase: "ENDED", endedAt: new Date(), closingNote, archiveVisible: true },
  });
  await audit(session, "game_ended", { closingNote });
  refresh();
  revalidatePath("/archive");
  return { ok: true };
}

// The undo for End Game. The archive stays open — closing it again would
// re-hide what every player has already seen.
export async function resumeGame() {
  const session = await requireSuperadmin();
  const state = await getGameState(prisma);
  if (state.phase !== "ENDED") {
    return { ok: false, error: "Only an ended game can be resumed. ‡" };
  }
  await prisma.gameState.update({
    where: { id: 1 },
    data: { phase: "RUNNING", endedAt: null },
  });
  await audit(session, "game_resumed");
  refresh();
  return { ok: true };
}
