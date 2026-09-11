"use client";

import { useCallback, useSyncExternalStore } from "react";

// What a GM has typed into a desk row but not yet saved — the Move desk's
// Result box and Kind switch, and the Caving desk's Result box.
//
// Those two were the last editors on either desk in no storage tier at all.
// Everything else a GM types is held somewhere: the reply box has dmDraft.js,
// the rail's view state has useSessionState.js, the rows themselves have
// deskStore.js. The Result box had useState and nothing else, so anything
// that replaced the column — a deploy-window hard navigation, an error
// boundary, a stray reload — took the narration with it.
//
// Same shape as dmDraft.js, and for the same reason: MEMORY is the source of
// truth and localStorage is a best-effort mirror, never the other way round.
// A full quota makes setItem throw, and a store that read back from storage
// would freeze the GM's typing mid-sentence.
//
// Keyed by row: "move:<id>" and "caving:<id>". A draft is a whole object (the
// Move desk edits two fields together), replaced wholesale on every write, so
// useSyncExternalStore's identity check is satisfied by the stored reference.
//
// The DRAFT WINS over the row while it exists. Clearing it is what hands the
// editor back to the saved value, so every save, solve, reject and resolve
// clears its own key.

const drafts = new Map(); // key -> object
const listeners = new Set();

function storageKey(key) {
  return `gm-desk-draft-${key}`;
}

function emit() {
  for (const callback of listeners) callback();
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Exported for DeskStream.js, which buffers a live frame for a row somebody is
// mid-sentence in and drains the buffer when the draft is cleared. The draft
// map IS the desk's record of which rows are dirty — keyed, unlike
// useDirtyGuard's global counter, which cannot say WHICH panel is dirty.
export const subscribeToDeskDrafts = subscribe;

// Whether a row is holding unsaved text right now. `key` is the same
// "move:<id>" / "caving:<id>" the editors use.
export function deskDraftHeld(key) {
  return readDeskDraft(key) != null;
}

// Seeded from storage ONCE per key, then never read from storage again. A
// refusal or a bad JSON blob memoises null, so a blocked accessor isn't
// retried on every render.
export function readDeskDraft(key) {
  if (!key) return null;
  const held = drafts.get(key);
  if (held !== undefined) return held;
  let stored = null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw) stored = JSON.parse(raw);
  } catch {
    /* private window, blocked site data, or a half-written value */
  }
  drafts.set(key, stored);
  return stored;
}

// Notify FIRST, mirror second — a throwing setItem can't swallow the
// re-render.
export function writeDeskDraft(key, value) {
  if (!key) return;
  drafts.set(key, value ?? null);
  emit();
  try {
    if (value) window.localStorage.setItem(storageKey(key), JSON.stringify(value));
    else window.localStorage.removeItem(storageKey(key));
  } catch {
    // Full, private, or blocked. The draft is safe in memory for this tab's
    // lifetime; only surviving a reload is lost.
  }
}

export function clearDeskDraft(key) {
  writeDeskDraft(key, null);
}

// Returns the held draft, or null when the row's own saved values are what
// the editor should show.
export function useDeskDraft(key) {
  const get = useCallback(() => readDeskDraft(key), [key]);
  return useSyncExternalStore(subscribe, get, getServerSnapshot);
}

function getServerSnapshot() {
  return null;
}
