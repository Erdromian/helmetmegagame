"use client";

import { useSyncExternalStore } from "react";

// Whether this BROWSER plays sound, and how loud. Same shape as
// (app)/chat/seenStore.js and notifiedStore.js: one localStorage key, read through
// useSyncExternalStore, never an effect writing state (react-hooks/set-state-in-effect
// is an error in this repo).
//
// It lived in (app)/chat/ until the top bar grew a copy of the switch. It was never a
// chat thing — sfx.js has always read it from everywhere — so it moved out here.
//
// Per browser rather than per character on purpose. Volume is a property of the room you
// are sitting in, not of the person you are playing — the same player wants it off at work
// and on at home, and a character row would follow them to both. It also means a spectator
// and a ghost, neither of whom has a character to hang a column on, get the same switch.
//
// A `storage` event fires in the OTHER tabs, so turning sound off in one tab quietens the
// rest. The snapshot is a STRING, not an object, because useSyncExternalStore compares by
// identity and a fresh object every read is an infinite render loop.

// THE TWO SWITCHES ARE NOT SIBLINGS. `sfx` is the master: it silences the cues AND the
// music, because it is the speaker button and a speaker button that leaves a song playing
// is a broken speaker button. `music` silences only the music. So the music a player hears
// is `sfx && music` — see musicIsAudible() below — while the music BUTTON reads `music`
// alone, so somebody who is currently muted can still set what they want for later.
//
// That is deliberate, and it is exactly the shape somebody later tries to simplify into
// one flag. Don't.

// The slider only ever ATTENUATES. Every cue carries its own measured gain
// (web/app/components/sfx.js), so the levelling is done before this number is reached and
// full is the level the game was tuned at — a lower default would just mean the quietest
// files could never reach their tier. The music bus multiplies it in the same way.
const KEY = "bascinet:sound";
const DEFAULT = { sfx: true, music: true, volume: 1 };

const listeners = new Set();
let cached = null;
// Set the first time a write is refused. A browser that blocks site data leaves `cached` as
// the only copy of the setting there is, so nothing may drop it and re-read an empty store
// — the snapshot would come back unchanged, useSyncExternalStore would skip the render, and
// the switches would sit there doing nothing with no error to show for it.
let memoryOnly = false;

function invalidate() {
  if (!memoryOnly) cached = null;
}

function notify() {
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

function level(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT.volume;
}

// The snapshot is `sfx|music|volume`. Anything unparseable reads as the default rather
// than as silence — a corrupt key should not be the reason nobody can hear the gate.
//
// A TWO-field value is the older `on|volume` shape, from before there was music to switch
// off separately. It is read in place and music defaults on; there is no migration write,
// so a browser that never touches the controls keeps its old string forever and that is
// fine.
function parse(snapshot) {
  if (snapshot === parsedFor) return parsedValue;
  let value = DEFAULT;
  if (snapshot) {
    const parts = snapshot.split("|");
    value =
      parts.length < 3
        ? { sfx: parts[0] !== "0", music: true, volume: level(parts[1]) }
        : { sfx: parts[0] !== "0", music: parts[1] !== "0", volume: level(parts[2]) };
  }
  parsedFor = snapshot;
  parsedValue = value;
  return value;
}

function write(next) {
  const snapshot = `${next.sfx ? 1 : 0}|${next.music ? 1 : 0}|${next.volume}`;
  // The snapshot IS the state, so it is set before the store is tried rather than read back
  // out of it afterwards. Unwritable storage then costs only the remembering.
  cached = snapshot;
  try {
    window.localStorage.setItem(KEY, snapshot);
  } catch {
    memoryOnly = true;
  }
  notify();
}

/** The current setting, outside React — what ./sfx.js and ./music.js ask before playing. */
export function soundSetting() {
  if (typeof window === "undefined") return DEFAULT;
  return parse(read());
}

/** Is music allowed to make a noise right now? The speaker is master; see the header. */
export function musicIsAudible(setting = soundSetting()) {
  return setting.sfx && setting.music;
}

export function setSfxOn(on) {
  write({ ...soundSetting(), sfx: Boolean(on) });
}

export function setMusicOn(on) {
  write({ ...soundSetting(), music: Boolean(on) });
}

export function setSoundVolume(volume) {
  write({ ...soundSetting(), volume: level(volume) });
}

export function useSound() {
  return parse(useSyncExternalStore(subscribe, read, readServer));
}
