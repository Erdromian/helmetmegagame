"use client";

import { createContext, useContext, useEffect, useState } from "react";

const PhaseContext = createContext(null);

/** `{ phase, hasCharacter, standing }`, or null until the first read lands. */
export function usePhase() {
  return useContext(PhaseContext);
}

/**
 * Where this viewer is standing — `{ locationSlug, zoneSlug, zoneKind, indoors,
 * attributes, trainFresh }` — or null for somebody with no living character.
 *
 * It rides the phase payload rather than having a provider of its own: the ambience bed
 * is picked from it (placeAmbience.js), the phase query was already loading the
 * character on every page, and one answer polled once beats two answers polled twice.
 */
export function useStanding() {
  return useContext(PhaseContext)?.standing ?? null;
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

function sameAnswer(a, b) {
  if (a.phase !== b.phase || a.hasCharacter !== b.hasCharacter) return false;
  const x = a.standing;
  const y = b.standing;
  if (!x || !y) return x === y;
  return (
    x.locationSlug === y.locationSlug &&
    x.zoneSlug === y.zoneSlug &&
    x.zoneKind === y.zoneKind &&
    x.indoors === y.indoors &&
    x.trainFresh === y.trainFresh &&
    x.attributes.join() === y.attributes.join()
  );
}

// A poll, out of turn. Walking somewhere is the one thing that should be heard at once
// rather than up to a minute later, so locationMove's continuation calls this — one
// request per move actually made, and none per navigation.
//
// Module scope rather than context, so a server action's continuation can reach it
// without the caller holding a hook. A no-op before the provider mounts.
let pokePoll = null;

export function nudgePhase() {
  pokePoll?.();
}

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
        //
        // The identity is preserved so an unchanged poll does not re-run every effect
        // downstream — which means the comparison has to cover EVERYTHING in the payload.
        // Comparing phase and hasCharacter alone would have pinned the first standing
        // forever and left the ambience playing the bed of a place the character walked
        // out of an hour ago.
        setData((old) => (old && sameAnswer(old, json) ? old : json));
      } catch {
        // A dropped poll is a minute of stale music. Nothing to report.
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    pokePoll = tick;
    return () => {
      cancelled = true;
      if (pokePoll === tick) pokePoll = null;
      window.clearInterval(id);
    };
  }, []);

  return <PhaseContext.Provider value={data}>{children}</PhaseContext.Provider>;
}
