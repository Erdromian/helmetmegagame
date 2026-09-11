"use client";

import { useSyncExternalStore } from "react";

// The phone. Under 720px Chat is one column with a drawer either side — the
// same number as DESIGN-SYSTEM.md §9's shell breakpoint and the `720px` media
// block in globals.css. The CSS hides and shows; this hook decides what
// MOUNTS: the ≡ and 👥 in the head, the folded members row, the one-line
// composer. Hiding is not unmounting (useAsideFolded.js has the history), so
// anything that behaves differently on a phone reads this rather than
// relying on a display:none.
//
// Same shape as useAsideFolded.js and useIsCoarsePointer.js: a media query
// is exactly the external mutable value useSyncExternalStore is for. The
// server snapshot is false, so the first paint is the desktop shape and the
// client corrects it in the same frame it hydrates.
const QUERY = "(max-width: 720px)";

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

export default function useNarrow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
