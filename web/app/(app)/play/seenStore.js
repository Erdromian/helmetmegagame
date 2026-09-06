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
// thumbnail capture can throw on the accessor itself, and a Hall with no dots
// is still a Hall.

const PREFIX = "hall:seen:";
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(callback) {
  listeners.add(callback);
  // Another tab of the same character reading a room counts as read here too.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

// One string for the whole map, so useSyncExternalStore's snapshot is stable
// between renders — returning a fresh object every call is the classic way to
// make it loop forever.
function read() {
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

function readServer() {
  return "";
}

function parse(snapshot) {
  const map = new Map();
  if (!snapshot) return map;
  for (const part of snapshot.split("|")) {
    const at = part.lastIndexOf("=");
    if (at <= 0) continue;
    map.set(part.slice(0, at), part.slice(at + 1));
  }
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
