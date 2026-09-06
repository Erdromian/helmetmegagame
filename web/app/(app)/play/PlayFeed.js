"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import MarkdownContent from "@/app/components/MarkdownContent";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import {
  useFeed,
  seedRows,
  applyRow,
  removeRow,
  addPending,
  markPendingFailed,
  retryPending,
  lastSeq,
} from "./feedStore";

// The live scene: the messages said in this Location, and the box to say one.
//
// Nothing here waits on a server round trip to move. Pressing Enter appends
// the row to the store in the same frame and clears the box; the POST that
// follows only swaps the confirmed row in behind it. That is the whole reason
// this page is not a server action and a revalidatePath — see the plan's
// "Why the past web UIs felt slow".

// A run is one speaker's messages within seven minutes of each other, drawn
// as one block with a single face. The rule is copied from DmThread.js rather
// than imported: that component is a GM's DM conversation, a different shape
// with a different row type, and sharing the constant would tie them together
// for no gain.
const RUN_GAP_MS = 7 * 60_000;
// How close to the bottom still counts as "reading the newest", in px.
const STICK_PX = 40;
// The same five minutes db/lib/say.js#EDIT_WINDOW_MS enforces. Kept here as a
// number rather than imported, because importing from @lifeweb/db in a
// "use client" file drags Prisma and node:fs into the browser bundle. The
// server is the one that decides; this only decides whether to draw a button.
const EDIT_WINDOW_MS = 5 * 60_000;

function timeLabel(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// memo'd, and the whole point of keying the store by seq: a new message
// re-renders one of these, not the run of a hundred above it.
const FeedRow = memo(function FeedRow({ row, startsRun, mine, editing, coarse, onRetry, onEdit, onCancelEdit, onSaveEdit, onDelete }) {
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(row.content ?? "");

  // Always reachable on a touch screen, where there is no hover to reveal
  // them; out of the way of a mouse until it is over the row.
  const showActions = mine && !editing && (coarse || hover);

  return (
    <li
      className="flex gap-3"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        marginTop: startsRun ? "var(--sp-3)" : "var(--sp-1)",
        // No hex anywhere — a pending row is the same row, quieter.
        opacity: row.pending ? 0.6 : 1,
      }}
    >
      <div style={{ width: 32, flexShrink: 0 }}>
        {startsRun && (
          <CharacterAvatar characterId={row.characterId} name={row.name ?? ""} version={row.avatarVersion} size={32} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {startsRun && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{row.name}</span>
            <span className="mono text-xs" style={{ color: "var(--muted)" }}>
              {timeLabel(row.sentAt)}
            </span>
            {row.editedAt && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                (edited) ‡
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div className="field">
            <textarea
              rows={2}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit();
                  return;
                }
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                onSaveEdit(row.seq, draft);
              }}
            />
            <div className="flex gap-2">
              <button type="button" className="btn-quiet" onClick={() => onSaveEdit(row.seq, draft)}>
                Save ‡
              </button>
              <button type="button" className="btn-quiet" onClick={onCancelEdit}>
                Cancel ‡
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <MarkdownContent content={row.content} />
            </div>
            {showActions && (
              <div className="flex gap-1" style={{ flexShrink: 0 }}>
                <button type="button" className="btn-quiet" title="Change it ‡" onClick={() => onEdit(row.seq, row.sentAt)}>
                  ✎
                </button>
                <button type="button" className="btn-quiet" title="Take it back ‡" onClick={() => onDelete(row.seq, row.sentAt)}>
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {row.failed && (
          <button type="button" className="btn-quiet" onClick={() => onRetry(row.clientId)}>
            Not sent. Retry ‡
          </button>
        )}
      </div>
    </li>
  );
});

function newClientId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function PlayFeed({ place, placeName, initialRows, self }) {
  const rows = useFeed(place);
  const coarse = useIsCoarsePointer();
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [editingSeq, setEditingSeq] = useState(null);

  const scrollerRef = useRef(null);
  // Read inside the scroll handler and the arrival effect, where a stale
  // closure would stick the view to the wrong end of the list.
  const atBottomRef = useRef(true);

  // The server-rendered rows go in before the stream opens, so the cursor the
  // EventSource asks with is already past them and nothing arrives twice.
  useEffect(() => {
    seedRows(place, initialRows);
    const url = `/api/feed?place=${encodeURIComponent(place)}&since=${encodeURIComponent(lastSeq(place))}`;
    const source = new EventSource(url);
    source.addEventListener("message", (event) => {
      try {
        applyRow(place, JSON.parse(event.data));
      } catch {
        // A malformed frame is not worth tearing the stream down over.
      }
    });
    // A delete carries only a seq: the words somebody took back never come
    // back down the wire.
    source.addEventListener("delete", (event) => {
      try {
        removeRow(place, JSON.parse(event.data)?.seq);
      } catch {
        // Same.
      }
    });
    // EventSource reconnects by itself; the store's cursor means the catch-up
    // it does on reconnect repeats nothing.
    return () => source.close();
  }, [place, initialRows]);

  const send = useCallback(
    async (clientId, content) => {
      try {
        const res = await fetch("/api/feed/say", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place, content, clientId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't send. ‡");
          markPendingFailed(place, clientId);
          return;
        }
        setError(null);
        if (data?.row) applyRow(place, data.row);
      } catch {
        setError("That didn't send. ‡");
        markPendingFailed(place, clientId);
      }
    },
    [place],
  );

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    const clientId = newClientId();
    setDraft("");
    setError(null);
    addPending(place, {
      clientId,
      seq: null,
      characterId: self.characterId,
      name: self.name,
      avatarVersion: self.avatarVersion,
      content,
      sentAt: new Date().toISOString(),
    });
    atBottomRef.current = true;
    setAtBottom(true);
    void send(clientId, content);
  }, [draft, place, self, send]);

  const onRetry = useCallback(
    (clientId) => {
      const row = retryPending(place, clientId);
      if (row) void send(clientId, row.content);
    },
    [place, send],
  );

  // The window, checked in an event handler where reading the clock is both
  // legal and correct. The refusal is the bot's word for word, so a player
  // hears one rule on both faces.
  const withinWindow = (sentAt) => Date.now() - new Date(sentAt ?? 0).getTime() < EDIT_WINDOW_MS;
  const TOO_LATE = "That was said more than five minutes ago and stands. ‡";

  const onEdit = useCallback((seq, sentAt) => {
    if (!withinWindow(sentAt)) {
      setError(TOO_LATE);
      return;
    }
    setError(null);
    setEditingSeq(seq);
  }, []);

  const onCancelEdit = useCallback(() => setEditingSeq(null), []);

  // The row swaps in from the stream, so nothing is written into the store
  // here: the server is the one that decides what the message now says.
  const onSaveEdit = useCallback(async (seq, content) => {
    setEditingSeq(null);
    try {
      const res = await fetch("/api/feed/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq, content }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "That didn't change. ‡");
        return;
      }
      setError(null);
    } catch {
      setError("That didn't change. ‡");
    }
  }, []);

  const onDelete = useCallback(
    async (seq, sentAt) => {
      if (!withinWindow(sentAt)) {
        setError(TOO_LATE);
        return;
      }
      if (!(await confirm({ title: "Take that back? ‡", message: "It goes from here and from Discord. ‡", confirmLabel: "Take it back ‡" }))) {
        return;
      }
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't go. ‡");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go. ‡");
      }
    },
    [confirm],
  );

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  // Scroll follows only a reader who is already at the bottom. Yanking
  // somebody back down while they are reading further up is the single most
  // annoying thing a chat window can do.
  // Only a DOM call, never a setState: react-hooks/set-state-in-effect is an
  // error here, and a "you have unread" flag would have needed one. Showing
  // the pill whenever the reader is scrolled up says the same thing without
  // a second piece of state to keep honest.
  // Scrolls the LIST, not the document: scrollIntoView walks every scrollable
  // ancestor, so on a phone it dragged the whole page down under the header
  // every time a row landed.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  // Looks BACK at the previous row rather than carrying a running variable
  // forward: react-hooks/immutability forbids reassigning a closure variable
  // inside a render, and the answer is the same either way.
  //
  // `mine` is what draws ✎ and ✕: a confirmed row of this character's. The
  // five-minute window is NOT decided here — the clock moves while the page
  // sits open, and a render that read it would be deciding on a stale one (and
  // is impure besides). It is checked when the button is pressed, and again by
  // the server, which is the only check that counts.
  const withRuns = useMemo(
    () =>
      rows.map((row, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const at = row.sentAt ? new Date(row.sentAt).getTime() : 0;
        const prevAt = prev?.sentAt ? new Date(prev.sentAt).getTime() : 0;
        const startsRun = !prev || prev.characterId !== row.characterId || at - prevAt > RUN_GAP_MS;
        const mine = Boolean(row.seq) && row.characterId === self.characterId;
        return { row, startsRun, mine };
      }),
    [rows, self.characterId],
  );

  return (
    <div className="panel flex flex-col gap-3" style={{ position: "relative" }}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{ maxHeight: "60vh", overflowY: "auto" }}
      >
        {withRuns.length === 0 ? (
          <EmptyState>Nothing has been said here yet. ‡</EmptyState>
        ) : (
          <ul className="list-none p-0">
            {withRuns.map(({ row, startsRun, mine }) => {
              const editing = Boolean(row.seq) && row.seq === editingSeq;
              return (
                <FeedRow
                  // The key changes when the row goes into edit mode, so the
                  // textarea mounts fresh with the current text rather than
                  // holding whatever a previous edit left in it.
                  key={editing ? `${row.seq}:edit` : (row.seq ?? row.clientId)}
                  row={row}
                  startsRun={startsRun}
                  mine={mine}
                  editing={editing}
                  coarse={coarse}
                  onRetry={onRetry}
                  onEdit={onEdit}
                  onCancelEdit={onCancelEdit}
                  onSaveEdit={onSaveEdit}
                  onDelete={onDelete}
                />
              );
            })}
          </ul>
        )}
      </div>

      {!atBottom && (
        <button
          type="button"
          className="btn-quiet"
          style={{ alignSelf: "center" }}
          onClick={() => {
            atBottomRef.current = true;
            setAtBottom(true);
            scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          New messages ‡
        </button>
      )}

      <div className="flex items-end gap-2">
        <div className="field min-w-0 flex-1">
          <label className="field-label" htmlFor="play-composer">
            Say ‡
          </label>
          <textarea
            id="play-composer"
            rows={2}
            value={draft}
            placeholder={`Say something in ${placeName}… ‡`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // A phone keyboard's Enter is a newline, as it is in Discord's
              // app; the button beside the box is the send there. On a
              // keyboard Enter sends and Shift+Enter breaks the line.
              if (coarse || e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              submit();
            }}
          />
        </div>
        {coarse && (
          <button type="button" className="btn" onClick={submit} disabled={!draft.trim()}>
            Send ‡
          </button>
        )}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
