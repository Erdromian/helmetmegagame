"use client";

import { useCallback, useSyncExternalStore } from "react";

// The conversations this tab has loaded, keyed by discordUserId.
//
// Distinct from liveInbox.js#feeds, and the difference matters: that store
// holds only what has ARRIVED SINCE the desk loaded, and the pane unions it
// over a server-rendered page. This one holds the page itself. Together they
// are the whole thread, and keeping them apart means a live row landing for
// somebody you are not looking at does not have to invent a page for them.
//
// Caching is the point. Going back to a conversation you had open a moment ago
// costs nothing — no request, no spinner, no flash of empty thread — which is
// the other half of what makes selection-as-state better than a navigation.
//
// Bounded, because a GM working an evening could otherwise hold every
// conversation in the game in memory. Least-recently-opened is evicted first;
// the open one is never evicted.

const CAP = 25;

const state = {
  // discordUserId -> { status, payload, error, at }
  //   status: "loading" | "ready" | "error"
  //   payload: the /api/gm/thread body — header fields plus messages/hasMore
  byUser: new Map(),
  snapshot: new Map(),
};

const listeners = new Set();

function emit() {
  // A new Map each time: react-hooks/immutability is an error here, and a
  // mutated Map would not re-render anyway.
  state.snapshot = new Map(state.byUser);
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY = new Map();

function evict(keep) {
  if (state.byUser.size <= CAP) return;
  const entries = [...state.byUser.entries()]
    .filter(([id]) => id !== keep)
    .sort((a, b) => a[1].at - b[1].at);
  let over = state.byUser.size - CAP;
  for (const [id] of entries) {
    if (over <= 0) break;
    state.byUser.delete(id);
    over -= 1;
  }
}

export function getThread(discordUserId) {
  return state.byUser.get(discordUserId) ?? null;
}

export function noteLoading(discordUserId) {
  const had = state.byUser.get(discordUserId);
  // Keep a payload we already have while refetching, so a reopen redraws the
  // old thread immediately and swaps when the fresh one lands — the same trick
  // web/lib/snapshot plays for a whole page.
  state.byUser.set(discordUserId, {
    status: "loading",
    payload: had?.payload ?? null,
    error: null,
    at: Date.now(),
  });
  evict(discordUserId);
  emit();
}

export function noteReady(discordUserId, payload) {
  state.byUser.set(discordUserId, { status: "ready", payload, error: null, at: Date.now() });
  evict(discordUserId);
  emit();
}

export function noteError(discordUserId, error) {
  const had = state.byUser.get(discordUserId);
  state.byUser.set(discordUserId, {
    status: "error",
    payload: had?.payload ?? null,
    error: error ?? "Something went wrong.",
    at: Date.now(),
  });
  emit();
}

// An older page, prepended. Returns nothing — the pane re-reads the store.
export function prependPage(discordUserId, messages, hasMore) {
  const had = state.byUser.get(discordUserId);
  if (!had?.payload) return;
  const seen = new Set(had.payload.messages.map((m) => m.id));
  const older = (messages ?? []).filter((m) => m?.id && !seen.has(m.id));
  state.byUser.set(discordUserId, {
    ...had,
    payload: { ...had.payload, messages: [...older, ...had.payload.messages], hasMore },
    at: Date.now(),
  });
  emit();
}

// The desk's own send, landing before any stream row does.
export function appendRow(discordUserId, row) {
  const had = state.byUser.get(discordUserId);
  if (!had?.payload || !row?.id) return;
  if (had.payload.messages.some((m) => m.id === row.id)) return;
  state.byUser.set(discordUserId, {
    ...had,
    payload: { ...had.payload, messages: [...had.payload.messages, row] },
    at: Date.now(),
  });
  emit();
}

// Seeded by the route's own server render on a cold load, so landing directly
// on /gm/players/<id> paints without a second round trip.
export function seedThread(discordUserId, payload) {
  if (!discordUserId || !payload) return;
  if (state.byUser.get(discordUserId)?.status === "ready") return;
  state.byUser.set(discordUserId, { status: "ready", payload, error: null, at: Date.now() });
  emit();
}

function getSnapshot() {
  return state.snapshot;
}
function getServerSnapshot() {
  return EMPTY;
}

export function useThread(discordUserId) {
  const read = useCallback(
    () => (discordUserId ? (getSnapshot().get(discordUserId) ?? null) : null),
    [discordUserId],
  );
  return useSyncExternalStore(subscribe, read, () => null);
}
