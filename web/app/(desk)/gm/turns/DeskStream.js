"use client";

import { useEffect } from "react";
import { applyDeskPatch } from "./deskStore";
import { deskDraftHeld, subscribeToDeskDrafts } from "./deskDraft";
import { noteDeskVersion } from "@/app/components/useDeskVersion";
import { useRefresh } from "@/app/components/useRefresh";
import { noteDeskStreamUp, noteDeskStreamDown, noteDeskStreamFatal } from "./deskStreamStore";

// The other GMs' half of the adjudication desk.
//
// A GM's own work has not needed a refresh since the desk grew its own store:
// every action hands back the rows it changed and they are folded in on the
// spot (deskStore.js). This is the other direction — the Move somebody else
// just claimed, the effect somebody else staged, the row somebody else
// rejected — which until now arrived only when something happened to refetch
// the whole page. Five GMs share one queue; a desk that cannot see four of
// them is a spreadsheet with extra steps.
//
// The payload is the very same patch shape a mutation returns
// (web/lib/deskRows.js#deskPatchFor) folded by the very same applyDeskPatch(),
// so a frame from the stream and a frame from a button are indistinguishable
// once they land, and the store's newer-wins rule arbitrates between them
// without either knowing about the other.
//
// THE BACKSTOP POLL STAYS, at 120s (Workspace.js). A dead stream that still
// looks alive is this desk's worst failure mode and the honest answer is not
// to trust the stream alone — the same argument, and the same answer, as
// InboxStream.js. There is no chime here: a staged effect is not mail.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A stream that never once opened is not a blip. After this many failures with
// no `open` in between, say so rather than retrying behind a silent desk.
const FATAL_AFTER = 4;

const DRAFT_KEY = { moves: (row) => `move:${row.id}`, cavingRolls: (row) => `caving:${row.id}` };

// A row whose work is FINISHED is never buffered, for the same reason a
// removal isn't: there is nothing left for the GM to write, and holding the
// frame back would leave them narrating into a card that has already been
// solved somewhere else. MoveDesk drops its draft when the Solved row lands,
// which is the other half of this. A Caving roll is not in here on purpose —
// a resolved roll's Result box stays editable (CavingDesk.js), so a resolve is
// not the end of anybody's sentence.
const TERMINAL = { moves: (row) => row.reviewStatus === "SOLVED", cavingRolls: () => false };

function buffers(field, row) {
  if (TERMINAL[field](row)) return false;
  return deskDraftHeld(DRAFT_KEY[field](row));
}

// Split a frame into what can land now and what has to wait.
//
// THE DIRTY GUARD. A GM typing into a Move's Result box while another GM edits
// the same Move must not have the row change under them. Their TEXT is already
// safe — the draft wins over the row wherever one exists (deskDraft.js) — but
// the rest of the card would still swap, and a Kind switch or a Solved badge
// flipping mid-sentence is the desk moving while somebody is writing on it.
// So a frame carrying a row with a held draft is buffered and folded when that
// draft is cleared, which is exactly what a save, a solve or a reject does.
//
// REMOVALS ARE NEVER BUFFERED. If another GM rejected the Move being typed
// into, the honest thing is to say so at once — holding it back would leave a
// GM writing a result for a row that no longer exists.
function split(patch) {
  let held = null;
  let fold = patch;
  for (const field of Object.keys(DRAFT_KEY)) {
    const rows = patch[field];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const keep = rows.filter((row) => !buffers(field, row));
    if (keep.length === rows.length) continue;
    if (fold === patch) fold = { ...patch };
    // The turn stamp rides along, so a buffered frame is still judged against
    // the turn it was built for when it finally lands (deskStore.js).
    held = held ?? { asOfMs: patch.asOfMs, turnId: patch.turnId };
    held[field] = rows.filter((row) => buffers(field, row));
    fold[field] = keep;
  }
  return { fold, held };
}

export default function DeskStream({ deployVersion }) {
  const [refresh] = useRefresh();

  useEffect(() => {
    let source = null;
    let stopped = false;
    let failures = 0;
    let everOpened = false;
    let reconnectTimer = null;
    // Frames waiting on a dirty row. An array rather than one merged patch:
    // each carries its own asOfMs, and merging them would have to pick one,
    // which is the store's job and not this file's.
    let buffered = [];

    function drain() {
      if (buffered.length === 0) return;
      const waiting = buffered;
      buffered = [];
      for (const patch of waiting) {
        const { fold, held } = split(patch);
        applyDeskPatch(fold);
        if (held) buffered.push(held);
      }
    }

    function fold(data) {
      if (data?.version) noteDeskVersion(data.version, deployVersion);
      const { fold: now, held } = split(data);
      applyDeskPatch(now);
      if (held) buffered.push(held);
    }

    function openStream() {
      if (stopped || source) return;
      const es = new EventSource("/api/gm/desk-stream");
      source = es;

      es.addEventListener("open", () => {
        everOpened = true;
        failures = 0;
        noteDeskStreamUp();
      });

      es.addEventListener("desk", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        fold(data);
      });

      es.addEventListener("resync", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = null;
        }
        if (data?.version) noteDeskVersion(data.version, deployVersion);
        // The hub's Postgres connection dropped and came back, so rows written
        // in the gap reached nobody. Unlike the inbox there is no cursor to
        // re-ask from — a patch is a list of ids — so the page is fetched
        // again, once. This component is mounted INSIDE
        // DeskStaleRefreshGate, so the refresh it holds is already the guarded
        // one — a resync landing in a deploy window skips rather than turning
        // into Next's build-mismatch hard navigation.
        refresh();
      });

      es.addEventListener("error", () => {
        // A 204 closes the connection without ever firing `open`, which is
        // what being signed out or no longer a GM looks like from here.
        es.close();
        if (source === es) source = null;
        if (stopped) return;
        failures += 1;
        noteDeskStreamDown(failures);
        if (!everOpened && failures >= FATAL_AFTER) {
          noteDeskStreamFatal();
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
        openStream();
      }, wait);
    }

    function onWake() {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab: if the stream died while we were away, the
      // error handler's backoff may be minutes out. Retry now.
      if (!source && !stopped) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        openStream();
      }
    }

    // Every draft write and every clear lands here. A clear is what a save, a
    // solve, a resolve and a reject all do, so this is markClean() by another
    // name — and one that says WHICH row went clean.
    const unsubscribeDrafts = subscribeToDeskDrafts(drain);

    openStream();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      source?.close();
      unsubscribeDrafts();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [deployVersion, refresh]);

  return null;
}
