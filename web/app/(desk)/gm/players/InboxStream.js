"use client";

import { useEffect, useRef } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { applyDelta, getCursorMs } from "./liveInbox";
import { noteDeskVersion } from "@/app/components/useDeskVersion";
import { noteInboxStreamUp, noteInboxStreamDown, noteInboxStreamFatal } from "./inboxStreamStore";
import { playChime } from "@/app/components/chime";
import useChimeMuted from "@/app/components/useChimeMuted";

// The fast path of the player desk, pushed rather than polled.
//
// What this replaces: a setTimeout chain that hit /api/gm/inbox-delta every
// three seconds for as long as the tab was open, whether or not anything had
// happened. The payload is unchanged — the stream sends the very same delta
// frames (web/app/api/gm/inbox-stream/route.js, over web/lib/inboxDelta.js)
// and they are folded by the very same applyDelta() — so the rail's merge
// rule, the Postgres-clock cursor and the chime all behave exactly as before.
// Only the trigger moved.
//
// THE BACKSTOP POLL STAYS, at 30s instead of 3s. PLAYER-DESK.md §9a is right
// that a dead stream which still looks alive is this desk's worst failure
// mode, and the honest answer is not to trust the stream alone: if it drops,
// the poll keeps the desk correct while inboxStreamStore.js puts a chip in the
// header saying so. Between them, "the desk silently stopped updating" needs
// two independent things to fail rather than one.
//
// Still a plain GET either way, so neither path can reach Next's
// build-mismatch full reload — that hazard belongs to router.refresh(), which
// is InboxPoller's job.
const BACKSTOP_MS = 30_000;
const BACKSTOP_TIMEOUT_MS = 8_000;
// Reconnect is the TAB's job, not EventSource's. Its own retry replays the URL
// it was opened with, which pins `since` to a cursor that is minutes stale by
// the second attempt; reopening by hand lets each try start from where this
// tab actually got to. Same reasoning as chat/Chat.js.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A stream that never once opened is not a blip. After this many failures with
// no `open` in between, say so rather than retrying behind a silent desk.
const FATAL_AFTER = 4;

export default function InboxStream({ deployVersion }) {
  const segment = useSelectedLayoutSegment();
  const [muted] = useChimeMuted();

  // Read at fire time through refs, so toggling the chime doesn't tear the
  // stream down and rebuild it. The open conversation is different: it is in
  // the stream's URL, so a change there does reopen — see the effect deps.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    let source = null;
    let stopped = false;
    let failures = 0;
    let everOpened = false;
    let reconnectTimer = null;
    let backstopTimer = null;
    let backstopInFlight = null;
    // The first frame of a connection reports what was already there — on a
    // fresh desk that is the last two minutes, which the GM has not been away
    // from. Ringing for it would chime on every reconnect.
    let firstFrame = true;

    // One delta in, folded and announced. Shared by the stream and the
    // backstop so the two cannot drift in how they treat a frame.
    function fold(data, { announce }) {
      if (data?.version) noteDeskVersion(data.version, deployVersion);
      const cursor = getCursorMs();
      const { inbound } = applyDelta(data, { sinceMs: cursor, announce });
      if (inbound.length === 0) return;
      const hidden = document.visibilityState !== "visible";
      const ring = inbound.some((m) => hidden || m.discordUserId !== segment);
      if (ring && !mutedRef.current) playChime();
    }

    // ---- the stream -------------------------------------------------------

    function openStream() {
      if (stopped || source) return;
      const params = new URLSearchParams();
      const cursor = getCursorMs();
      if (cursor > 0) params.set("since", String(Math.floor(cursor)));
      if (segment) params.set("open", segment);

      const es = new EventSource(`/api/gm/inbox-stream?${params}`);
      source = es;

      es.addEventListener("open", () => {
        everOpened = true;
        failures = 0;
        noteInboxStreamUp();
      });

      es.addEventListener("delta", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        fold(data, { announce: !firstFrame });
        firstFrame = false;
      });

      es.addEventListener("error", () => {
        // A 204/401 closes the connection without ever firing `open`, which is
        // what being signed out or no longer a GM looks like from here.
        es.close();
        if (source === es) source = null;
        if (stopped) return;
        failures += 1;
        noteInboxStreamDown(failures);
        if (!everOpened && failures >= FATAL_AFTER) {
          noteInboxStreamFatal();
          return;
        }
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      const base = Math.min(RECONNECT_MIN_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
      // Jitter, so five GMs whose streams dropped together don't all come back
      // in the same millisecond.
      const wait = base / 2 + Math.random() * (base / 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // A fresh connection reports its own backlog; that is not news either.
        firstFrame = true;
        openStream();
      }, wait);
    }

    // ---- the backstop -----------------------------------------------------

    async function backstopTick() {
      if (stopped || backstopInFlight) return;
      const params = new URLSearchParams();
      const cursor = getCursorMs();
      if (cursor > 0) params.set("since", String(Math.floor(cursor)));
      if (segment) params.set("open", segment);
      // Ask for the open thread outright rather than the window since the
      // cursor. The rail has this poll as its backstop; the open thread has
      // nothing else, so the one slow tick is where it gets repaired.
      params.set("full", "1");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BACKSTOP_TIMEOUT_MS);
      backstopInFlight = controller;
      try {
        const res = await fetch(`/api/gm/inbox-delta?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 204) {
          stopped = true;
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        // Announce from the backstop too. If the stream is down this is the
        // only thing that will ring, and a GM whose stream died should still
        // hear their mail.
        fold(data, { announce: true });
      } catch {
        // Offline, timing out, mid-switchover — all "try again later". The
        // cursor stays put so nothing is skipped.
      } finally {
        clearTimeout(timeout);
        backstopInFlight = null;
      }
    }

    // ---- wiring -----------------------------------------------------------

    function onWake() {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab: if the stream died while we were away, the
      // error handler's backoff may be minutes out. Retry now.
      if (!source && !stopped) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        firstFrame = true;
        openStream();
      }
      void backstopTick();
    }

    openStream();
    backstopTimer = setInterval(backstopTick, BACKSTOP_MS);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(backstopTimer);
      backstopInFlight?.abort();
      source?.close();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [deployVersion, segment]);

  return null;
}
