"use client";

import { useCallback, useSyncExternalStore } from "react";
import { saveLocal } from "../../../../lib/localSave.js";

// WHICH BLOCKS OF THE PLAYER'S RIGHT COLUMN THIS BROWSER HAS SHUT (./ChatAside.js
// and PartyRack.js's `framed` mode). Every block starts OPEN; a player shuts the
// ones they do not need, and the column remembers across a reload.
//
// Things is not in here: it has its own store (../thingsOpenStore.js), because
// the old column draws it too and it predates this one.
//
// Built the same way as ./foldStore.js, for the same four reasons its header
// gives — useSyncExternalStore, a snapshot stable between writes, a `storage`
// listener, and the in-memory snapshot set from the write itself so a browser
// that refuses site data still folds (web/lib/__tests__/localStores.test.mjs).
// A store of its own rather than keys in foldStore's: that one prunes anything
// its column cannot draw on every write, which would throw these away.

const KEY = "chat:aside-folds";
const listeners = new Set();

// Null means "not parsed yet". The Set itself is the stable snapshot.
let cached = null;

function subscribe(callback) {
  // Another tab may have moved it since this one last looked.
  cached = null;
  listeners.add(callback);
  const onStorage = (event) => {
    if (event.key !== null && event.key !== KEY) return;
    cached = null;
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
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      cached = new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : []);
    } catch {
      // Unreadable, or hand-edited into nonsense. Everything opens.
      cached = new Set();
    }
  }
  return cached;
}

// The same empty Set every time: a new one per call is a fresh snapshot, and
// React re-renders forever.
const EMPTY = new Set();
function readServer() {
  return EMPTY;
}

function write(next) {
  cached = next;
  try {
    if (next.size === 0) window.localStorage.removeItem(KEY);
    else saveLocal(KEY, JSON.stringify([...next]));
  } catch {
    // Still folds this page load; it just forgets on reload.
  }
  for (const callback of listeners) callback();
}

// The shut set, and a toggle by block key.
export function useAsideFolds() {
  const shut = useSyncExternalStore(subscribe, read, readServer);
  const toggle = useCallback((key) => {
    const next = new Set(read());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(next);
  }, []);
  return [shut, toggle];
}
