import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";
import { subscribeToPlace, subscribeToPresence } from "@/lib/feedHub";

// GET /api/feed?since=<seq> — ONE server-sent event stream per open tab,
// carrying every place the viewer may read.
//
// Phase 0 opened a stream per place, which was fine when there was one place.
// A Hall has a Location, its Rooms, the conversations you are in and the zone
// summary, and six EventSources per tab would each hold their own HTTP
// connection against a browser limit of six per origin — a player with two
// tabs open would have starved the rest of the site.
//
// Never cached, never prerendered: this is a connection that stays open for as
// long as the tab does.
export const dynamic = "force-dynamic";

const CATCH_UP_LIMIT = 400;
const PING_MS = 25_000;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return new Response("Not signed in.", { status: 401 });
  if (!viewer.character && !viewer.gm) return new Response("No living character.", { status: 403 });

  const { searchParams } = new URL(request.url);
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
      // The high-water mark: a row the hub hands us at or below this was
      // already sent by a catch-up, and gets dropped rather than repeated.
      let lastSeq = since;
      // placeKey -> unsubscribe
      const subscriptions = new Map();

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

      const catchUp = async (placeKeys, from) => {
        if (placeKeys.length === 0) return;
        try {
          const rows = await prisma.archiveEntry.findMany({
            where: { placeKey: { in: placeKeys }, deletedAt: null, seq: { gt: from } },
            orderBy: { seq: "asc" },
            take: CATCH_UP_LIMIT,
            select: FEED_ROW_SELECT,
          });
          for (const row of rows) sendRow(feedRowShape(row));
        } catch (err) {
          console.error("Feed catch-up failed:", err);
        }
      };

      // Recomputes the place list, tells the client, and moves the
      // subscriptions to match. A newly visible place is caught up from the
      // stream's own high-water mark rather than from zero, so walking into a
      // room does not replay a day of it — the page asks for history when the
      // reader actually opens that place.
      const refreshPlaces = async ({ announce = true, catchUpNew = false } = {}) => {
        let places = [];
        try {
          places = await placesFor(prisma, viewer.character, viewer.options);
        } catch (err) {
          console.error("Feed places failed:", err);
          return;
        }
        if (closed) return;

        const wanted = new Set(places.map((entry) => entry.placeKey));
        const added = [];
        for (const key of wanted) {
          if (subscriptions.has(key)) continue;
          subscriptions.set(key, subscribeToPlace(key, sendRow));
          added.push(key);
        }
        for (const [key, unsubscribe] of [...subscriptions]) {
          if (wanted.has(key)) continue;
          unsubscribe();
          subscriptions.delete(key);
        }

        if (announce) write(`event: places\ndata: ${JSON.stringify({ places })}\n\n`);
        if (catchUpNew && added.length > 0) await catchUp(added, lastSeq);
      };

      // The list first, so a client that reconnects knows what it is looking
      // at before any row lands. Then the catch-up, then the subscriptions —
      // in that order, because subscribing after the read would leave a gap a
      // row written in between could fall into. refreshPlaces subscribes, so
      // the catch-up runs against the list it just built.
      await refreshPlaces({ announce: true });
      await catchUp([...subscriptions.keys()], since);

      // A presence change means the place list moved: their feet, a key, or
      // somebody letting them into a conversation. Serialised behind one
      // promise so two notifications in the same tick cannot interleave two
      // resubscribes.
      let queue = Promise.resolve();
      const unsubscribePresence = viewer.character
        ? subscribeToPresence(viewer.character.id, () => {
            queue = queue
              .then(() => refreshPlaces({ announce: true, catchUpNew: true }))
              .catch((err) => console.error("Feed presence refresh failed:", err));
          })
        : () => {};

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribePresence();
        for (const unsubscribe of subscriptions.values()) unsubscribe();
        subscriptions.clear();
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
