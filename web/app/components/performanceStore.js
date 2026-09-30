"use client";

import { useSyncExternalStore } from "react";
import { saveLocal } from "../../lib/localSave.js";

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

// ---------------------------------------------------------------- the Den's jukebox

// What the feed stream's `music` frame last said about the Den's jukebox (SOUND.md, "The
// Den's jukebox"): `undefined` while no stream is open — the phase poll's `standing.jukebox`
// speaks then — `null` for "nothing playing where you stand", or { songKey, startedAt,
// quietRoomIds }. InstrumentListener.js prefers this whenever it is defined, because the
// stream is live and the poll is up to a minute behind.
let framedJukebox;
// The same for a GM, off the stream's `den` frame: what the Den's box has on, whichever
// place is open (InstrumentListener.js decides whether that place is in the Den). The
// phase poll's `denJukebox` speaks while this is `undefined`.
let framedDenJukebox;
// Bumped by every frame, so a release that is still waiting on its poll can tell that a
// stream has spoken since and leave the new frame alone.
let framedGeneration = 0;

/** The feed's word on the jukebox where the character stands. */
export function setFramedJukebox(jukebox) {
  framedGeneration += 1;
  if (jukebox === framedJukebox) return;
  framedJukebox = jukebox;
  emit();
}

/** The feed's word on the Den's jukebox, for a GM. */
export function setFramedDenJukebox(jukebox) {
  framedGeneration += 1;
  if (jukebox === framedDenJukebox) return;
  framedDenJukebox = jukebox;
  emit();
}

/**
 * The stream has closed: hand both back to the phase poll, but only once `settled` (the
 * poll it nudged) has answered. Letting go at once would fall back on a poll that may be a
 * minute old and not know the song yet, and the song would stop and start again a second
 * later. A stream that opens again before then keeps its own frames.
 */
export function releaseFramedJukeboxes(settled) {
  const generation = ++framedGeneration;
  Promise.resolve(settled)
    .catch(() => {})
    .then(() => {
      if (generation !== framedGeneration) return;
      if (framedJukebox === undefined && framedDenJukebox === undefined) return;
      framedJukebox = undefined;
      framedDenJukebox = undefined;
      emit();
    });
}

export function useFramedJukebox() {
  return useSyncExternalStore(subscribe, () => framedJukebox, () => undefined);
}

export function useFramedDenJukebox() {
  return useSyncExternalStore(subscribe, () => framedDenJukebox, () => undefined);
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
    saveLocal(MUTED_KEY, JSON.stringify([...next]));
  } catch {
    // A private window: the mute lasts as long as this page does.
    mutedRaw = JSON.stringify([...next]);
    mutedSet = next;
  }
  for (const cb of [...mutedListeners]) cb();
}
