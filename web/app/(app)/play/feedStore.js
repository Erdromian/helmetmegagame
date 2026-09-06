"use client";

import { useCallback, useSyncExternalStore } from "react";

// The Play page's message store, modelled on the GM inbox's
// web/app/(desk)/gm/players/liveInbox.js: module-level state read through
// useSyncExternalStore, so a new message re-renders the one row it belongs to
// and nothing needs a provider.
//
// Two lists per place. `rows` is what the server has confirmed, keyed by seq.
// `pending` is what this tab has typed but not heard back about, keyed by a
// client id — the optimistic append that makes a send feel instant. A
// confirmed row carrying that same clientId replaces its pending twin.
//
// Every rebuild makes a new array and a new Map. react-hooks/immutability is
// an error in this repo, and a mutated array would not re-render anyway.

const EMPTY_ROWS = Object.freeze([]);

const state = {
  // placeKey -> frozen array of rows, ascending by seq, pending rows last
  views: new Map(),
  // placeKey -> Map<seq string, row>
  confirmed: new Map(),
  // placeKey -> Map<clientId, row>
  pending: new Map(),
};

const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function bySeq(a, b) {
  // String compare would put "9" after "10". BigInt is the only correct
  // comparison for this column.
  const x = BigInt(a.seq);
  const y = BigInt(b.seq);
  return x < y ? -1 : x > y ? 1 : 0;
}

function rebuild(place) {
  const confirmed = [...(state.confirmed.get(place)?.values() ?? [])].sort(bySeq);
  const pending = [...(state.pending.get(place)?.values() ?? [])];
  state.views = new Map(state.views);
  state.views.set(place, Object.freeze([...confirmed, ...pending]));
}

// The newest confirmed seq for a place — the cursor the EventSource asks
// with, so a reconnect repeats nothing.
export function lastSeq(place) {
  const rows = state.confirmed.get(place);
  if (!rows || rows.size === 0) return "0";
  let best = 0n;
  for (const key of rows.keys()) {
    const seq = BigInt(key);
    if (seq > best) best = seq;
  }
  return String(best);
}

// Seeds the store from the server-rendered rows. Idempotent: a second call
// with the same rows changes nothing a reader can see.
export function seedRows(place, rows) {
  if (!place || !Array.isArray(rows)) return;
  const next = new Map(state.confirmed.get(place) ?? []);
  let changed = false;
  for (const row of rows) {
    if (!row?.seq || next.has(row.seq)) continue;
    next.set(row.seq, row);
    changed = true;
  }
  if (!changed) return;
  state.confirmed = new Map(state.confirmed);
  state.confirmed.set(place, next);
  rebuild(place);
  emit();
}

// One row in, from the stream or from a send's own answer. Deduped by seq,
// and it evicts the pending row it is the confirmation of.
export function applyRow(place, row) {
  if (!place || !row?.seq) return;
  const confirmed = state.confirmed.get(place) ?? new Map();
  const existing = confirmed.get(row.seq);
  // An edit arrives as the same seq with a newer editedAt. Known-and-identical
  // is the only case worth ignoring; known-and-changed has to replace, or the
  // reader keeps the words their author took back.
  const known = Boolean(existing) && (existing.editedAt ?? null) === (row.editedAt ?? null);

  // The same row reaches this tab twice on a send: once on the stream (no
  // clientId, and often FIRST — a NOTIFY is quicker than the POST's own
  // answer) and once as that answer (with the clientId). Whichever comes
  // second must still evict the pending twin, or the message shows twice —
  // once confirmed, once forever at 60 % opacity.
  let evicted = false;
  if (row.clientId) {
    const pending = state.pending.get(place);
    if (pending?.has(row.clientId)) {
      const stillPending = new Map(pending);
      stillPending.delete(row.clientId);
      state.pending = new Map(state.pending);
      state.pending.set(place, stillPending);
      evicted = true;
    }
  }

  if (known && !evicted) return;

  if (!known) {
    const next = new Map(confirmed);
    next.set(row.seq, row);
    state.confirmed = new Map(state.confirmed);
    state.confirmed.set(place, next);
  }

  rebuild(place);
  emit();
}

// A row somebody took back. Dropped rather than tombstoned: the feed is the
// live scene, and /archive keeps the record.
export function removeRow(place, seq) {
  if (!place || !seq) return;
  const confirmed = state.confirmed.get(place);
  if (!confirmed?.has(String(seq))) return;
  const next = new Map(confirmed);
  next.delete(String(seq));
  state.confirmed = new Map(state.confirmed);
  state.confirmed.set(place, next);
  rebuild(place);
  emit();
}

export function addPending(place, row) {
  if (!place || !row?.clientId) return;
  const next = new Map(state.pending.get(place) ?? []);
  next.set(row.clientId, { ...row, pending: true, failed: false });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
}

// A send that came back an error. The row stays on screen rather than
// vanishing — losing what you typed is worse than seeing it marked unsent.
export function markPendingFailed(place, clientId) {
  const pending = state.pending.get(place);
  if (!pending?.has(clientId)) return;
  const next = new Map(pending);
  next.set(clientId, { ...pending.get(clientId), pending: false, failed: true });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
}

export function retryPending(place, clientId) {
  const pending = state.pending.get(place);
  const row = pending?.get(clientId);
  if (!row) return null;
  const next = new Map(pending);
  next.set(clientId, { ...row, pending: true, failed: false });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
  return row;
}

export function dropPending(place, clientId) {
  const pending = state.pending.get(place);
  if (!pending?.has(clientId)) return;
  const next = new Map(pending);
  next.delete(clientId);
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
}

function getServerRows() {
  return EMPTY_ROWS;
}

export function useFeed(place) {
  const snapshot = useCallback(() => state.views.get(place) ?? EMPTY_ROWS, [place]);
  return useSyncExternalStore(subscribe, snapshot, getServerRows);
}
