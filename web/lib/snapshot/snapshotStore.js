"use client";

import { useSyncExternalStore } from "react";
import { SNAPSHOT_PREFIX, dropStoredSnapshots } from "../localSave.js";

// A page's last-known data, kept in the browser to paint at once on the next visit and refresh
// underneath. Not a cache the server honours or a source of truth — every server action
// re-validates from the database (CLAUDE.md, "A server action is a public endpoint"), so acting
// on a stale sheet is safe. Mirrored to localStorage (docs/systemdocs/CHAT.md §5c).
// Bump VERSION whenever a page's snapshot shape changes, so an old snapshot is ignored rather
// than handed to a renderer that expects the new shape — this changes the storage key prefix,
// orphaning every stored snapshot everywhere at once. The orphans are dropped on the next write
// (makeRoom below), so a bump no longer leaves them sitting in storage.
const VERSION = 2;
const PREFIX = `${SNAPSHOT_PREFIX}${VERSION}:`;

// localStorage is ~5MB per origin. One page may not eat most of it.
const MAX_BYTES_PER_SCOPE = 1_500_000;

const memory = new Map();
const listeners = new Set();

function keyFor(scope, userId) {
  return `${PREFIX}${userId}:${scope}`;
}

function emit() {
  for (const cb of listeners) cb();
}

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// SnapshotFresh hands the view the same round-tripped shape, so the view sees ONE shape either way.
function replacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function roundTrip(data) {
  return JSON.parse(JSON.stringify(data, replacer));
}

// The same read the hook does, outside React. Chat's row cache restores in a
// state initializer rather than from a hook — it writes into a module store, so
// subscribing to it would only cost a render (./chat/rowCache.js).
export function peekSnapshot(scope, userId) {
  return readSnapshot(scope, userId);
}

function readSnapshot(scope, userId) {
  if (!userId) return null;
  const key = keyFor(scope, userId);
  if (memory.has(key)) return memory.get(key);
  const store = storage();
  if (!store) return null;
  let parsed = null;
  try {
    const raw = store.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  memory.set(key, parsed);
  return parsed;
}

export function writeSnapshot(scope, userId, data) {
  if (!userId) return;
  const key = keyFor(scope, userId);
  memory.set(key, data);
  emit();
  const store = storage();
  if (!store) return;
  try {
    const raw = JSON.stringify(data, replacer);
    if (raw.length > MAX_BYTES_PER_SCOPE) {
      store.removeItem(key);
      forget(store, key);
      return;
    }
    makeRoom(store, key, raw.length);
    try {
      store.setItem(key, raw);
    } catch {
      // Full of something that is not ours. Every other snapshot goes before this one gives up.
      evictAllBut(store, key);
      store.setItem(key, raw);
    }
    remember(store, key, raw.length);
  } catch {
    // page still works, just paints from the server next time
  }
}

// WHAT IS STORED, AND WHEN. Snapshots used to pile up for good: one key per audit entry and
// per Dev Panel character ever opened, and every key an older VERSION left behind, until
// localStorage was full and every read mark and sound setting after that failed to save
// (../localSave.js). So they share a budget now, and the oldest go first. The index is one
// small key, `{ key: [writtenAtMs, length] }`, so keeping to the budget never has to read the
// big values back to size them. Two tabs racing it can lose an entry; a key the index does not
// know is dropped the next time room is made, which costs one page a skeleton and nothing else.
const INDEX_KEY = `${SNAPSHOT_PREFIX}index`;

// About half of what a browser gives a site, so a full budget still leaves the other half for
// everything that remembers a setting.
const BUDGET = 2_500_000;

function readIndex(store) {
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(store, index) {
  try {
    store.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // An index that did not save forgets some ages; the next makeRoom drops what it cannot place.
  }
}

function storedSnapshotKeys(store) {
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(SNAPSHOT_PREFIX) && key !== INDEX_KEY) keys.push(key);
  }
  return keys;
}

// Drops the oldest snapshots until `incoming` more characters fit the budget. `key` itself is
// about to be overwritten, so its old size does not count against it.
function makeRoom(store, key, incoming) {
  const index = readIndex(store);
  const kept = {};
  const known = [];
  for (const stored of storedSnapshotKeys(store)) {
    if (stored === key) continue;
    const entry = index[stored];
    // An older version's key, or one written before the index existed: drop it.
    if (!stored.startsWith(PREFIX) || !Array.isArray(entry)) {
      store.removeItem(stored);
      continue;
    }
    known.push([stored, Number(entry[0]) || 0, Number(entry[1]) || 0]);
  }
  known.sort((a, b) => b[1] - a[1]);
  let total = incoming;
  for (const [stored, at, length] of known) {
    if (total + length <= BUDGET) {
      total += length;
      kept[stored] = [at, length];
    } else {
      store.removeItem(stored);
    }
  }
  if (Array.isArray(index[key])) kept[key] = index[key];
  writeIndex(store, kept);
}

function evictAllBut(store, key) {
  for (const stored of storedSnapshotKeys(store)) if (stored !== key) store.removeItem(stored);
  const index = readIndex(store);
  writeIndex(store, Array.isArray(index[key]) ? { [key]: index[key] } : {});
}

// Strictly increasing, so two writes in one millisecond still have an order to evict in.
let lastStamp = 0;

function remember(store, key, length) {
  const index = readIndex(store);
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  index[key] = [lastStamp, length];
  writeIndex(store, index);
}

function forget(store, key) {
  const index = readIndex(store);
  if (!(key in index)) return;
  delete index[key];
  writeIndex(store, index);
}

// Called on sign-out so a shared browser never shows the next person the last person's sheet.
export function clearSnapshots() {
  const store = storage();
  if (!store) return;
  try {
    dropStoredSnapshots(store);
  } catch {
  }
  memory.clear();
  emit();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Never an effect writing state (react-hooks/set-state-in-effect).
export function useSnapshot(scope, userId) {
  return useSyncExternalStore(
    subscribe,
    () => readSnapshot(scope, userId),
    () => null,
  );
}
