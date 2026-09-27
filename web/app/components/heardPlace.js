"use client";

import { useEffect, useSyncExternalStore } from "react";

// Which place Chat has open, for the soundtrack. A room is heard only while it is being
// read — a character stands in a Location, not a room — so the Bar's fire needs to know
// the Bar is the one on screen (placeAmbience.js#BY_ROOM, SOUND.md §4b).
//
// Chat WRITES this and MusicDirector reads it. It is not chat/openPlace.js read from the
// root layout, because that store adopts whatever is in the URL hash, and on /handbook
// the hash is a heading: reading it from every page would overwrite the place Chat
// remembers. Only Chat knows which key is a place.
//
// Leaving Chat keeps the last room, which is where the character was last paying
// attention. A room at a Location they have walked out of stops counting on its own:
// resolveAmbience only honours a room in `standing.rooms`.

let heard = null;
const listeners = new Set();

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => heard;
const getServerSnapshot = () => null;

/** The open place key, or null before Chat has opened one this page load. */
export function useHeardPlace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// chat/openPlace.js's own key: the place Chat last had open, kept across page loads. Read
// here, never written — Chat owns it.
const LAST_KEY = "bascinet:play:last-place";

function readLast() {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/**
 * The open place key, or else the one Chat had open last time, even on a page load that
 * never opened Chat. A GM's: "new tracks start from whatever location they are viewing or
 * were last viewing in the chat menu" (SOUND.md §4). A string, so the snapshot compares by
 * value and a re-read never re-renders.
 */
export function useLastHeardPlace() {
  return useSyncExternalStore(subscribe, () => heard ?? readLast(), getServerSnapshot);
}

/** Called by Chat with the place it is drawing. */
export function useReportHeardPlace(placeKey) {
  useEffect(() => {
    if (!placeKey || placeKey === heard) return;
    heard = placeKey;
    for (const cb of listeners) cb();
  }, [placeKey]);
}
