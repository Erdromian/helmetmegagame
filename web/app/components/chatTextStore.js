"use client";

import { useSyncExternalStore } from "react";
import { saveLocal } from "../../lib/localSave.js";

// How big chat's lines are drawn, per browser. The same shape as soundStore.js:
// one localStorage key, read through useSyncExternalStore, never an effect.
// ChatNext puts the value on its root as data-chat-text; chat.css sizes from it.
const KEY = "bascinet:chat-text";
export const CHAT_TEXT_SIZES = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];
const VALID = new Set(CHAT_TEXT_SIZES.map((s) => s.value));

const listeners = new Set();
let cached = null;

function scan() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return VALID.has(raw) ? raw : "normal";
  } catch {
    return "normal";
  }
}

function subscribe(callback) {
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
  if (cached === null) cached = scan();
  return cached;
}

export function useChatTextSize() {
  return useSyncExternalStore(subscribe, read, () => "normal");
}

export function setChatTextSize(value) {
  if (!VALID.has(value)) return;
  try {
    saveLocal(KEY, value);
  } catch {
    // Not remembered, but still applied for this page load.
  }
  cached = value;
  for (const listener of listeners) listener();
}
