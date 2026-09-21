"use client";

import { useSyncExternalStore } from "react";

// The second of Chat's two levels (REDESIGN.md §6, Discord's shape):
//
//   UNREAD    something notable was said in a place you have not read to the
//             bottom of. The place's name brightens. No number. ./seenStore.js
//             owns this, and has always owned it.
//   NOTIFIED  something was said TO YOU: your name, a line in your Bascinet
//             mail, a DM. A red count, and a browser notification while the
//             tab is hidden. This file owns that.
//
// Kept apart on purpose. Unread is a watermark and answers itself — the newest
// notable seq against the mark. Notified is a COUNT of events, so it has to be
// accumulated as they arrive, and a watermark cannot say "three people said your
// name". SYSTEM scenery counts for neither.
//
// Per browser, in localStorage, read through useSyncExternalStore — never an
// effect writing state (react-hooks/set-state-in-effect is an error here). Same
// shape as ./seenStore.js, and deliberately the same shape: one string snapshot
// for the whole map, so the column's props hold still between changes.

const PREFIX = "bascinet:notified:";

const listeners = new Set();

// THE COUNTS THEMSELVES. localStorage BACKS this map rather than being it, for the reason
// ./seenStore.js and ./next/foldStore.js both give: a browser refusing site data throws on
// setItem, and a store holding its state only in storage then read the UNCHANGED value
// straight back, so the badge never moved and nothing said why.
let counts = null;
// Latched the first time a write is refused: memory is the only copy from then on.
let memoryOnly = false;
// The derived snapshot, rebuilt from `counts`.
let cached = null;

function load() {
  if (counts) return counts;
  counts = new Map();
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const count = Number(window.localStorage.getItem(key));
      if (Number.isFinite(count) && count > 0) counts.set(key.slice(PREFIX.length), count);
    }
  } catch {
    // Unreadable storage. Memory carries the session on its own.
  }
  return counts;
}

// A write landed in this tab: rebuild the string, keep the map.
function changed() {
  cached = null;
  for (const cb of listeners) cb();
}

// Another tab may have moved a count, so reload from storage — unless storage is refusing
// us, in which case there is no other tab to hear from.
function invalidate() {
  cached = null;
  if (!memoryOnly) counts = null;
}

function subscribe(callback) {
  // Another tab may have read a place, or been notified in one, since the last
  // visit.
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

function read() {
  if (cached === null) {
    const parts = [];
    for (const [placeKey, count] of load()) parts.push(`${placeKey}=${count}`);
    cached = parts.sort().join("|");
  }
  return cached;
}

function readServer() {
  return "";
}

let parsedFor = null;
let parsedMap = new Map();

function parse(snapshot) {
  if (snapshot === parsedFor) return parsedMap;
  const map = new Map();
  if (snapshot) {
    for (const part of snapshot.split("|")) {
      const at = part.lastIndexOf("=");
      if (at <= 0) continue;
      const count = Number(part.slice(at + 1));
      if (Number.isFinite(count) && count > 0) map.set(part.slice(0, at), count);
    }
  }
  parsedFor = snapshot;
  parsedMap = map;
  return map;
}

// Capped, because the number stops being information long before this. Discord
// draws the same cap.
export const NOTIFIED_CAP = 99;

function forget(placeKey) {
  try {
    window.localStorage.removeItem(`${PREFIX}${placeKey}`);
  } catch {
    memoryOnly = true;
  }
}

// Somebody said your name, or the game wrote to you. `notice` is what a browser
// notification would say — pass none and none is shown.
export function noteNotified(placeKey, notice = null) {
  if (!placeKey) return;
  const map = load();
  const next = Math.min(NOTIFIED_CAP, (map.get(placeKey) ?? 0) + 1);
  map.set(placeKey, next);
  try {
    window.localStorage.setItem(`${PREFIX}${placeKey}`, String(next));
  } catch {
    memoryOnly = true;
  }
  changed();
  if (notice) showNotification(placeKey, notice);
}

// The place was read. Discord clears the count the moment you look at the
// channel, and so does this — a count you have to dismiss is a second chore.
export function clearNotified(placeKey) {
  if (!placeKey) return;
  const map = load();
  if (!map.has(placeKey)) return;
  map.delete(placeKey);
  forget(placeKey);
  changed();
}

// The tick in the column's foot marks everywhere read, so it clears these too.
export function clearAllNotified() {
  const map = load();
  if (map.size === 0) return;
  const doomed = [...map.keys()];
  map.clear();
  for (const placeKey of doomed) forget(placeKey);
  changed();
}

// A notification only while the tab is HIDDEN. Onscreen, the count and the
// line itself have already said it twice over, and an OS banner over a page
// you are looking at is the thing everybody turns off.
//
// Permission is never ASKED for here. Web Push already asks, once, behind the
// bell in the places column (./pushStore.js), and a page that prompts on its own
// the first time somebody's name comes up is the pattern browsers added the
// permanent block for. Nothing is shown until that has been granted.
function showNotification(placeKey, notice) {
  try {
    if (typeof Notification === "undefined") return;
    if (document.visibilityState !== "hidden") return;
    if (Notification.permission !== "granted") return;
    // `tag` is the place, so a busy room replaces its own banner instead of
    // stacking eleven of them.
    const shown = new Notification(notice.title, { body: notice.body ?? "", tag: `chat:${placeKey}` });
    shown.onclick = () => {
      try {
        window.focus();
        window.location.hash = `#${encodeURIComponent(placeKey)}`;
        shown.close();
      } catch {
        // Nothing to do about a browser that refuses to come to the front.
      }
    };
  } catch {
    // A browser that refuses to construct one costs a banner, nothing more.
  }
}

export function useNotified() {
  return parse(useSyncExternalStore(subscribe, read, readServer));
}
