"use client";

import { useSyncExternalStore } from "react";

// How far this reader has read in each place, per browser.
//
// The unread dot in the places column is one comparison: the newest seq said
// in a place against the newest seq this browser has seen there. The second
// half is a per-viewer convenience and belongs in localStorage, read through
// useSyncExternalStore the way useChimeMuted.js does — never in an effect,
// which react-hooks/set-state-in-effect makes an error here anyway.
//
// Every read and write is wrapped: a private window, blocked site data or a
// thumbnail capture can throw on the accessor itself, and a Chat with no dots
// is still a Chat.

// The old name survives in the key on purpose: renaming it would forget
// every player's seen marks. A stored key is matched on, not read.
const PREFIX = "hall:seen:";
const listeners = new Set();

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

// The snapshot is CACHED, and the cache is thrown away only when the marks
// can have moved: a write from this tab (emit) or from another one (the
// storage event). Rebuilding it meant walking every key in localStorage —
// the page snapshots, the theme, everything — and that walk was the snapshot
// read useSyncExternalStore made on every render of Chat, which is to say on
// every row that landed anywhere and every scroll tick at the bottom of a
// room. Now it is walked once per change.
let cached = null;

function invalidate() {
  cached = null;
}

function subscribe(callback) {
  // Another tab may have moved a mark while nothing here was listening —
  // between one visit to Chat and the next — so a new subscriber starts from
  // a fresh read.
  invalidate();
  listeners.add(callback);
  // Another tab of the same character reading a room counts as read here too.
  const onStorage = () => {
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function scan() {
  const parts = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      parts.push(`${key.slice(PREFIX.length)}=${window.localStorage.getItem(key)}`);
    }
  } catch {
    return "";
  }
  return parts.sort().join("|");
}

// One string for the whole map, so useSyncExternalStore's snapshot is stable
// between renders — returning a fresh object every call is the classic way to
// make it loop forever.
function read() {
  if (cached === null) cached = scan();
  return cached;
}

function readServer() {
  return "";
}

// Memoised on the string: the Map is the same object for as long as the
// snapshot is, so the column's props hold still between changes.
let parsedFor = null;
let parsedMap = new Map();

function parse(snapshot) {
  if (snapshot === parsedFor) return parsedMap;
  const map = new Map();
  if (snapshot) {
    for (const part of snapshot.split("|")) {
      const at = part.lastIndexOf("=");
      if (at <= 0) continue;
      map.set(part.slice(0, at), part.slice(at + 1));
    }
  }
  parsedFor = snapshot;
  parsedMap = map;
  return map;
}

// Only ever moves forward: a stale write from a tab scrolled up must not
// re-mark a room as unread for the tab that just read it.
export function markSeen(placeKey, seq) {
  if (!placeKey || !seq) return;
  try {
    const current = window.localStorage.getItem(`${PREFIX}${placeKey}`);
    if (current && BigInt(current) >= BigInt(seq)) return;
    window.localStorage.setItem(`${PREFIX}${placeKey}`, String(seq));
  } catch {
    return;
  }
  // The storage event does not fire in the tab that wrote it.
  emit();
}

// The mark as it stands RIGHT NOW, outside the store. The NEW divider needs
// the value a place had at the moment it was opened, and it captures it in
// the same breath the place is opened in — a beat before markSeen moves it.
export function peekSeen(placeKey) {
  if (!placeKey) return null;
  try {
    return window.localStorage.getItem(`${PREFIX}${placeKey}`);
  } catch {
    return null;
  }
}

// A browser that has never opened Chat has no marks at all, and every
// place it can hear would otherwise light up its dot on the first paint —
// telling a new player that a week of somebody else's conversation is theirs
// to catch up on. So a first visit starts caught up: every place is marked at
// what was newest when the page loaded. Only ever on a genuinely empty slate;
// one mark anywhere means this browser has been here.
export function seedSeenIfFresh(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      if (window.localStorage.key(i)?.startsWith(PREFIX)) return;
    }
    for (const entry of entries) {
      if (!entry?.placeKey || !entry.seq) continue;
      window.localStorage.setItem(`${PREFIX}${entry.placeKey}`, String(entry.seq));
    }
  } catch {
    return;
  }
  emit();
}

export function useSeen() {
  const snapshot = useSyncExternalStore(subscribe, read, readServer);
  return parse(snapshot);
}

// True when a place holds something this browser has not seen. Both sides are
// compared as BigInt: a seq is a bigint column and "9" sorts after "10" as a
// string.
export function isUnread(seen, placeKey, newest) {
  if (!newest) return false;
  const mark = seen.get(placeKey);
  if (!mark) return true;
  try {
    return BigInt(newest) > BigInt(mark);
  } catch {
    return false;
  }
}
