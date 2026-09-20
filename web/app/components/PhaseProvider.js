"use client";

import { createContext, useContext, useEffect, useState } from "react";

const PhaseContext = createContext(null);

/** `{ phase, hasCharacter }`, or null until the first read lands. */
export function usePhase() {
  return useContext(PhaseContext);
}

// Is the game shut, in its lobby, or running — and does this viewer have a character?
// Mirrors MoveWindowProvider.js: the promise streams from the root layout, so the first
// answer costs no round trip.
//
// Mounted in the ROOT layout rather than (app)/layout.js on purpose. The closed door has a
// soundtrack, and the people standing at it are on /handbook, on the sign-in screen, and
// in (public) — none of which (app) covers.
//
// Then a poll, because a phase change has to reach the music without a hard refresh.
// Sixty seconds: two indexed lookups per visible tab per minute, and a minute of latency
// on a soundtrack is imperceptible. Do not poll faster; nothing here is worth it.
const POLL_MS = 60_000;

export default function PhaseProvider({ children, phasePromise }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(phasePromise)
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phasePromise]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/music-phase", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const json = await response.json();
        // Written from a fetch continuation, not from an effect body — the shape
        // react-hooks/set-state-in-effect allows, and the one MoveWindowProvider uses.
        setData((old) =>
          old && old.phase === json.phase && old.hasCharacter === json.hasCharacter ? old : json,
        );
      } catch {
        // A dropped poll is a minute of stale music. Nothing to report.
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return <PhaseContext.Provider value={data}>{children}</PhaseContext.Provider>;
}
