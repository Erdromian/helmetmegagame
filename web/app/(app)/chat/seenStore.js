"use client";

import { useSyncExternalStore } from "react";

// How far this reader has read in each place, per browser. localStorage via
// useSyncExternalStore, never in an effect (react-hooks/set-state-in-effect is an error here).
// The old name survives in the key: renaming it would forget every player's seen marks.
const PREFIX = "hall:seen:";
const listeners = new Set();

// THE MARKS THEMSELVES. localStorage BACKS this map rather than being it. A browser that
// refuses site data throws on setItem, and a store holding its state only in storage then
// answered the very next read with the UNCHANGED stored value — so the mark undid itself,
// silently, with no error to see. Same rule, and the same reason, as ./next/foldStore.js.
let marks = null;
// Latched the first time a write is refused: from then on memory is the only copy there
// is, so nothing may drop it and rescan an empty store.
let memoryOnly = false;
// The derived snapshot, rebuilt from `marks` — avoids walking every localStorage key on
// every render.
let cached = null;

function load() {
  if (marks) return marks;
  marks = new Map();
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      marks.set(key.slice(PREFIX.length), window.localStorage.getItem(key));
    }
  } catch {
    // Unreadable storage. Memory carries the session on its own.
  }
  return marks;
}

// A write landed in this tab: the derived string has to be rebuilt, but `marks` is already
// correct and must NOT be dropped — that is the whole point of the shape.
function changed() {
  cached = null;
  for (const cb of listeners) cb();
}

// Another tab may have moved a mark, so reload from storage. Skipped once storage is
// refusing us: there is no other tab writing, and memory is all there is.
function invalidate() {
  cached = null;
  if (!memoryOnly) marks = null;
}

function subscribe(callback) {
  // Another tab may have moved a mark since the last visit.
  invalidate();
  listeners.add(callback);
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

// One string for the whole map, so useSyncExternalStore's snapshot stays stable between renders.
function read() {
  if (cached === null) {
    const parts = [];
    for (const [placeKey, seq] of load()) parts.push(`${placeKey}=${seq}`);
    cached = parts.sort().join("|");
  }
  return cached;
}

function persist(placeKey, value) {
  try {
    window.localStorage.setItem(`${PREFIX}${placeKey}`, value);
  } catch {
    memoryOnly = true;
  }
}

// Forward only: a stale write must not re-mark a room as unread. An unparseable mark from
// an older build is overwritten rather than trusted.
function isNewer(seq, current) {
  if (!current) return true;
  try {
    return BigInt(seq) > BigInt(current);
  } catch {
    return true;
  }
}

function readServer() {
  return "";
}

// Memoised on the string, so the column's props hold still between changes.
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

export function markSeen(placeKey, seq) {
  if (!placeKey || !seq) return;
  const map = load();
  const value = String(seq);
  if (!isNewer(value, map.get(placeKey))) return;
  map.set(placeKey, value);
  persist(placeKey, value);
  // The storage event does not fire in the tab that wrote it.
  changed();
}

// The mark RIGHT NOW, outside the store — the NEW divider needs it a beat before markSeen moves it.
export function peekSeen(placeKey) {
  if (!placeKey) return null;
  return load().get(placeKey) ?? null;
}

// A first visit starts caught up (every place marked at what was newest on
// load) instead of lighting up every place at once — only on an empty slate.
export function seedSeenIfFresh(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  if (load().size > 0) return;
  markAllSeen(entries);
}

// Same write as seedSeenIfFresh without its empty-slate guard. FORWARD ONLY
// per place, same rule as markSeen; one notify at the end, not one per place.
export function markAllSeen(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const map = load();
  let wrote = false;
  for (const entry of entries) {
    if (!entry?.placeKey || !entry.seq) continue;
    const value = String(entry.seq);
    if (!isNewer(value, map.get(entry.placeKey))) continue;
    map.set(entry.placeKey, value);
    persist(entry.placeKey, value);
    wrote = true;
  }
  if (wrote) changed();
}

export function useSeen() {
  const snapshot = useSyncExternalStore(subscribe, read, readServer);
  return parse(snapshot);
}

// Compared as BigInt: a seq is a bigint column and "9" sorts after "10" as a string.
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
