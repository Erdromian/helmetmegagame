"use client";

import { useSyncExternalStore } from "react";
import { setPhoneTones } from "./sfx";

// The telephone near this character (docs/systemdocs/PHONES.md §8): whether a phone rings
// here or one Location over, and the handset in their own hand. A module store, the shape
// performanceStore.js uses.
//
// Three sources:
//   - the feed stream's `phones` frame (chat/useFeedStream.js), the truth, which REPLACES;
//   - an action's own answer (PhoneDialog in chat/PlacePanel.js), noted at once so the
//     dialog does not wait on the stream to say what the button just did;
//   - `dialling`, the few seconds between pressing Dial and the exchange answering, when
//     the caller hears the long tone before any row or frame exists.
//
// Every change re-derives the held tones and hands them to sfx.js#setPhoneTones, which
// keeps a tone playing rather than restarting it when nothing about it changed.

const EMPTY = Object.freeze({ ring: null, handset: null });

let frame = EMPTY;
let dialling = false;
const listeners = new Set();

function emit() {
  const handset = frame.handset;
  setPhoneTones({
    ring: frame.ring === "near" ? "phone-ring" : frame.ring === "far" ? "phone-ring-far" : null,
    handset:
      dialling || handset?.state === "calling" ? "phone-calling" : handset?.state === "dead" ? "phone-busy" : null,
  });
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The feed's `phones` frame: `{ ring, handset }`. */
export function setPhoneFrame(next) {
  frame = next && typeof next === "object" ? Object.freeze({ ring: next.ring ?? null, handset: next.handset ?? null }) : EMPTY;
  emit();
}

/** An action's answer about the handset — the frame that says so follows a moment later. */
export function noteHandset(handset) {
  frame = Object.freeze({ ...frame, handset: handset ?? null });
  emit();
}

/** The long tone while a dial is waiting on the exchange. */
export function setDialling(on) {
  if (dialling === Boolean(on)) return;
  dialling = Boolean(on);
  emit();
}

/** Leaving /chat: nothing rings in a tab that is not listening for the frame. */
export function clearPhones() {
  frame = EMPTY;
  dialling = false;
  emit();
}

export function usePhoneFrame() {
  return useSyncExternalStore(subscribe, () => frame, () => EMPTY);
}
