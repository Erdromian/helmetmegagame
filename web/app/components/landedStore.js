import { useSyncExternalStore } from "react";

// How many actions have landed on this page — a dialog closing on success, or
// an instant verb (Mine, Recover, a Bind from someone's row) coming back ok. A
// panel that shows something an action can change — chat's room Storage strip,
// the Things drawer — re-reads when this moves.
//
// A module-level count rather than a field on RequestActionsProvider's context,
// because a page can hold more than one provider: chat's Actions menu mounts a
// second one over the sheet's pools (chat/next/ChatActions.js), and a Craft or
// an Eat run from there has to reach the Storage strip that reads the first.
// Every provider bumps this one number, so it does not matter which ran it.
//
// Only ever goes up. A panel compares it against the value it last saw; the
// number itself means nothing.
let landed = 0;
const listeners = new Set();

export function bumpLanded() {
  landed += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => landed;
const readOnServer = () => 0;

export function useLanded() {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
