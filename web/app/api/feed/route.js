import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { loadFeedCharacter, mayReadPlace } from "@/lib/feedAccess";
import { subscribeToPlace } from "@/lib/feedHub";

// GET /api/feed?place=<key>&since=<seq> — one server-sent event stream per
// open tab.
//
// Never cached, never prerendered: this is a connection that stays open for as
// long as the tab does.
export const dynamic = "force-dynamic";

const CATCH_UP_LIMIT = 200;
const PING_MS = 25_000;

export async function GET(request) {
  const session = await auth();
  if (!session?.discordUserId) return new Response("Not signed in.", { status: 401 });

  const character = await loadFeedCharacter(session.discordUserId);
  if (!character) return new Response("No living character.", { status: 403 });

  const { searchParams } = new URL(request.url);
  const place = searchParams.get("place");
  // The gate. The character comes from the session, never from the query.
  if (!mayReadPlace(character, place)) return new Response("Not your place.", { status: 403 });

  const sinceParam = searchParams.get("since");
  let since = 0n;
  try {
    if (sinceParam) since = BigInt(sinceParam);
  } catch {
    return new Response("Bad cursor.", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // The high-water mark: a row the hub hands us that is not above this is
      // one the catch-up already sent, and gets dropped rather than repeated.
      let lastSeq = since;

      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      // Three events on the wire, and only a NEW row moves the high-water
      // mark. An edit or a delete names a seq the stream has already sent, so
      // dropping it for being "old" would be exactly wrong.
      const sendRow = (row) => {
        if (!row?.seq) return;
        const seq = BigInt(row.seq);
        if (row.op === "delete") {
          write(`event: delete\ndata: ${JSON.stringify({ seq: row.seq, placeKey: row.placeKey })}\n\n`);
          return;
        }
        if (row.op === "edit") {
          write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
          return;
        }
        if (seq <= lastSeq) return;
        lastSeq = seq;
        write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
      };

      // Catch-up first, then subscribe. Doing it the other way round would
      // leave a gap: a row written between the read and the subscribe would
      // reach neither.
      try {
        const rows = await prisma.archiveEntry.findMany({
          where: { placeKey: place, deletedAt: null, seq: { gt: since } },
          orderBy: { seq: "asc" },
          take: CATCH_UP_LIMIT,
          select: FEED_ROW_SELECT,
        });
        for (const row of rows) sendRow(feedRowShape(row));
      } catch (err) {
        console.error("Feed catch-up failed:", err);
      }

      const unsubscribe = subscribeToPlace(place, sendRow);

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      if (request.signal.aborted) finish();
      else request.signal.addEventListener("abort", finish, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and Railway's proxy will otherwise buffer the stream and hold
      // every event until the connection closes, which is never.
      "X-Accel-Buffering": "no",
    },
  });
}
