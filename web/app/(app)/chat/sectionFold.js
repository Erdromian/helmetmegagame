"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which sections of the places column this browser has folded shut.
//
// A Keep with eight rooms pushed Conversations below the fold, and the column
// has no other way to shorten itself — every section is as tall as the number
// of places in it. Folding one is a per-viewer convenience, so it lives in
// localStorage and is read through useSyncExternalStore, the way seenStore.js
// and asideTabStore.js do. Never in an effect: react-hooks/set-state-in-effect
// is an error in this repo.
//
// Stored as one comma-joined list of folded titles rather than a key each, so
// the snapshot is a single stable string and useSyncExternalStore has nothing
// to loop on. Reads and writes are wrapped — a private window or blocked site
// data can throw on the accessor itself, and a column with every section open
// is the correct fallback.

const KEY = "chat:folded-sections";
const listeners = new Set();
let cached = null;

function invalidate() {
  cached = null;
}

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

function subscribe(callback) {
  invalidate();
  listeners.add(callback);
  const onStorage = (event) => {
    if (event.key !== null && event.key !== KEY) return;
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function read() {
  if (cached === null) {
    try {
      cached = window.localStorage.getItem(KEY) ?? "";
    } catch {
      cached = "";
    }
  }
  return cached;
}

// Nothing folded on the server, so the first paint has every section open and
// the browser corrects it on hydration. Anything else is a mismatch.
function readServer() {
  return "";
}

/**
 * @param {string} title the section's own title, which is its id
 * @returns {[boolean, () => void]} whether it is folded, and a toggle
 */
export function useFolded(title) {
  const snapshot = useSyncExternalStore(subscribe, read, readServer);
  const folded = snapshot.split(",").includes(title);
  const toggle = useCallback(() => {
    let list;
    try {
      list = (window.localStorage.getItem(KEY) ?? "").split(",").filter(Boolean);
    } catch {
      list = [];
    }
    const next = list.includes(title) ? list.filter((t) => t !== title) : [...list, title];
    try {
      window.localStorage.setItem(KEY, next.join(","));
    } catch {
      // The column still folds for this render; it just forgets.
    }
    emit();
  }, [title]);
  return [folded, toggle];
}
