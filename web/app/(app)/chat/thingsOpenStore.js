"use client";

import { useCallback, useSyncExternalStore } from "react";

// WHETHER CHAT'S THINGS SECTION IS OPEN (ThingsDrawer.js), remembered by this
// browser.
//
// OPEN BY DEFAULT. It was shut by default, folded at the very foot of the
// right column, and players reported not finding what they could do with an
// item. A browser that has never touched it now sees it open; one that shut it
// on purpose ("0" under the same key) keeps it shut.
//
// It lived inside ThingsDrawer.js with the state ONLY in localStorage, which is
// the bug web/lib/__tests__/localStores.test.mjs exists for: a browser that
// refuses site data swallowed the write, the next read handed back the
// unchanged value, and the fold did nothing at all. The answer is foldStore's:
// the in-memory snapshot is set from the write itself, so refusing storage
// costs only the remembering. It is a CASE in that test now.

const KEY = "chat-things-open";
const listeners = new Set();

// Null means "not read yet"; otherwise the boolean is the snapshot.
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
      cached = window.localStorage.getItem(KEY) !== "0";
    } catch {
      // Unreadable: open, the default.
      cached = true;
    }
  }
  return cached;
}

// The server has no stored preference, so it renders the default.
function readServer() {
  return true;
}

function write(open) {
  cached = open;
  try {
    window.localStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    // Still moves this page load; it just forgets on reload.
  }
  for (const callback of listeners) callback();
}

export function useThingsOpen() {
  const open = useSyncExternalStore(subscribe, read, readServer);
  const toggle = useCallback(() => write(!read()), []);
  return [open, toggle];
}
