"use client";

import { useEffect, useRef } from "react";
import { isAnyDirty } from "@/app/components/useDirtyGuard";

const POLL_MS = 10_000;

// The Dev Character Panel's self-refresh. The panel used to show whatever was
// true when it was opened, so a GM who kept it open across a turn close went
// on reading the old blood, hunger and mood until they reloaded.
//
// Same shape as the player sheet's CharacterPoller.js: ask
// /api/gm/character-version for a fingerprint of this sheet, and repaint only
// when it moves. Same gates, read at fire time: the tab is visible, no dialog
// is open over the panel, and nothing is staged in the Apply bar (DevPanel's
// own useDirtyGuard is what isAnyDirty counts), so a repaint never lands
// under a half-made edit.
//
// `ownOverlays`: the modal frame IS a .modal-overlay, so one is expected there
// and a second is a dialog (a confirm, the Transfer picker) sitting over it.
export default function DevPanelPoller({ characterId, ownOverlays = 0, onChange }) {
  const baseline = useRef(null);
  // The latest callback, so the interval never has to be torn down for it.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    baseline.current = null;
    let inFlight = false;
    async function tick() {
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      if (document.querySelectorAll(".modal-overlay").length > ownOverlays) return;
      if (isAnyDirty()) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/gm/character-version?id=${encodeURIComponent(characterId)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const { fp } = await res.json();
        if (baseline.current == null) {
          baseline.current = fp;
          return;
        }
        if (fp !== baseline.current) {
          baseline.current = fp;
          changed.current?.();
        }
      } catch {
        // A timeout or a flaky network is a skipped tick, not an error.
      } finally {
        inFlight = false;
      }
    }
    // The first read sets the baseline straight away, so a turn that closes
    // in the first few seconds still counts as a change.
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [characterId, ownOverlays]);

  return null;
}
