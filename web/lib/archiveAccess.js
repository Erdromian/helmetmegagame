import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";

// Who may read which game's transcript.
//
// The page and the scroll endpoint both ask this, and neither writes its own
// version. A route handler is a public endpoint exactly like a server action
// is: the page's redirect is not a lock, so the endpoint that feeds the scroll
// has to answer the same question again rather than trust that somebody got
// past the page first.
//
// The gate itself (docs/systemdocs/ARCHIVE.md): a PAST game is readable by any
// signed-in user — it is over, and its record is everyone's. The CURRENT game
// opens only when GameState.archiveVisible is on, and to GMs always. That
// switch is effectively a one-way door, because the archive shows every zone
// regardless of where a character stood and names the character behind every
// /conceal.
export async function loadArchiveAccess(requestedGameId = "") {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, status: 401, reason: "signin" };

  const [{ isGm: gm }, state, games] = await Promise.all([
    getGmSession(),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { archiveVisible: true, gameId: true, phase: true } }),
    prisma.game.findMany({
      // Newest first. This was `number: "desc"` while a game had one; the
      // ordinal is gone and creation order is the same order.
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, startedAt: true, endedAt: true, epilogue: true,
        archivedAt: true, entryCount: true, exportKey: true, createdAt: true,
      },
    }),
  ]);

  // Keyed on the game's id and only that. An id nobody has is no game: what it
  // must not do is quietly fall through to the current one and show it as if
  // it were the one that was asked for.
  const requested = requestedGameId?.toString().trim() ?? "";
  const current = games.find((g) => g.id === state?.gameId) ?? games[0] ?? null;
  const game = requested ? (games.find((g) => g.id === requested) ?? null) : current;
  if (!game) return { ok: false, status: 404, reason: "no-game", current, games, state, gm };

  const isCurrent = game.id === state?.gameId;
  if (isCurrent && !gm && !state?.archiveVisible) {
    return { ok: false, status: 403, reason: "shut", current, games, state, gm };
  }

  return {
    ok: true,
    game,
    games,
    state,
    gm,
    isCurrent,
    // An archived game's rows have LEFT the database — it is a packet in the
    // bucket now. Callers must not run the row queries: they would come back
    // empty and read as a bug rather than as a game deliberately put away.
    archived: Boolean(game.archivedAt),
    // End Game then Resume leaves the epilogue on the Game row and the archive
    // open (LOBBY.md §7). The transcript may stay readable, but the reveal —
    // who the antagonists were and whom they were told to kill — must not,
    // while the game is running again. GMs see it regardless.
    revealHidden: isCurrent && !gm && state?.phase !== "ENDED",
  };
}
