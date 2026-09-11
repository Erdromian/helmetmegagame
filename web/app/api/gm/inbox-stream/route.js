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

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  // 204 rather than 401, matching /api/gm/inbox-delta: the client reads it as
  // "stop asking", not as an error worth retrying.
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const gmDiscordUserId = session.discordUserId;
  const sinceParam = Number(new URL(request.url).searchParams.get("since"));
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
      let unsubscribe = null;
      let ping = null;
      // Rows the hub has handed us since the last frame, per conversation.
      // The hub re-reads every DirectMessage through the desk's filter anyway
      // (feedHub.js#handleGmDm); carrying that row here rather than throwing
      // it away is what lets this stream serve EVERY conversation instead of
      // one named in the URL — see the note on `open` below.
      let pendingRows = new Map();

      // Declared, and wired to the request, BEFORE the first await. A consumer
      // that disconnects during that await would otherwise hit the no-op
      // finishStream above and leak both the interval and the subscription.
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
      // strand the ping interval and, worse, the subscribeToAllDms callback in
      // a process-wide Set for the life of the container. Every DM in the game
      // would then keep waking a stream nobody is reading.
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };

      // One frame: the rail delta, plus whatever rows arrived for any
      // conversation since the last one.
      //
      // THERE IS NO `open` PARAMETER. It used to take one, so the server could
      // include the open thread's rows — which meant the client had to tear
      // the EventSource down and reopen it every time the GM clicked a
      // different person. That was tolerable when switching was a page
      // navigation; now that it is a click, it would be a reconnect per click,
      // and every reconnect suppressed the chime for whatever arrived during
      // it. Shipping rows for every touched conversation instead costs nothing
      // extra (the hub has already read them) and lets one connection last as
      // long as the tab.
      //
      // Failures are logged and swallowed: the cursor stays put, so the next
      // notification — or the client's own backstop poll — picks up whatever
      // this run missed. Throwing here would kill the stream over a blip.
      const pushDelta = async () => {
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        const rows = pendingRows;
        pendingRows = new Map();
        try {
          const delta = await getInboxDelta({
            gmDiscordUserId,
            sinceMs: cursorMs > 0 ? cursorMs : null,
          });
          if (closed) return;
          cursorMs = delta.cursorMs;
          const threads = [...rows.entries()].map(([discordUserId, messages]) => ({
            discordUserId,
            messages,
          }));
          write(
            `event: delta\ndata: ${JSON.stringify({ version: deployVersion(), ...delta, threads })}\n\n`,
          );
        } catch (err) {
          // Put the rows back so they ride the next frame rather than dying
          // with this one.
          for (const [id, list] of rows) {
            pendingRows.set(id, [...(pendingRows.get(id) ?? []), ...list]);
          }
          console.error("Inbox stream delta failed:", err);
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };

      // A function DECLARATION, not a const arrow: pushDelta's finally block
      // refers to it, and with a const that reference is one line-move away
      // from a temporal-dead-zone ReferenceError.
      function schedule() {
        if (closed || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void pushDelta();
        }, COALESCE_MS);
        timer.unref?.();
      }

      // Subscribe BEFORE the first delta. A row landing in between is buffered
      // in pendingRows and goes out with that frame; the other order would
      // leave a gap nothing covered. Seeing a row twice is free — the client
      // dedupes on id.
      unsubscribe = subscribeToAllDms((row) => {
        if (row?.resync) {
          // The hub's pg client dropped and came back, so rows written in the
          // gap were fanned out to nobody. The cursor cannot have advanced
          // during an outage — no frames went out — so everything missed is
          // above it and one delta fills the hole.
          schedule();
          return;
        }
        if (row?.discordUserId) {
          const list = pendingRows.get(row.discordUserId);
          if (list) list.push(row);
          else pendingRows.set(row.discordUserId, [row]);
        }
        schedule();
      });

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      await pushDelta();
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
