"use client";

import { useCallback, useSyncExternalStore } from "react";

// The live inbox's client store — what LiveInboxPoller.js fills, and what
// the rail and conversation pane read. Module-level state read through
// useSyncExternalStore, so nothing needs a provider.
//
// patches: per conversation, rail fields that moved, stamped with the DB
// clock read time; the rail applies a patch (mergeRailRows) only when newer
// than its row. feeds: per conversation, message rows arrived since load.
//
// Every rebuild makes a new Map/array — react-hooks/immutability is an error.

const EMPTY_PATCHES = new Map();
const EMPTY_READ_OVERRIDES = new Map();
const EMPTY_FEED = Object.freeze([]);
const SEEN_CAP = 2000;

// How long a read override is allowed to stand before it is dropped on age
// alone. It normally clears the moment the server echoes a cursor at or past
// it; this only catches the case where that echo never comes (the row stopped
// being touched at all), so it is generous rather than tight.
const READ_OVERRIDE_MAX_AGE_MS = 5 * 60_000;

const state = {
  patches: EMPTY_PATCHES,
  feeds: new Map(),
  cursorMs: 0,
  seen: new Set(),
  // discordUserId -> { cursorMs, atMs }. "This GM has read this conversation
  // up to cursorMs", known here before any server row says so.
  readOverrides: new Map(),
};
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCursorMs() {
  return state.cursorMs;
}

function getPatches() {
  return state.patches;
}
function getReadOverrides() {
  return state.readOverrides;
}
function getServerReadOverrides() {
  return EMPTY_READ_OVERRIDES;
}
function getServerPatches() {
  return EMPTY_PATCHES;
}
function getServerFeed() {
  return EMPTY_FEED;
}

function messageTime(m) {
  return new Date(m.createdAt).getTime();
}

function byTimeThenId(a, b) {
  const d = messageTime(a) - messageTime(b);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Folds one poll result in. `sinceMs` is the cursor the request was made
// with (0 on the first tick), and `announce` says whether anything found is
// news — the first tick looks back two minutes at things that were already
// there when the GM arrived, and those must not ring. Returns the INBOUND
// arrivals worth announcing (an id plus the conversation), which is what
// decides whether to chime.
export function applyDelta(delta, { sinceMs = 0, announce = true } = {}) {
  let changed = false;
  const inbound = [];

  if (Number.isFinite(delta?.cursorMs)) state.cursorMs = delta.cursorMs;

  if (Array.isArray(delta?.rail) && delta.rail.length > 0) {
    const next = new Map(state.patches);
    for (const patch of delta.rail) {
      if (!patch?.discordUserId) continue;
      // Older than what is already held, so it has nothing to say. Two paths
      // feed this store — the stream and a 30s full=1 backstop — and the
      // backstop's answer is built from a read that can predate a frame the
      // stream has already delivered. Setting unconditionally is how a row
      // that had just gone to zero unread came back saying 3.
      const prev = next.get(patch.discordUserId);
      if (prev && prev.asOfMs > delta.nowMs) continue;
      next.set(patch.discordUserId, { ...patch, asOfMs: delta.nowMs });
    }
    state.patches = next;
    changed = true;
  }

  // Two shapes arrive here, and both are folded the same way. `thread`
  // (singular) is the backstop poll's, which asks about one conversation —
  // whichever is open. `threads` (plural) is the stream's: it carries rows for
  // EVERY conversation that moved, because the stream no longer takes an
  // "open" parameter (see api/gm/inbox-stream). Folding both through one
  // function is what keeps the two paths from drifting.
  const thread = delta?.thread;
  const threadList = [
    ...(thread?.discordUserId ? [thread] : []),
    ...(Array.isArray(delta?.threads) ? delta.threads : []),
  ];
  const openThreadIds = new Set(threadList.map((t) => t.discordUserId));

  for (const t of threadList) {
    if (!t?.discordUserId || !Array.isArray(t.messages) || t.messages.length === 0) continue;
    const fresh = t.messages.filter((m) => m?.id && !state.seen.has(m.id));
    if (fresh.length === 0) continue;
    for (const m of fresh) {
      state.seen.add(m.id);
      if (announce && m.direction === "INBOUND") {
        inbound.push({ id: m.id, discordUserId: t.discordUserId });
      }
    }
    const current = state.feeds.get(t.discordUserId) ?? EMPTY_FEED;
    const merged = Object.freeze([...current, ...fresh].sort(byTimeThenId));
    const feeds = new Map(state.feeds);
    feeds.set(t.discordUserId, merged);
    state.feeds = feeds;
    changed = true;
  }

  // Inbound rows on conversations that are NOT open never reach `feeds` (the
  // server only ships the open thread), so the chime hears about them from
  // the rail patch instead. A conversation can be in the patch set for other
  // reasons too (its read cursor moved), so "inbound" alone isn't news —
  // only an inbound last message newer than the cursor we asked with is.
  if (announce && Array.isArray(delta?.rail)) {
    for (const patch of delta.rail) {
      if (patch?.lastDirection !== "INBOUND") continue;
      // Already announced above, as a row rather than as a rail patch.
      if (openThreadIds.has(patch.discordUserId)) continue;
      if (!(patch.lastAtMs > sinceMs)) continue;
      const key = `rail:${patch.discordUserId}:${patch.lastAtMs}`;
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      inbound.push({ id: key, discordUserId: patch.discordUserId });
    }
  }

  if (state.seen.size > SEEN_CAP) {
    state.seen = new Set([...state.seen].slice(-SEEN_CAP));
  }

  if (changed) emit();
  return { inbound };
}

// The GM has read this conversation, said here before the server has been
// told — or before it has answered. mergeRailRows lays it over the row as a
// last step, so the badge clears on the click rather than on the next frame.
export function noteConversationRead(discordUserId, cursorMs) {
  if (!discordUserId || !Number.isFinite(cursorMs)) return;
  const prev = state.readOverrides.get(discordUserId);
  if (prev && prev.cursorMs >= cursorMs) return;
  const next = new Map(state.readOverrides);
  next.set(discordUserId, { cursorMs, atMs: Date.now() });
  state.readOverrides = next;
  emit();
}

// Drops an override once the server's own rows have caught up to it, or once
// it is simply old. Called from an effect, never during render: it changes
// store state, and mergeRailRows has to stay a pure function of its arguments
// (it has two useMemo callers).
export function reconcileReadOverrides(rows, rowsAsOfMs) {
  if (state.readOverrides.size === 0) return;
  const cutoff = Date.now() - READ_OVERRIDE_MAX_AGE_MS;
  let next = null;
  for (const [id, override] of state.readOverrides) {
    const row = rows.find((r) => r.discordUserId === id);
    const echoed = row && rowsAsOfMs > override.atMs && (row.lastReadAtMs ?? 0) >= override.cursorMs;
    if (!echoed && override.atMs > cutoff) continue;
    next = next ?? new Map(state.readOverrides);
    next.delete(id);
  }
  if (!next) return;
  state.readOverrides = next;
  emit();
}

export function useReadOverrides() {
  return useSyncExternalStore(subscribe, getReadOverrides, getServerReadOverrides);
}

export function useRailPatches() {
  return useSyncExternalStore(subscribe, getPatches, getServerPatches);
}

export function useThreadFeed(discordUserId) {
  const snap = useCallback(() => state.feeds.get(discordUserId) ?? EMPTY_FEED, [discordUserId]);
  return useSyncExternalStore(subscribe, snap, getServerFeed);
}

// Lays the live patches over the layout's rows. A patch applies as a whole or
// not at all — its fields came from one consistent read, and mixing half of
// it with half a row could say "handled" against a newer message. A patch
// for someone the rail has never seen (a guild member with no character who
// just wrote for the first time) carries a whole `row` to append.
export function mergeRailRows(rows, patches, rowsAsOfMs, readOverrides = EMPTY_READ_OVERRIDES) {
  if ((!patches || patches.size === 0) && readOverrides.size === 0) return rows;
  // A read override is applied PER FIELD, after the whole-row patch above,
  // and it touches one field only: the unread count. It is not part of the
  // patch's "all or nothing" rule, because it did not come from the server's
  // read at all — it is what this GM did a moment ago. lastDirection stays
  // alone on purpose: having read somebody does not make it your turn to
  // have written last.
  const applyRead = (row) => {
    const o = readOverrides.get(row.discordUserId);
    if (!o || !(o.cursorMs > (row.lastReadAtMs ?? 0))) return row;
    return { ...row, unreadCount: 0, lastReadAtMs: o.cursorMs };
  };
  const known = new Set();
  const merged = rows.map((r) => {
    known.add(r.discordUserId);
    const p = patches?.get(r.discordUserId);
    if (!p || !(p.asOfMs > rowsAsOfMs)) return applyRead(r);
    const { asOfMs: _asOf, row: _row, ...fields } = p;
    void _asOf;
    void _row;
    return applyRead({ ...r, ...fields });
  });
  for (const [id, p] of patches ?? EMPTY_PATCHES) {
    if (known.has(id) || !(p.asOfMs > rowsAsOfMs) || !p.row) continue;
    const { asOfMs: _asOf, row, ...fields } = p;
    void _asOf;
    merged.push(applyRead({ ...row, ...fields }));
  }
  return merged;
}
