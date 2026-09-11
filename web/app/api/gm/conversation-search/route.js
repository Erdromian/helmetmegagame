import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { threadKindSql } from "@/lib/dmThread";

// GET /api/gm/conversation-search?q=… — the rail's message-content search.
//
// A route handler rather than a server action, and the reason is the same one
// /api/gm/inbox-delta gives: **a pending server action blocks client-side
// navigation**. This search fires 300ms after a GM stops typing, and it is an
// ILIKE across every DirectMessage ever written. Typing a name and then
// clicking the row you were looking for is the single most ordinary thing to
// do on this desk, and as an action it meant the click waited for the scan.
//
// A plain GET is off the router's serial queue entirely, and — unlike a POST —
// it can be aborted, so a superseded search stops costing anything the moment
// the next keystroke lands.
//
// It matches what OPENING the person would show, notices included
// (threadKindSql, the thread question rather than the rail one): a GM who
// remembers reading a line and cannot search for it has been told the search
// is broken.
export const dynamic = "force-dynamic";

const LIMIT = 50;
const MIN = 3;

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const query = String(new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < MIN) return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });

  // LIKE metacharacters escaped so a query containing % or _ searches for
  // those characters instead of turning into a wildcard. Backslash is
  // Postgres's default LIKE escape character, so no ESCAPE clause is needed.
  const pattern = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

  const rows = await prisma.$queryRaw`
    SELECT dm."discordUserId",
           COUNT(*)::int AS "hits",
           MAX(dm."createdAt") AS "lastAt"
    FROM "DirectMessage" dm
    WHERE dm."content" ILIKE ${pattern}
      AND ${threadKindSql("dm")}
    GROUP BY dm."discordUserId"
    ORDER BY MAX(dm."createdAt") DESC
    LIMIT ${LIMIT}
  `;

  return Response.json(
    {
      hits: rows.map((r) => ({
        discordUserId: r.discordUserId,
        hits: r.hits,
        lastAtMs: r.lastAt ? new Date(r.lastAt).getTime() : 0,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
