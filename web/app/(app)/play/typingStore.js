"use client";

import { useSyncExternalStore } from "react";

// Who is writing something, per place. The same module-level-store-read-
// through-useSyncExternalStore shape as feedStore.js and seenStore.js.
//
// Nothing here is durable and nothing here is a row: a typing event is a fact
// about the next six seconds. The server never sends one for the viewer's own
// character (web/app/api/feed/route.js), so this store holds other people
// only, and it holds the PRESENTED name the hub resolved — a concealed
// character types under their alias, the way they speak under it.

// How long one event keeps somebody on the line. Discord re-raises its own
// typing event about every ten seconds while a person keeps typing, and the
// web composer's throttle is four, so six is long enough to bridge a web
// typist's gap and short enough that somebody who wandered off mid-sentence
// stops being announced.
const LIVE_MS = 6000;

const EMPTY = Object.freeze([]);

// placeKey -> Map<characterId, { name, at }>
const state = { byPlace: new Map(), views: new Map() };
const listeners = new Set();
let sweeper = null;

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Rebuilds one place's frozen name list. Sorted by when each person was last
// heard from, so a line naming two people does not reshuffle them on every
// keystroke.
function rebuild(placeKey) {
  const live = state.byPlace.get(placeKey);
  const names = live
    ? [...live.values()].sort((a, b) => a.at - b.at).map((entry) => entry.name)
    : [];
  state.views = new Map(state.views);
  state.views.set(placeKey, names.length === 0 ? EMPTY : Object.freeze(names));
}

// Drops everybody whose last event has aged out, and stops itself once nobody
// anywhere is typing — an interval that ran forever on an idle page would be
// the one thing on this screen keeping a phone's radio awake.
function sweep() {
  const now = Date.now();
  let changed = false;
  for (const [placeKey, live] of state.byPlace) {
    let dropped = false;
    for (const [characterId, entry] of live) {
      if (now - entry.at < LIVE_MS) continue;
      live.delete(characterId);
      dropped = true;
    }
    if (!dropped) continue;
    if (live.size === 0) state.byPlace.delete(placeKey);
    rebuild(placeKey);
    changed = true;
  }
  if (state.byPlace.size === 0 && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  if (changed) emit();
}

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(sweep, 1000);
  sweeper.unref?.();
}

export function noteTyping({ placeKey, characterId, name }) {
  if (!placeKey || !characterId || !name) return;
  let live = state.byPlace.get(placeKey);
  if (!live) {
    live = new Map();
    state.byPlace.set(placeKey, live);
  }
  live.set(characterId, { name, at: Date.now() });
  rebuild(placeKey);
  startSweeper();
  emit();
}

function getNames(placeKey) {
  return state.views.get(placeKey) ?? EMPTY;
}

function getServerNames() {
  return EMPTY;
}

export function useTyping(placeKey) {
  return useSyncExternalStore(
    subscribe,
    () => (placeKey ? getNames(placeKey) : EMPTY),
    getServerNames,
  );
}

// The sentence itself, so the Hall and anything that embeds it read the same.
// Three people is where naming them stops helping and starts being a list.
export function typingLine(names) {
  if (!names || names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing… ‡`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing… ‡`;
  return "Several people are typing… ‡";
}
