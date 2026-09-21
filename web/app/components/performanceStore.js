"use client";

import { useSyncExternalStore } from "react";

// What is being played where this character stands, and whose playing this browser has
// muted (docs/systemdocs/SOUND.md, "Performances"). A module store, the shape
// soundStore.js and chat/typingStore.js use.
//
// Two sources feed the live list:
//   - the feed stream's `music` frame (chat/useFeedStream.js), which is the whole live
//     list at the Location every time — so it REPLACES rather than merges;
//   - the performer's own start, noted by PlayInstrumentDialog.js the moment the server
//     answers, so somebody playing from the sheet (no stream open there) hears themselves.
//     A frame that arrives without it means it stopped, and drops it.
//
// The mute list is per browser, in localStorage, keyed by the performer key the server
// mints (db/lib/hoodToken.js#performerKey) — never a character id.

const MUTED_KEY = "bascinet:muted-performers";
const EMPTY = Object.freeze([]);

let framed = EMPTY;
let own = null;
let view = EMPTY;
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function rebuild() {
  const list = own && !framed.some((p) => p.id === own.id) ? [...framed, own] : framed;
  view = list.length === 0 ? EMPTY : Object.freeze(list);
  emit();
}

/** The feed's `music` frame. */
export function setPerformances(list) {
  framed = Array.isArray(list) ? Object.freeze([...list]) : EMPTY;
  if (own && !framed.some((p) => p.id === own.id)) own = null;
  rebuild();
}

/** The performer's own start (a performance row shaped like a frame entry), or null on Stop. */
export function noteOwnPerformance(performance, stoppedId = null) {
  const stopped = performance ? null : (stoppedId ?? own?.id ?? null);
  own = performance ?? null;
  // Stop is heard at once here; the frame that says so follows a moment later.
  if (stopped) framed = Object.freeze(framed.filter((p) => p.id !== stopped));
  rebuild();
}

export function usePerformances() {
  return useSyncExternalStore(subscribe, () => view, () => EMPTY);
}

// ---------------------------------------------------------------- muting

const mutedListeners = new Set();
let mutedRaw = null;
let mutedSet = new Set();

function readMuted() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(MUTED_KEY);
  } catch {
    return mutedSet;
  }
  if (raw === mutedRaw) return mutedSet;
  mutedRaw = raw;
  try {
    const parsed = JSON.parse(raw ?? "[]");
    mutedSet = new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : []);
  } catch {
    mutedSet = new Set();
  }
  return mutedSet;
}

function subscribeMuted(cb) {
  mutedListeners.add(cb);
  const onStorage = (event) => {
    if (event.key === MUTED_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    mutedListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const NO_MUTES = new Set();

export function useMutedPerformers() {
  return useSyncExternalStore(subscribeMuted, readMuted, () => NO_MUTES);
}

export function toggleMutedPerformer(key) {
  if (!key) return;
  const next = new Set(readMuted());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  try {
    window.localStorage.setItem(MUTED_KEY, JSON.stringify([...next]));
  } catch {
    // A private window: the mute lasts as long as this page does.
    mutedRaw = JSON.stringify([...next]);
    mutedSet = next;
  }
  for (const cb of [...mutedListeners]) cb();
}
