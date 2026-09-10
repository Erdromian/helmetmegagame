"use client";

import { useCallback, useSyncExternalStore } from "react";

// The conversation composer's draft. MEMORY is the source of truth and
// localStorage is a best-effort mirror — never the other way round.
//
// It used to be the other way round: the textarea's value was
// `localStorage.getItem()`, read through useSyncExternalStore. That is fine
// until a write fails. When the origin's quota is full `setItem` throws, and
// because the re-render nudge sat INSIDE the try, no re-render happened and
// the next one re-read the stale stored string — so a GM's typing froze
// mid-sentence and then reverted, in every conversation at once, with no
// error anywhere. A page cache filling the quota could stop a person typing.
//
// So the value lives in a module Map and is read through useSyncExternalStore
// over our own listeners. That keeps the property the old design was reaching
// for — no useState seeded from an effect, which is what
// react-hooks/set-state-in-effect exists to catch — without making input
// depend on storage succeeding. `useSessionState.js` already works this way;
// this is the same shape.
//
// The store is shared here rather than kept private to the pane because the
// inspector's Canon tab writes into it: "Insert into reply" used to be a ref
// handed down from PersonShell, which only worked while the dossier and the
// composer were siblings. The inspector is a column of the desk SHELL now, so
// the two are no longer in the same tree — the store is the wire instead.

const EMPTY = "";

// discordUserId -> draft string. The source of truth.
const drafts = new Map();
const listeners = new Set();

export function dmDraftKey(discordUserId) {
  return `messages-draft-${discordUserId}`;
}

function emit() {
  for (const callback of listeners) callback();
}

// Seeded from storage ONCE per conversation, then never read from storage
// again. A refusal memoises "" so a blocked accessor isn't retried on every
// render.
export function readDmDraft(discordUserId) {
  if (!discordUserId) return EMPTY;
  const held = drafts.get(discordUserId);
  if (held !== undefined) return held;
  let stored = EMPTY;
  try {
    stored = window.localStorage.getItem(dmDraftKey(discordUserId)) ?? EMPTY;
  } catch {
    /* private window / blocked site data */
  }
  drafts.set(discordUserId, stored);
  return stored;
}

// Notify FIRST, mirror second. A throwing setItem can no longer swallow the
// re-render, which is the whole bug this file exists to have fixed.
//
// No `storage` event is dispatched any more. Cross-tab draft sync was never a
// feature, nothing else reads `messages-draft-*`, and the old global dispatch
// woke every other storage subscriber on the desk — usePins re-parsed its JSON
// on each keystroke.
export function writeDmDraft(discordUserId, value) {
  if (!discordUserId) return;
  const next = value ?? EMPTY;
  drafts.set(discordUserId, next);
  emit();
  try {
    if (next) window.localStorage.setItem(dmDraftKey(discordUserId), next);
    else window.localStorage.removeItem(dmDraftKey(discordUserId));
  } catch {
    // Full, private, or blocked. The draft is safe in memory for this tab's
    // lifetime; only surviving a reload is lost.
  }
}

function subscribeDmDraft(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// The snapshot is a string, so useSyncExternalStore's identity check is
// satisfied by value equality — nothing to memoise.
export function useDmDraft(discordUserId) {
  const get = useCallback(() => readDmDraft(discordUserId), [discordUserId]);
  return useSyncExternalStore(subscribeDmDraft, get, () => EMPTY);
}
