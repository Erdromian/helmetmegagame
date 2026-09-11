"use client";

import { useSyncExternalStore } from "react";

// Who the desk has open, as client state rather than as a route.
//
// This used to be `useSelectedLayoutSegment()`, which meant switching
// conversation was a real Next navigation into the [discordUserId] segment.
// That was the single slowest thing a GM did, for a reason no amount of
// query-tuning could fix: **an RSC navigation cannot be cancelled**. Click
// three people in a row and the third waits for the first two, because each
// one is a server render the router will see through to the end. Ten of them
// in flight together measured five seconds, essentially serialised.
//
// Selection as a store makes a superseded click free — the pane aborts the
// fetch it no longer wants — and makes reopening somebody you have already
// looked at cost nothing at all.
//
// THE URL IS STILL REAL. Every change writes history.pushState, and popstate
// writes back, so Back and Forward work, a pasted /gm/players/<id> works, ⌘K
// works, audit-log links work, and the next.config redirect from the old
// /gm/messages/<id> still lands somewhere sensible. What changed is only that
// the URL follows the selection instead of causing it.

const BASE = "/gm/players";

// Read straight from the path, so the first render already knows who is open
// on a cold load and nothing has to sync it in an effect.
function fromPath(pathname) {
  if (!pathname || !pathname.startsWith(`${BASE}/`)) return null;
  const rest = pathname.slice(BASE.length + 1).split("/")[0];
  return rest ? decodeURIComponent(rest) : null;
}

let selected = null;
let started = false;
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  // The popstate listener is attached on the first subscription rather than at
  // module scope: this module is imported by server-rendered client components
  // too, and `window` is not there when it is evaluated.
  if (!started && typeof window !== "undefined") {
    started = true;
    selected = fromPath(window.location.pathname);
    window.addEventListener("popstate", () => {
      const next = fromPath(window.location.pathname);
      if (next === selected) return;
      selected = next;
      emit();
    });
  }
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  // useSyncExternalStore reads the snapshot during render, before subscribe
  // has run on a first mount, so seed here too rather than return a stale null.
  if (!started && typeof window !== "undefined") selected = fromPath(window.location.pathname);
  return selected;
}

function getServerSnapshot() {
  // The server half cannot read window. Every consumer is inside the desk
  // shell, which is client-rendered below the layout, so this only covers the
  // hydration pass — getSnapshot takes over immediately after.
  return null;
}

export function useSelection() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getSelection() {
  return selected;
}

// Open somebody, or pass null for the roster. `replace` is for landing on a
// URL rather than choosing from it — it must not add a history entry, or Back
// would return to the page you just arrived at.
export function selectConversation(discordUserId, { replace = false } = {}) {
  const next = discordUserId || null;
  if (next === selected) return;
  selected = next;
  if (typeof window !== "undefined") {
    const url = next ? `${BASE}/${encodeURIComponent(next)}` : BASE;
    // pushState rather than router.push: router.push would re-enter the very
    // navigation this store exists to avoid. The route the app is actually
    // mounted on stays put; only the address bar and the store move.
    if (replace) window.history.replaceState(window.history.state, "", url);
    else window.history.pushState(window.history.state, "", url);
  }
  emit();
}
