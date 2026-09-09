"use client";

import { useSyncExternalStore } from "react";

// The Bascinet conversation's store — the DirectMessage rows this player can
// see, kept the way feedStore.js keeps the scene: module-level state read
// through useSyncExternalStore, so a row landing on the stream re-renders the
// pane and nothing needs a provider.
//
// Much smaller than feedStore.js on purpose. There is one conversation, not a
// map of places; rows are keyed by the row's own id rather than a seq, because
// DirectMessage has no seq and this store never has to agree with a cursor —
// the pane refetches its page on open and after a reconnect (CHAT.md §2b),
// and a row that arrives twice is the same id twice.
//
// Every rebuild makes a new array. react-hooks/immutability is an error in
// this repo, and a mutated array would not re-render anyway.

const EMPTY = Object.freeze([]);

const state = {
  // id -> row, as the server shaped it: { id, direction, content, source,
  // createdAt, meta }.
  byId: new Map(),
  // Frozen, ascending by createdAt then id.
  rows: EMPTY,
  // Whether the pane has loaded its first page. Until then it draws the
  // skeleton rather than "nothing here yet".
  seeded: false,
  hasMore: false,
  // The newest thing Bascinet said, as epoch ms — what the unread dot compares
  // against (seenStore.js compares BigInt strings, and epoch ms is one). Seeded
  // from the page so the dot is right before the pane has ever opened.
  newestOutboundMs: null,
  // Bumped when the tab's EventSource reconnects. A reconnect can have missed
  // a row, and this path has no seq to catch up from, so the pane refetches.
  reconnects: 0,
  // The snapshot useSyncExternalStore hands out — rebuilt on every change,
  // never mutated, so a render that sees the same object can skip.
  snapshot: null,
};

const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function byTime(a, b) {
  const x = Date.parse(a.createdAt);
  const y = Date.parse(b.createdAt);
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rebuild() {
  state.rows = Object.freeze([...state.byId.values()].sort(byTime));
  for (const row of state.rows) {
    if (row.direction !== "OUTBOUND") continue;
    const ms = Date.parse(row.createdAt);
    if (Number.isFinite(ms) && (state.newestOutboundMs === null || ms > state.newestOutboundMs)) {
      state.newestOutboundMs = ms;
    }
  }
  state.snapshot = Object.freeze({
    rows: state.rows,
    seeded: state.seeded,
    hasMore: state.hasMore,
    newestOutboundMs: state.newestOutboundMs,
    reconnects: state.reconnects,
  });
}

// Every write goes through this pair: rebuild the snapshot, then tell the
// subscribers. read() below rebuilds WITHOUT telling anybody — it runs during
// a render, and notifying from there is the thing React warns about.
function commit() {
  rebuild();
  emit();
}

const SERVER_SNAPSHOT = Object.freeze({
  rows: EMPTY,
  seeded: false,
  hasMore: false,
  newestOutboundMs: null,
  reconnects: 0,
});

function read() {
  if (!state.snapshot) rebuild();
  return state.snapshot;
}

function readServer() {
  return SERVER_SNAPSHOT;
}

export function useDmState() {
  return useSyncExternalStore(subscribe, read, readServer);
}

// The page's own answer for the newest thing Bascinet said, before any row has
// been fetched. Only ever moves the number forward.
export function seedNewestOutbound(ms) {
  if (ms === null || ms === undefined) return;
  const n = Number(ms);
  if (!Number.isFinite(n)) return;
  if (state.newestOutboundMs !== null && state.newestOutboundMs >= n) return;
  state.newestOutboundMs = n;
  // Called from Chat.js's state INITIALIZER, i.e. during a render, before
  // anything has subscribed — so nobody is notified here and nobody needs to
  // be: useSyncExternalStore reads the snapshot when it subscribes.
  rebuild();
}

// The first page, or a fresh copy of it after a reconnect. Rows already held
// (a live one that landed while the fetch was out) stay.
export function seedDmRows(rows, hasMore) {
  for (const row of rows ?? []) if (row?.id) state.byId.set(row.id, row);
  state.seeded = true;
  state.hasMore = Boolean(hasMore);
  commit();
}

// An older page, from the sentinel at the top of the thread.
export function prependDmRows(rows, hasMore) {
  for (const row of rows ?? []) if (row?.id) state.byId.set(row.id, row);
  state.hasMore = Boolean(hasMore);
  commit();
}

// One row off the stream, or the one the composer's send came back with. The
// same id twice is a no-op, which is what makes the stream and the action
// racing each other harmless.
export function addDmRow(row) {
  if (!row?.id) return;
  const had = state.byId.get(row.id);
  if (had && had.content === row.content) return;
  state.byId.set(row.id, row);
  commit();
}

export function noteDmReconnect() {
  state.reconnects += 1;
  commit();
}
