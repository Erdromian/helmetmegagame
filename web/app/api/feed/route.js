import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, lowestFloor, placeSeqWhere } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";
import { subscribeToPlace, subscribeToPresence, subscribeToTyping, subscribeToDm } from "@/lib/feedHub";

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
  // ONE place, for a reader who only wants one. The GM desk's Scene tab is
  // what asks: a GM's place list is every place in every zone they may see,
  // which is hundreds of subscriptions to watch a single room. The gate is
  // unchanged — the place still has to be in placesFor() — this only narrows
  // what the stream bothers with.
  const onlyPlace = searchParams.get("place");
  const sinceParam = searchParams.get("since");
  let since = 0n;
  try {
    if (sinceParam) since = BigInt(sinceParam);
  } catch {
    return new Response("Bad cursor.", { status: 400 });
  }

  const encoder = new TextEncoder();

  // Next logs "The destination stream closed early" when a tab goes away
  // mid-stream and the source has no cancel handler; wiring one through to
  // finish() keeps the log quiet and drops the subscriptions a beat sooner.
  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      // The high-water mark: a row the hub hands us at or below this was
      // already sent by a catch-up, and gets dropped rather than repeated.
      let lastSeq = since;
      // placeKey -> { rows, typing }, each an unsubscribe. Two channels, one
      // entry: a place is subscribed and dropped as a unit.
      const subscriptions = new Map();
      // Everything the wipe put below the line, for the length of this
      // connection (db/lib/feedWipe.js). Read once: a wipe mid-stream leaves
      // rows a reader already has on their screen until the tab reloads,
      // which is the same thing that happens to a Discord client that had the
      // channel open.
      const floors = await feedWipeFloors(prisma);
      // The clamp is one number for every place on this stream, so it has to
      // be the LOWER of the two floors. Clamping to the turn floor would drop
      // a zone-summary row underneath it as "already sent" — the summary is
      // wiped on the slower Dawn schedule and its rows are legitimately older.
      const clamp = lowestFloor(floors);
      if (clamp > lastSeq) lastSeq = clamp;

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

      // A fourth event name, and the only one that is not about a row. It
      // carries the PRESENTED name (the hub resolves it), never a Discord
      // account, and never this viewer's own character — nobody needs telling
      // that they are typing.
      const sendTyping = (event) => {
        if (!event?.placeKey || !event.name) return;
        if (viewer.character && event.characterId === viewer.character.id) return;
        write(`event: typing\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const catchUp = async (placeKeys, from) => {
        if (placeKeys.length === 0) return;
        try {
          const rows = await prisma.archiveEntry.findMany({
            where: {
              ...placeSeqWhere(floors, placeKeys, { gt: from }),
              deletedAt: null,
            },
            orderBy: { seq: "asc" },
            take: CATCH_UP_LIMIT,
            select: FEED_ROW_SELECT,
          });
          // One `?v=` per character across the batch — see
          // db/lib/archive.js#withAvatarVersions.
          for (const row of await withAvatarVersions(prisma, rows)) sendRow(row);
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
        if (onlyPlace) places = places.filter((entry) => entry.placeKey === onlyPlace);

        const wanted = new Set(places.map((entry) => entry.placeKey));
        const added = [];
        for (const key of wanted) {
          if (subscriptions.has(key)) continue;
          subscriptions.set(key, {
            rows: subscribeToPlace(key, sendRow),
            typing: subscribeToTyping(key, sendTyping),
          });
          added.push(key);
        }
        for (const [key, entry] of [...subscriptions]) {
          if (wanted.has(key)) continue;
          entry.rows();
          entry.typing();
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

      // The fifth event: a DirectMessage for this account, already shaped for
      // the player and already past the desk's noise filter (feedHub.js). No
      // cursor and no catch-up — the pane refetches its page on open and on a
      // reconnect (HALL.md §2b). A GM with no character has a desk for this.
      const unsubscribeDm = viewer.character
        ? subscribeToDm(viewer.discordUserId, (row) => {
            write(`event: dm\ndata: ${JSON.stringify(row)}\n\n`);
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
        unsubscribeDm();
        for (const entry of subscriptions.values()) {
          entry.rows();
          entry.typing();
        }
        subscriptions.clear();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      finishStream = finish;
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
