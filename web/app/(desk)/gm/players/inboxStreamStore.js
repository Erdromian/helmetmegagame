"use client";

import { useSyncExternalStore } from "react";

// Whether this desk tab's live inbox is being pushed to or is limping along on
// its backstop poll. A module store rather than component state because the
// stream effect writes it, and a setState from an effect is the
// react-hooks/set-state-in-effect error this repo treats as fatal — the same
// shape and the same reason as chat/streamStore.js.
//
//   live      the stream is connected, or has never yet failed
//   backstop  the stream has dropped more than once in a row and the slow
//             poll is carrying the desk. One failure says nothing — a laptop
//             waking drops it every time — so the chip waits for two.
//   fatal     the stream never opened after several tries, which is what a
//             signed-out session looks like from here (a 204 or 401 closes an
//             EventSource without ever firing `open`).
//
// The desk says so out loud, which is the part §9a was right to want: a live
// path that has quietly stopped is worse than one that never existed, and the
// old poll could stop dead with nothing on screen to say it had.

const LIVE = "live";
const BACKSTOP = "backstop";
const FATAL = "fatal";

let state = LIVE;
const listeners = new Set();

function emit(next) {
  if (next === state) return;
  state = next;
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return LIVE;
}

export function useInboxStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function noteInboxStreamUp() {
  emit(LIVE);
}

// `failures` is how many drops in a row this is. The first is free.
export function noteInboxStreamDown(failures) {
  if (state === FATAL) return;
  if (failures >= 2) emit(BACKSTOP);
}

export function noteInboxStreamFatal() {
  emit(FATAL);
}
