"use client";

import { useEffect, useRef } from "react";
import { useRefresh } from "./useRefresh";
import { isAnyDirty } from "./useDirtyGuard";

const POLL_MS = 10_000;

// /character's self-refresh. The page is a server component and used to show
// whatever was true when you opened it — a move made from Discord left the
// old Location's rooms in the Transfer and Loot pickers until a reload.
//
// Not the desks' useGatedRefreshPoll: that refreshes on every tick, which on
// a page this heavy, for 100+ players, is the laggy dashboard CLAUDE.md warns
// about. This asks /api/character-version for a fingerprint of your sheet's
// world and only refresh()es when it moves. Same gates as the desks, read at
// fire time: tab visible, no modal open, nothing half-typed.
//
// `deployVersion` is the build this page rendered from. When the server
// answers with a different one a deploy has landed, and a router.refresh()
// across builds trips Next's mismatch fallback anyway — so it's a plain
// reload instead, on a quiet tick, which is the honest version of the same
// thing.
export default function CharacterPoller({ deployVersion = null }) {
  const [refresh] = useRefresh();
  const baseline = useRef(null);

  useEffect(() => {
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".modal-overlay")) return;
      if (isAnyDirty()) return;
      inFlight = true;
      try {
        const res = await fetch("/api/character-version", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        // 401/403: no session or no living character. Nothing to keep fresh.
        if (!res.ok) return;
        const { version, fp } = await res.json();
        if (deployVersion && version && version !== deployVersion) {
          window.location.reload();
          return;
        }
        if (baseline.current == null) {
          baseline.current = fp;
          return;
        }
        if (fp !== baseline.current) {
          baseline.current = fp;
          refresh();
        }
      } catch {
        // A timeout or a flaky network is a skipped tick, not an error.
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, deployVersion]);

  return null;
}
