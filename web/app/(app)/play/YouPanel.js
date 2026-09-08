"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import MoveDialog from "./MoveDialog";
import TurnCard from "./TurnCard";
import StatusStrip from "./StatusStrip";
import Things from "./ThingsDrawer";
import DesiresBlock from "./DesiresBlock";
import { waitingOnYou, answerWaiting } from "./actions";
import useVisiblePoll from "./useVisiblePoll";
import useMyMove from "./useMyMove";

// YOU: everything about this character that is not about where they are
// standing, in the order a player asks it — what day is it and have I moved,
// what state is this body in, what am I owed a Desire for, my sheet, and what
// is waiting on me. What happened yesterday is in the Bascinet conversation
// in the places column now (./DmPane.js), with every other day.
//
// The Move dialog and the sheet link are what the #turns console carries that
// a web-only player would otherwise lose with it (CHAT.md §6, decision 2).

// Waiting on you: pending offers, a threat seat, a letter the bird has not
// left with, a lobby assignment. Accept and Decline call the SAME db/lib
// functions the DM's buttons call (db/lib/lessons.js, bind.js, confession.js,
// threatSpawn.js, lobby.js), so an answer given here and one given in Discord
// are one answer, and the second surface finds nothing left to answer.
function WaitingList({ rows, onAnswered }) {
  const { run, pending, error } = useActionRunner();
  if (rows.length === 0) return null;
  return (
    <div className="chat-waiting">
      <p className="chat-section-title">Waiting on you · {rows.length}</p>
      {rows.map((row) => (
        <div key={row.key} className="chat-waiting-row">
          <span className="chat-person-name">{row.label}</span>
          <span className="chat-waiting-actions">
            {row.accept !== false && (
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: true }, { onOk: onAnswered })}
              >
                Accept
              </button>
            )}
            {row.decline !== false && (
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: false }, { onOk: onAnswered })}
              >
                Decline
              </button>
            )}
            {row.href && (
              <Link className="menu-item" href={row.href}>
                Open
              </Link>
            )}
          </span>
        </div>
      ))}
      <FormError>{error}</FormError>
    </div>
  );
}

export default function YouPanel({
  initialWaiting = [],
  turn = null,
  move = null,
  status = null,
  desires = null,
  // What is in this character's pockets, grouped Items then Assets
  // (./thingRows.js). The drawer re-reads it for itself after every verb.
  things = [],
}) {
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [waiting, setWaiting] = useState(initialWaiting);
  // The Move half of the poll lives in useMyMove, which the sheet's band
  // shares (web/app/components/SheetTurn.js).
  const moveState = useMyMove({ turn, move });
  const refreshMove = moveState.refresh;

  const refresh = useCallback(() => {
    // One interval, both reads: a Move filed in Discord and an offer answered
    // in Discord both land here without a reload.
    waitingOnYou()
      .then((res) => {
        if (res?.ok) setWaiting(res.rows);
      })
      .catch(() => {
        // The list is a reminder, not the record. A failed refresh loses
        // nothing a reload does not bring back.
      });
    refreshMove();
  }, [refreshMove]);

  // A minute is often enough for a notice board of this kind, and it costs
  // two small queries.
  useVisiblePoll(refresh, 60_000);

  const say = useCallback(
    (res) => {
      setNotice(res.line ?? null);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="chat-you">
      <p className="chat-section-title">You</p>

      <TurnCard
        turn={moveState.turn}
        move={moveState.move}
        onFile={() => setDialog("move")}
        onEdit={() => setDialog("edit")}
      />
      <StatusStrip resources={status?.resources ?? 0} carry={status?.carry ?? null} tags={status?.tags ?? []} />
      <Things groups={things} />
      <DesiresBlock view={desires} />

      <div className="chat-buttons">
        <Link className="btn-secondary" href="/character">
          Sheet ›
        </Link>
      </div>
      {notice && (
        <div className="chat-quiet-line">
          <ChatMarkdown content={notice} />
        </div>
      )}

      <WaitingList rows={waiting} onAnswered={say} />

      {dialog === "move" && <MoveDialog onClose={() => setDialog(null)} onDone={say} />}
      {dialog === "edit" && moveState.move && (
        <MoveDialog
          initial={{
            actionId: moveState.move.id,
            kind: moveState.move.kind,
            description: moveState.move.description,
            kindLocked: moveState.move.kindLocked,
          }}
          onClose={() => setDialog(null)}
          onDone={say}
        />
      )}
    </div>
  );
}
