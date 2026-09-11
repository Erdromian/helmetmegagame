import { getGmSession } from "@/lib/discordGuild";
import { deskPatchFor } from "@/lib/deskRows";
import { deployVersion } from "@/lib/deployVersion";
import { subscribeToDesk } from "@/lib/feedHub";

// GET /api/gm/desk-stream — the adjudication desk's live half.
//
// /gm/turns had no data poll at all. A GM's own work shows up because the
// action hands the changed rows back (web/lib/deskRows.js, deskStore.js), but
// another GM's staging, another GM's lock, another GM's Reject only arrived
// when something happened to refetch the page. With five GMs sharing one queue
// that is the difference between a desk and a spreadsheet somebody else is
// also editing.
//
// The shape is the player desk's inbox stream (api/gm/inbox-stream/route.js)
// with one difference worth naming. That stream re-reads its rows in the hub
// and carries them on the notification; this one carries nothing but ids
// (db/lib/deskNotify.js) and re-reads a whole beat's worth in ONE
// deskPatchFor() call here. A turn-end push writes two hundred staged rows in
// a second; coalescing them into one query is the difference between one frame
// and two hundred.
//
// NO ZONE GATE, deliberately. /gm/turns' page does not filter its rows by
// GmZoneView either — the queue rail filters client-side (Workspace.js), so a
// GM can widen their zones with a click and have the rows already there. A
// stream that shipped less than the page would make the click a lie.
//
// Never cached, never prerendered: this connection stays open as long as the
// tab does.
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// Longer than the inbox's 120ms. Every write here raises a notification per
// ROW, and the desk's bursts are big: staging a handful of effects, a Solve
// that writes the Move and its staged rows together, a push that touches
// everything. A quarter-second of latency nobody can feel buys one query
// instead of a dozen.
const COALESCE_MS = 250;

const TYPES = {
  move: "moveIds",
  caving: "cavingRollIds",
  effect: "stagedEffectIds",
  message: "stagedMessageIds",
};

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  // 204 rather than 401, matching the inbox stream: the client reads it as
  // "stop asking", not as an error worth retrying.
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();

  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      let timer = null;
      let running = false;
      // Set while a patch is in flight and a notification arrives behind it,
      // so the run that is finishing knows to go round again rather than drop
      // the news.
      let dirty = false;
      let unsubscribe = null;
      let ping = null;
      // The ids the hub has named since the last frame, per type, and whether
      // the last word on each was "gone". Sets, so a row written five times in
      // one beat is read once.
      let pending = newPending();
      let resyncPending = false;

      function newPending() {
        return { move: new Set(), caving: new Set(), effect: new Set(), message: new Set() };
      }

      // Declared and wired to the request BEFORE the first await, so a
      // consumer that disconnects during it can't leak the interval or the
      // subscription.
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        clearTimeout(timer);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      finishStream = finish;
      if (request.signal.aborted) {
        finish();
        return;
      }
      request.signal.addEventListener("abort", finish, { once: true });

      // A failed enqueue means the consumer is gone. It must call finish(),
      // NOT just set `closed` — finish() opens with `if (closed) return`, so
      // setting the flag here would make every later cleanup path a no-op and
      // strand the ping interval and the subscribeToDesk callback in a
      // process-wide Set for the life of the container. Every staged row in
      // the game would then keep waking a stream nobody is reading.
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };

      // One frame: every id named since the last one, re-read and mapped by
      // the same DTO mappers the page uses.
      //
      // `onDeskOnly` is what keeps a turn-end push — which stamps every Action
      // in the game — from dealing last turn's Moves onto an open queue. See
      // web/lib/deskRows.js.
      //
      // A row the hub called "gone" is NOT sent as a removal from here.
      // deskPatchFor asks for every id and reports the ones that did not come
      // back as removed, which is the same answer and one fewer thing to keep
      // straight — and it is the honest one when a row was deleted and
      // re-created inside the same beat.
      //
      // Failures are logged and swallowed, with the ids put back: throwing
      // here would kill the stream over a blip, and the client's own backstop
      // would then be carrying a desk that looks live.
      const pushPatch = async () => {
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        const batch = pending;
        pending = newPending();
        const wasResync = resyncPending;
        resyncPending = false;
        try {
          if (wasResync) write(`event: resync\ndata: ${JSON.stringify({ version: deployVersion() })}\n\n`);
          const ids = {};
          let any = false;
          for (const [type, field] of Object.entries(TYPES)) {
            ids[field] = [...batch[type]];
            if (ids[field].length) any = true;
          }
          if (!any) return;
          const patch = await deskPatchFor({ ...ids, onDeskOnly: true });
          if (closed) return;
          write(`event: desk\ndata: ${JSON.stringify({ version: deployVersion(), ...patch })}\n\n`);
        } catch (err) {
          for (const type of Object.keys(TYPES)) {
            for (const id of batch[type]) pending[type].add(id);
          }
          console.error("Desk stream patch failed:", err);
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };

      // A function DECLARATION, not a const arrow: pushPatch's finally block
      // refers to it, and with a const that reference is one line-move away
      // from a temporal-dead-zone ReferenceError.
      function schedule() {
        if (closed || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void pushPatch();
        }, COALESCE_MS);
        timer.unref?.();
      }

      unsubscribe = subscribeToDesk((event) => {
        if (event?.resync) {
          // The hub's pg client dropped and came back, so rows written in the
          // gap were fanned out to nobody. A patch is a list of ids, not a
          // window in time, so there is nothing to re-ask for — the tab is
          // told to fetch the page again through its own stale gate.
          resyncPending = true;
          schedule();
          return;
        }
        const bucket = event?.t && pending[event.t];
        if (!bucket) return;
        bucket.add(String(event.id));
        schedule();
      });

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      // An opening frame with nothing in it, so the browser's EventSource
      // fires `open` (and the desk's chip goes live) the moment the route has
      // actually accepted the connection rather than at the first write.
      write(": open\n\n");
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
