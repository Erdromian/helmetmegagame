"use client";

import { useSyncExternalStore } from "react";

// Whether this BROWSER plays sound, and how loud. Same shape as ./seenStore.js and
// ./notifiedStore.js beside it: one localStorage key, read through useSyncExternalStore,
// never an effect writing state (react-hooks/set-state-in-effect is an error in this repo).
//
// Per browser rather than per character on purpose. Volume is a property of the room you
// are sitting in, not of the person you are playing — the same player wants it off at work
// and on at home, and a character row would follow them to both. It also means a spectator
// and a ghost, neither of whom has a character to hang a column on, get the same switch.
//
// A `storage` event fires in the OTHER tabs, so turning sound off in one tab quietens the
// rest. The snapshot is a STRING, not an object, because useSyncExternalStore compares by
// identity and a fresh object every read is an infinite render loop.

const KEY = "bascinet:sound";
const DEFAULT = { on: true, volume: 0.7 };

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
  // Another tab may have changed it since this one last looked.
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

function scan() {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    // A private window, or site data blocked. Sound stays on at the default volume;
    // it just will not be remembered.
    return "";
  }
}

function read() {
  if (cached === null) cached = scan();
  return cached;
}

const SERVER = "";

function readServer() {
  return SERVER;
}

let parsedFor = null;
let parsedValue = DEFAULT;

// The snapshot is `on|volume`. Anything unparseable reads as the default rather than as
// silence — a corrupt key should not be the reason nobody can hear the gate.
function parse(snapshot) {
  if (snapshot === parsedFor) return parsedValue;
  let value = DEFAULT;
  if (snapshot) {
    const [on, volume] = snapshot.split("|");
    const level = Number(volume);
    value = {
      on: on !== "0",
      volume: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : DEFAULT.volume,
    };
  }
  parsedFor = snapshot;
  parsedValue = value;
  return value;
}

function write(next) {
  try {
    window.localStorage.setItem(KEY, `${next.on ? 1 : 0}|${next.volume}`);
  } catch {
    // Unwritable storage is not a reason to refuse the change for this page load.
  }
  emit();
}

/** The current setting, outside React — what ./sfx.js asks before it plays anything. */
export function soundSetting() {
  if (typeof window === "undefined") return DEFAULT;
  return parse(read());
}

export function setSoundOn(on) {
  write({ ...soundSetting(), on: Boolean(on) });
}

export function setSoundVolume(volume) {
  const level = Number(volume);
  write({ ...soundSetting(), volume: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : DEFAULT.volume });
}

export function useSound() {
  return parse(useSyncExternalStore(subscribe, read, readServer));
}
