"use client";

import { createContext, useContext, useEffect, useState } from "react";

const PhaseContext = createContext(null);

/**
 * `{ phase, hasCharacter, standing, ghost, gm, denJukebox }`, or null until the first read
 * lands. `denJukebox` is set for a GM only (gamePhase.js).
 */
export function usePhase() {
  return useContext(PhaseContext);
}

/**
 * Where this viewer is standing — `{ locationSlug, zoneSlug, zoneKind, indoors,
 * attributes, rooms, trainFresh, moodTone, impaired, hallucinating, robed, drugs,
 * charonLaunchedAt, jukebox }`
 * — or null for somebody with no living character.
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

// THIS HAS TO COVER EVERY FIELD IN THE PAYLOAD. It preserves identity so that an unchanged
// answer does not re-run every effect downstream, which means a field it forgets to compare
// is a field that can never change: the first value pins forever, and the ambience goes on
// playing the bed of a state the character left an hour ago. It once compared `phase` and
// `hasCharacter` alone, and adding `standing` without extending it would have done exactly
// that to the place somebody was standing in.
function sameAnswer(a, b) {
  if (a.phase !== b.phase || a.hasCharacter !== b.hasCharacter) return false;
  if (a.ghost !== b.ghost || a.gm !== b.gm) return false;
  if (!sameJukebox(a.denJukebox, b.denJukebox)) return false;
  const x = a.standing;
  const y = b.standing;
  if (!x || !y) return x === y;
  return (
    x.locationSlug === y.locationSlug &&
    x.zoneSlug === y.zoneSlug &&
    x.zoneKind === y.zoneKind &&
    x.indoors === y.indoors &&
    x.trainFresh === y.trainFresh &&
    x.moodTone === y.moodTone &&
    x.impaired === y.impaired &&
    x.hallucinating === y.hallucinating &&
    x.robed === y.robed &&
    x.charonLaunchedAt === y.charonLaunchedAt &&
    JSON.stringify(x.drugs) === JSON.stringify(y.drugs) &&
    sameJukebox(x.jukebox, y.jukebox) &&
    x.attributes.join() === y.attributes.join() &&
    JSON.stringify(x.rooms) === JSON.stringify(y.rooms)
  );
}

// The Den's jukebox (SOUND.md, "The Den's jukebox"): null, or what is on and since when.
function sameJukebox(a, b) {
  if (!a || !b) return (a ?? null) === (b ?? null);
  return (
    a.songKey === b.songKey &&
    a.startedAt === b.startedAt &&
    (a.quietRoomIds ?? []).join() === (b.quietRoomIds ?? []).join()
  );
}

// A poll, out of turn. Walking somewhere is the one thing that should be heard at once
// rather than up to a minute later, so locationMove's continuation calls this — one
// request per move actually made, and none per navigation.
//
// Module scope rather than context, so a server action's continuation can reach it
// without the caller holding a hook. A no-op before the provider mounts.
//
// Returns a promise that settles once the answer is in, for a caller that has to hand
// something over to the poll without a gap (useFeedStream.js, leaving Chat).
let pokePoll = null;

export function nudgePhase() {
  return Promise.resolve(pokePoll?.());
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
