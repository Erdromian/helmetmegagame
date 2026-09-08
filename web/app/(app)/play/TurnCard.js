"use client";

import { useEffect, useState } from "react";
import { describeTurn } from "@/lib/turnFormat";
import { EditIcon } from "@/app/components/icons";
import { moveKindLabel } from "./MoveDialog";

// When it is, when Moves stop being accepted, and what this character has
// already said they are doing. The one card at the top of the YOU column,
// because everything under it is answered by "have you moved yet".
//
// The countdown is computed in the browser off the ISO time so it cannot go
// stale on a page left open, and it is absent entirely when moveWindow says
// there is no lock — a frozen clock or a short manual turn has no honest time
// to count to (db/lib/turnClock.js).
//
// It counts to the CUTOFF, not to the turn's end. Moves stop three hours
// before midnight (MOVE_LOCK_HOURS), so counting to the end told a player
// they had three hours they did not have.
function untilLabel(closesAt, now) {
  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - now;
  if (ms <= 0) return "locked";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `closes in ${hours} h`;
  return `closes in ${Math.max(1, Math.round(ms / 60_000))} m`;
}

export default function TurnCard({ turn, move, onFile, onEdit }) {
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
        <div className="chat-move-filed">
          <div className="chat-chips">
            <span className="chip">{moveKindLabel(move.kind)}</span>
            {move.editable ? (
              <button type="button" className="btn-quiet" onClick={onEdit}>
                <EditIcon />
                Edit
              </button>
            ) : (
              // Bound, Dying, out cold: the server refuses the edit, so say so
              // here rather than drawing a button that can only fail.
              move.blockedReason && <span className="chat-quiet-line">{move.blockedReason}</span>
            )}
          </div>
          {/* Three lines, then it opens: a Move can be a paragraph, and the
              column is not the place to read the whole of one by default. */}
          <button
            type="button"
            className="chat-move-text"
            data-open={open ? "true" : undefined}
            onClick={() => setOpen((was) => !was)}
          >
            {move.description}
          </button>
        </div>
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
