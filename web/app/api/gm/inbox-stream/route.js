import { getGmSession } from "@/lib/discordGuild";
import { getInboxDelta } from "@/lib/inboxDelta";
import { deployVersion } from "@/lib/deployVersion";
import { subscribeToAllDms } from "@/lib/feedHub";

// GET /api/gm/inbox-stream — the player desk's live half, pushed instead of
// polled. One server-sent event stream per open desk tab.
//
// This replaces a 3s poll (PLAYER-DESK.md §9a), and it is worth being precise
// about what changed and what did not. What did NOT change is the payload: a
// frame here is the same {nowMs, cursorMs, rail, thread} shape
// web/lib/inboxDelta.js has always produced, folded by the same applyDelta()
// on the client. Only the trigger moved — from "every three seconds, whether
// or not anything happened" to "when Postgres says a DirectMessage landed"
// (db/lib/dmNotify.js, via the hub's LISTEN in web/lib/feedHub.js).
//
// That matters more than it sounds. The old loop ran the delta's CTE plus a
// character lookup plus a member-cache read twenty times a minute per GM
// forever, on the same connection pool the desk's own navigations use — it was
// part of why clicking a conversation could stall. Quiet hours now cost a ping
// every 25 seconds and nothing else.
//
// §9a argued against exactly this, on the grounds that "a dropped stream that
// looks alive is exactly the failure class this desk has already been burned
// by". Fair, and answered three ways rather than dismissed: the hub pushes a
// {resync:true} sentinel when its pg client reconnects (feedHub.js#resyncDm),
// the tab owns its own reconnect and re-asks from its cursor, and a slow
// backstop poll stays running on the client. The failure §9a feared had in any
// case already happened inside the poll — a loop that stopped without
// rescheduling — so the choice was never "stream risk vs. no risk".
//
// Never cached, never prerendered: this connection stays open as long as the
// tab does.
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// A burst — a GM broadcast, a turn announcement fanning out to a hundred
// players — raises one notification per row. Coalescing them into a single
// delta costs a beat of latency and saves running the CTE a hundred times.
const COALESCE_MS = 120;
// The clock cursor only ever moves forward, but a frame the client never
// received would take its rows with it. The overlap inboxDelta.js already
// applies (10s, deduped by id) covers the ordinary case; this is the belt for
// a write that commits while a frame is in flight.
const COLD_START_MS = 120_000;

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  // 204 rather than 401, matching /api/gm/inbox-delta: the client reads it as
  // "stop asking", not as an error worth retrying.
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const gmDiscordUserId = session.discordUserId;
  const { searchParams } = new URL(request.url);
  // Which conversation the GM has open, so the frame can carry its rows as
  // well as the rail patch. Only ever a lookup key — the delta re-reads it
  // through the desk's own filter and nothing is trusted about it.
  const open = searchParams.get("open") || null;
  const sinceParam = Number(searchParams.get("since"));
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : null;

  const encoder = new TextEncoder();

  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      // Postgres's clock, never the container's — the whole cursor discipline
      // in inboxDelta.js rests on that, and a frame stamped with a different
      // machine's idea of now would blind it.
      let cursorMs = since ?? 0;
      let timer = null;
      let running = false;
      // Set while a delta is in flight and a notification arrives behind it,
      // so the run that is finishing knows to go round again rather than drop
      // the news.
      let dirty = false;

      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      // One delta, from wherever the cursor is, out as one frame.
      //
      // Failures are logged and swallowed: the cursor stays put, so the next
      // notification (or the client's own backstop poll) picks up everything
      // this run missed. Throwing here would kill the stream for a blip.
      const pushDelta = async ({ full = false } = {}) => {
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        try {
          const delta = await getInboxDelta({
            gmDiscordUserId,
            sinceMs: cursorMs > 0 ? cursorMs : null,
            openDiscordUserId: open,
            full,
          });
          if (closed) return;
          cursorMs = delta.cursorMs;
          write(`event: delta\ndata: ${JSON.stringify({ version: deployVersion(), ...delta })}\n\n`);
        } catch (err) {
          console.error("Inbox stream delta failed:", err);
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };

      const schedule = () => {
        if (closed || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void pushDelta();
        }, COALESCE_MS);
        timer.unref?.();
      };

      // The opening frame, before any subscription, so a tab that has just
      // reconnected knows where it stands. A stream opened with no cursor
      // looks back a couple of minutes rather than at the whole table —
      // inboxDelta.js does that itself, but being explicit here documents
      // that a fresh desk is seeded by its own server render, not by this.
      if (cursorMs <= 0) cursorMs = 0;
      await pushDelta({ full: Boolean(open) });

      // Subscribe AFTER the first delta, never before: a row landing between
      // the read and the subscribe would otherwise reach nobody. The cursor
      // has already moved past the read, so anything in that window is above
      // it and the next frame catches it.
      const unsubscribe = subscribeToAllDms((row) => {
        if (row?.resync) {
          // The hub's pg client dropped and came back. Rows written in the gap
          // were fanned out to nobody, but the cursor cannot have advanced
          // during an outage — no frames went out — so they are all above it
          // and one delta fills the hole.
          if (cursorMs > 0) cursorMs = Math.max(0, cursorMs - COLD_START_MS);
          schedule();
          return;
        }
        schedule();
      });

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        clearTimeout(timer);
        unsubscribe();
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
