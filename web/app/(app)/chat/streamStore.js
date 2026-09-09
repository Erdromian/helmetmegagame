"use client";

import { useSyncExternalStore } from "react";

// Whether this tab's live feed is connected, for the one line Chat draws when
// it is not. The same module-store shape as typingStore.js: the stream effect
// in Chat.js writes here, and a setState from that effect would be the
// react-hooks/set-state-in-effect error this repo treats as fatal.
//
//   up        connected, or never yet tried
//   retrying  the connection has dropped more than once in a row and the tab
//             is backing off between attempts. One failure says nothing — a
//             phone waking drops it every time — so the line waits for two.
//   fatal     the stream never opened at all after several tries, which is
//             what a signed-out session looks like from here (a 401 closes an
//             EventSource without ever firing `open`). Only a reload helps.

const UP = "up";
const RETRYING = "retrying";
const FATAL = "fatal";

let state = UP;
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
  return UP;
}

export function useStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function noteStreamUp() {
  emit(UP);
}

// `failures` is how many drops in a row this is. The first is free.
export function noteStreamDown(failures) {
  if (state === FATAL) return;
  if (failures >= 2) emit(RETRYING);
}

export function noteStreamFatal() {
  emit(FATAL);
}
