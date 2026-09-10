"use client";

// The Move a player is part-way through typing, kept in this browser until
// they file it.
//
// A Move is the one thing a turn buys and a filed one is final, so the words
// leading up to it are worth more than most drafts — and until now Escape, a
// stray backdrop click or a closed laptop threw a paragraph away with nothing
// to get it back from. It is a per-viewer convenience about unsent text, so
// localStorage is the right home: it never needs to reach another device, and
// the server must not hold half a Move that was never filed.
//
// Keyed by character AND turn, so yesterday's abandoned draft never surfaces
// inside today's dialog and one browser signed into two characters never hands
// one of them the other's half-written day. Read in a useState initializer
// rather than an effect —
// react-hooks/set-state-in-effect is an error in this repo, and the dialog
// only ever mounts on a click, so there is no server render to mismatch.
//
// Every accessor is wrapped: a private window or blocked site data throws on
// the accessor itself, and an empty box is the correct fallback.

const PREFIX = "chat:move-draft:";

function keyFor(characterId, turnNumber) {
  if (characterId == null || turnNumber == null) return null;
  return `${PREFIX}${characterId}:${turnNumber}`;
}

export function readDraft(characterId, turnNumber) {
  const key = keyFor(characterId, turnNumber);
  if (!key) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(characterId, turnNumber, text) {
  const key = keyFor(characterId, turnNumber);
  if (!key) return;
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    // The box still holds the words for this session; it just forgets.
  }
}

// Called once the Move is actually filed. Also sweeps drafts left behind by
// earlier turns, so a browser that has played a month does not carry a month
// of dead paragraphs.
export function clearDraft() {
  try {
    const stale = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up that we can reach.
  }
}
