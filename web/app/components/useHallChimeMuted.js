"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whether the Hall's mention chime is muted, persisted per-browser.
//
// A sibling of useChimeMuted.js rather than a reuse of it: that one is the GM
// inbox's, on the `gm-chime-muted` key, and the two are different people
// making different decisions. A GM silencing their desk should not silence a
// character's mentions on the same laptop.
//
// localStorage read in the snapshot function, never an effect
// (react-hooks/set-state-in-effect is an error in this repo), and every access
// wrapped: a private window can throw on the getter itself.

const KEY = "hall-chime-muted";

function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function readServer() {
  return false;
}

// The same answer outside React, for a stream handler that has to decide at
// the moment a row lands. A ref mirroring the hook's value would have been
// the obvious shape and is not allowed here (react-hooks/refs), and it would
// have been a second copy of a value localStorage already holds.
export function hallChimeMuted() {
  if (typeof window === "undefined") return false;
  return read();
}

function write(muted) {
  try {
    window.localStorage.setItem(KEY, muted ? "1" : "0");
    // The storage event never fires in the tab that wrote it, so the toggle
    // would not repaint itself without this nudge.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}

export default function useHallChimeMuted() {
  const muted = useSyncExternalStore(subscribe, read, readServer);
  const setMuted = useCallback((next) => write(next), []);
  return [muted, setMuted];
}
