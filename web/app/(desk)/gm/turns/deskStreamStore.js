"use client";

import { useSyncExternalStore } from "react";

// Whether this adjudication tab's live channel is being pushed to or is
// limping along on its backstop poll. A module store rather than component
// state because the stream effect writes it, and a setState from an effect is
// the react-hooks/set-state-in-effect error this repo treats as fatal.
//
//   live      the stream is connected, or has never yet failed
//   backstop  the stream has dropped more than once in a row and the slow
//             poll is carrying the desk. One failure says nothing — a laptop
//             waking drops it every time — so the chip waits for two.
//   fatal     the stream never opened after several tries, which is what a
//             signed-out session or a lost GM role looks like from here (a 204
//             closes an EventSource without ever firing `open`).
//
// A SIBLING OF inboxStreamStore.js RATHER THAN A SHARED ONE. The two are the
// same six lines today and it was tempting to generalise them, but they are
// not one thing: a GM can have both desks open in one tab-set and each has to
// answer for itself, and the states are already drifting — this desk will
// grow "a frame is buffered behind a dirty Result box", which means nothing on
// the inbox. One store shared between them would have to be keyed, and a keyed
// store for two callers is a worse trade than twenty duplicated lines.

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

export function useDeskStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function noteDeskStreamUp() {
  emit(LIVE);
}

// `failures` is how many drops in a row this is. The first is free.
export function noteDeskStreamDown(failures) {
  if (state === FATAL) return;
  if (failures >= 2) emit(BACKSTOP);
}

export function noteDeskStreamFatal() {
  emit(FATAL);
}
