"use client";

import { useSyncExternalStore } from "react";

// Which place is open in Chat, per tab — the module store that replaced the
// URL hash as the source of truth (CHAT.md §5).
//
// The hash used to BE the truth: Chat.js read it through a hashchange
// listener and wrote it with `window.location.hash = …`. That write is a
// fragment navigation the Next app router never hears about (it has no
// hashchange listener, and its popstate handler ignores the null-state entry
// a fragment navigation makes), so the router's own idea of the URL stayed
// `/chat`. On its next state change — any router.refresh(), a revalidating
// action — the router wrote its URL back over the address bar with
// history.replaceState, the hash was gone, and Chat fell back to the first
// place in the list, which is always the street. That was the "jump".
//
// So the open place lives HERE now, and the URL only ever follows it:
//
//   - first read: the hash if the page was opened with one (a ⌘K entry, the
//     "Open" link on a mention, a push notification), otherwise the place
//     this browser last had open, otherwise nothing — and Chat.js falls back
//     to the street.
//   - hashchange still moves it, so an in-page `/chat#…` anchor keeps working.
//   - a service-worker message moves it, which is how a tapped notification
//     reaches a tab that is already on /chat without reloading it (sw.js).
//   - setOpenPlace() writes the store, remembers the place for next time, and
//     pushes the hash onto the URL through history.pushState — which Next
//     patches to keep its own URL in step, so the address bar stays right.
//
// Same shape as typingStore.js: module state, useSyncExternalStore, no
// provider. Nothing here is ever a setState in an effect.

const LAST_KEY = "bascinet:play:last-place";

let current = null;
let seeded = false;
const listeners = new Set();

function readHash() {
  try {
    const raw = window.location.hash.slice(1);
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}

function readLast() {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function remember(key) {
  try {
    window.localStorage.setItem(LAST_KEY, key);
  } catch {
    // A private window forgets. The hash still carries the place for a
    // reload within the session.
  }
}

// The hash is read on EVERY snapshot, not once. A `/chat#…` link followed by
// a client-side navigation (⌘K from another page) has its hash written by
// the router in the commit AFTER Chat's first render, and router.push never
// fires hashchange — so a hash that has appeared or changed since the last
// look is adopted here, the way the old hashchange listener would have taken
// it. A hash that is simply absent says nothing: the place this browser last
// had open stands, and on the very first read it is what fills the store.
function seed() {
  const fromHash = readHash();
  if (fromHash && fromHash !== current) {
    current = fromHash;
    remember(fromHash);
    seeded = true;
    return;
  }
  if (seeded) return;
  seeded = true;
  current = readLast();
}

function emit() {
  for (const cb of listeners) cb();
}

// Back and Forward, and an in-page `/chat#…` anchor. An EMPTY hash is Back
// to the entry the page was opened on: the room closes and Chat falls back to
// the street, the way it came — but the last place stays remembered, so a
// reload still comes back to it.
function onHashChange() {
  const key = readHash();
  if (key === (current ?? "") || (!key && current === null)) return;
  if (key) {
    current = key;
    remember(key);
  } else {
    current = null;
  }
  emit();
}

function onWorkerMessage(event) {
  const key = event?.data?.openPlace;
  if (typeof key !== "string" || !key) return;
  setOpenPlace(key);
}

// The window listeners are attached while anybody is subscribed and taken
// down with the last subscriber, so two Chats in one tab (there is only ever
// one, but a hot reload can briefly make two) do not fight over them.
function subscribe(cb) {
  if (listeners.size === 0) {
    window.addEventListener("hashchange", onHashChange);
    navigator.serviceWorker?.addEventListener?.("message", onWorkerMessage);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", onHashChange);
      navigator.serviceWorker?.removeEventListener?.("message", onWorkerMessage);
    }
  };
}

function getSnapshot() {
  seed();
  return current;
}

function getServerSnapshot() {
  return null;
}

export function useOpenPlace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Opens a place. The URL follows through history.pushState rather than a
// `location.hash =` write: Next patches pushState to update its own copy of
// the URL, so the hash survives the router's next state change instead of
// being written over by it. Back still works — every entry carries the
// router's state — and Back fires hashchange, which the listener above reads.
export function setOpenPlace(key) {
  if (!key || typeof key !== "string") return;
  seed();
  const changed = key !== current;
  current = key;
  remember(key);
  if (typeof window !== "undefined" && readHash() !== key) {
    try {
      window.history.pushState(null, "", `#${encodeURIComponent(key)}`);
    } catch {
      // A browser that refuses pushState still has the store; only the
      // address bar is a step behind.
    }
  }
  if (changed) emit();
}
