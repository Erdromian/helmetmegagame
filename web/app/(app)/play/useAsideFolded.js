"use client";

import { useSyncExternalStore } from "react";

// The breakpoint at which the right column folds: under it the column has
// nowhere to stand and its sections come up in the ⋯ sheet instead. 900px,
// the same number as the `56.25rem` media block in globals.css — the CSS
// hides the column and shows the ⋯, this hook decides which one MOUNTS, and
// if the two disagreed there would be a band with neither. The phone's own
// breakpoint (720px, tabs and the face strip) stays pure CSS.
//
// CSS already hides the column there, but hiding is not unmounting — both
// copies were mounting, so a phone ran two TravelNodes loads, two stash reads
// and two affordance states against one screen. Chat.js renders ONE of them
// off this hook, and the CSS rule stays as belt and braces.
//
// Mirrors web/app/components/useIsCoarsePointer.js: a media query is exactly
// the external mutable value useSyncExternalStore is for, and reading it in
// an effect would be both a frame late and a react-hooks/set-state-in-effect
// error. The server snapshot is false, so a first paint is the desktop shape
// and the client corrects it.
const QUERY = "(max-width: 56.25rem)";

function subscribe(callback) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export default function useAsideFolded() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
