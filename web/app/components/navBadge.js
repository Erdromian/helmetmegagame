"use client";

import { useSyncExternalStore } from "react";

// The live count behind the rail's Players badge.
//
// The badge is server-rendered in `loadNavItems`, which is right for a first
// paint and wrong for everything after it: reading a conversation moves this
// GM's cursor and deliberately revalidates nothing (PLAYER-DESK.md §9), so
// the number sat there stale until some unrelated navigation rebuilt the
// layout. A GM cleared their inbox and the rail went on claiming three.
//
// The desk already computes the same number over its live-merged rows for the
// header chips, so it publishes it here rather than the rail trying to
// recompute it from patches it cannot see the whole of. Null means "nobody is
// telling me" — every page that is not the player desk — and the rail falls
// back to what the server rendered.
let count = null;
const listeners = new Set();

export function setNavUnread(next) {
  const value = Number.isFinite(next) ? next : null;
  if (value === count) return;
  count = value;
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return count;
}

// The server render has no desk on it, so it always falls back.
function getServerSnapshot() {
  return null;
}

export function useNavUnread() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
