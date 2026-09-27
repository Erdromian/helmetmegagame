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

/** Called by Chat with the place it is drawing. */
export function useReportHeardPlace(placeKey) {
  useEffect(() => {
    if (!placeKey || placeKey === heard) return;
    heard = placeKey;
    for (const cb of listeners) cb();
  }, [placeKey]);
}
