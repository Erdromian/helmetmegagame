"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import { SendIcon } from "@/app/components/icons";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import { PLAYER_DM_MAX_LENGTH } from "@/lib/constants";
import { gmThread, sendToGms } from "./actions";
import { useDmState, seedDmRows, prependDmRows, addDmRow } from "./dmStore";
import { peekSeen, markSeen } from "./seenStore";

// The Bascinet conversation, in the Hall: everything the game has ever said
// to this player by DM — turn results, the Bird, a GM's reply — and a box to
// write back into. The same DirectMessage rows the GM desk reads, drawn by
// the desk's own DmThread from the other chair (HALL.md §2b).
//
// A pseudo-place like the faction banner: it is in the places column and it
// round-trips through the hash, but it has no feed, no seq and no channel.
// What lives here is the page fetch, the reply, and the seen mark.

// How long a pending row waits to be matched by its confirmed twin before it
// is dropped as its own thing. The stream (the trigger's NOTIFY) usually
// beats the action's answer, so the real row can already be in the store when
// the optimistic one is still drawn.
const MATCH_WINDOW_MS = 30_000;

let optimisticSeq = 0;

export const DM_PLACE_KEY = "gm";

export default function DmPane({ self }) {
  const dm = useDmState();
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [sending, startSending] = useTransition();
  // Where the NEW line goes is decided once, when the pane opens — the same
  // beat the mark moves in, which is why it is peeked here and not read from
  // the store.
  const [newSinceMs] = useState(() => {
    const mark = peekSeen(DM_PLACE_KEY);
    const n = mark ? Number(mark) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // The first page on open, and again after the tab's stream reconnected —
  // there is no cursor to catch up from, so the page is simply asked for
  // again and the store keeps what it already holds.
  useEffect(() => {
    let cancelled = false;
    gmThread()
      .then((result) => {
        if (cancelled || !result?.ok) return;
        seedDmRows(result.rows, result.hasMore);
      })
      .catch(() => {
        // The stream still delivers what comes next; the skeleton gives way
        // to whatever the store has.
      });
    return () => {
      cancelled = true;
    };
  }, [dm.reconnects]);

  // Reading it is seeing it. The dot compares against the newest thing
  // Bascinet said, and this pane being open means every one of them is on
  // the screen.
  useEffect(() => {
    if (dm.newestOutboundMs !== null) markSeen(DM_PLACE_KEY, String(dm.newestOutboundMs));
  }, [dm.newestOutboundMs]);

  const loadOlder = useCallback(() => {
    const first = dm.rows[0];
    if (!first) return;
    gmThread({ beforeId: first.id })
      .then((result) => {
        if (result?.ok) prependDmRows(result.rows, result.hasMore);
      })
      .catch(() => {});
  }, [dm.rows]);

  // A pending row retires the moment its confirmed twin shows up, whichever
  // path brought it — the stream usually wins.
  const messages = useMemo(() => {
    if (pending.length === 0) return dm.rows;
    const live = pending.filter(
      (p) =>
        !dm.rows.some(
          (row) =>
            row.direction === "INBOUND" &&
            row.content === p.content &&
            Math.abs(Date.parse(row.createdAt) - Date.parse(p.createdAt)) < MATCH_WINDOW_MS,
        ),
    );
    return live.length === 0 ? dm.rows : [...dm.rows, ...live];
  }, [dm.rows, pending]);

  const onKeyDown = useSubmitOnEnter();

  function send(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || content.length > PLAYER_DM_MAX_LENGTH || sending) return;
    setError(null);
    const tempId = `optimistic-${(optimisticSeq += 1)}`;
    const optimistic = {
      id: tempId,
      direction: "INBOUND",
      content,
      source: "player",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPending((prev) => [...prev, optimistic]);
    setDraft("");
    startSending(async () => {
      const result = await sendToGms(content);
      setPending((prev) => prev.filter((p) => p.id !== tempId));
      if (!result?.ok) {
        setDraft(content);
        setError(result?.error ?? "That didn't send. Try again. ‡");
        return;
      }
      addDmRow(result.row);
    });
  }

  const over = draft.length > PLAYER_DM_MAX_LENGTH;
  const nearLimit = draft.length > PLAYER_DM_MAX_LENGTH * 0.9;

  return (
    <div className="hall-main">
      <div className="hall-head">
        <h1 className="section-title">Bascinet</h1>
      </div>

      <div className="hall-feed hall-dm">
        {!dm.seeded ? (
          <ul className="list-none p-0" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="hall-skeleton">
                <span className="hall-skeleton-face" />
                <span className="hall-skeleton-lines">
                  <span className="hall-skeleton-bar" data-w="short" />
                  <span className="hall-skeleton-bar" />
                </span>
              </li>
            ))}
          </ul>
        ) : messages.length === 0 ? (
          <EmptyState>Nothing yet. Bascinet writes here, and so can you. ‡</EmptyState>
        ) : (
          <DmThread
            messages={messages}
            perspective="player"
            character={self?.characterId ? { id: self.characterId, name: self.name, avatarVersion: self.avatarVersion } : null}
            onLoadOlder={dm.hasMore ? loadOlder : null}
            hasMore={dm.hasMore}
            newSinceMs={newSinceMs}
          />
        )}
      </div>

      <form className="hall-composer" onSubmit={send}>
        <div className="field hall-composer-box">
          <textarea
            aria-label="Write to Bascinet"
            rows={2}
            value={draft}
            placeholder="Write to Bascinet…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {(nearLimit || error) && (
            <div className="hall-composer-foot">
              {error ? <span className="hall-composer-error">{error}</span> : <span />}
              {nearLimit && (
                <span className="mono" data-over={over ? "true" : undefined}>
                  {draft.length} / {PLAYER_DM_MAX_LENGTH}
                </span>
              )}
            </div>
          )}
        </div>
        <IconButton icon={SendIcon} label="Send" type="submit" disabled={sending || !draft.trim() || over} />
      </form>
    </div>
  );
}
