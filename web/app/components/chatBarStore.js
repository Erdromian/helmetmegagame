"use client";

import { useSyncExternalStore } from "react";

// What /chat hands the top bar: the handler behind the bar's Mark all read.
//
// The top bar (AppBar.js) is a server component rendered once per route group,
// so it cannot be given a prop by the page under it. Chat publishes here while
// it is mounted and clears it when it goes; ChatBarControls.js reads it. Null
// means "nobody is telling me", and the bar draws neither the bell nor the
// tick. Same shape as navBadge.js.
let bar = null;
const listeners = new Set();

export function setChatBar(next) {
  const value = next ?? null;
  if (value === bar) return;
  bar = value;
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return bar;
}

// The server render has no chat on it.
function getServerSnapshot() {
  return null;
}

export function useChatBar() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
