"use client";

import { useEffect, useState } from "react";
import { describeTurn, untilLabel } from "@/lib/turnFormat";
import { moveKindLabel } from "./MoveDialog";

// When it is, when Moves stop being accepted, and what this character has
// already said they are doing. The one card at the top of the YOU column,
// because everything under it is answered by "have you moved yet".
//
// The countdown and the cutoff it counts to are shared with the Move dialog,
// which asks the same question in its own header — so untilLabel lives in
// web/lib/turnFormat.js and both read the one copy.
export default function TurnCard({ turn, move, onFile }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!turn) return <p className="chat-quiet-line">No turn is open.</p>;

  const { label } = describeTurn({ number: turn.number, phase: turn.phase });
  const countdown = turn.locked ? "locked" : untilLabel(turn.closesAt, now);

  return (
    <div className="chat-move">
      <div className="chat-chips">
        <span className="chip chip-mono">{label}</span>
        {countdown && (
          // The server's minute and the browser's are not the same minute.
          <span
            className="chip chip-mono"
            data-tone={turn.locked ? "danger" : undefined}
            suppressHydrationWarning
          >
            {countdown}
          </span>
        )}
      </div>

      {move ? (
        /* A filed Move is final, so there is nothing to press but the words
           themselves — and the words are the point, so they are what this
           draws. The kind used to be a .chip up in the row above, which put a
           filled, bordered pill where a plain word belongs and left the
           player's own sentence reading as the caption to a badge. It is a
           quiet lead-in now. The » stays: it is the house mark for a line
           quoting somebody's own words (CLAUDE.md).

           Still clamped until clicked, because a Move can be a paragraph and
           neither surface is the place to read the whole of one by default. */
        <button
          type="button"
          className="chat-move-text"
          data-open={open ? "true" : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="chat-move-mark" aria-hidden="true">
            »
          </span>
          <span className="chat-move-kind">{moveKindLabel(move.kind)}</span>
          {move.description}
        </button>
      ) : (
        <div className="chat-buttons">
          <button type="button" className="btn" disabled={turn.locked} onClick={onFile}>
            Move…
          </button>
        </div>
      )}
    </div>
  );
}
