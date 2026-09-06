"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { submitMove, reportToGms, waitingOnYou, answerWaiting } from "./actions";

// YOU: the three things the #turns console carries that a web-only player
// would otherwise lose with it (HALL.md §6, decision 2) — filing a Move,
// getting to your sheet, and reaching a GM — plus everything that is holding
// still until you answer it.

const MOVE_KINDS = [
  { value: "ROUTINE", label: "Routine", help: "The day's ordinary business. It just happens. ‡" },
  { value: "GAMBIT", label: "Gambit", help: "A reach. It is rolled for, and it can fail. ‡" },
  { value: "LABOR", label: "Labor", help: "A day's work for ⬢, instead of the day's other business. ‡" },
];

function MoveDialog({ onClose, onDone }) {
  const [kind, setKind] = useState("ROUTINE");
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  const chosen = MOVE_KINDS.find((k) => k.value === kind);

  return (
    <Modal open title="Your Move ‡" onClose={onClose}>
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move ‡">
        {MOVE_KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="radio"
            className="chip"
            data-active={kind === entry.value ? "true" : undefined}
            aria-checked={kind === entry.value}
            onClick={() => setKind(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{chosen?.help}</p>
      <div className="field">
        <label className="field-label" htmlFor="hall-move">
          What do you do? ‡
        </label>
        <textarea id="hall-move" rows={6} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!body.trim() || pending}
          onClick={() =>
            run(submitMove, { moveKind: kind, description: body }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          File it ‡
        </button>
      </div>
    </Modal>
  );
}

// The OOC ticket. It writes an INBOUND DirectMessage and sends nothing to
// Discord, so it lands in the GM's conversation with this player beside
// everything else they have said (see ./actions.js#reportToGms).
function ReportDialog({ onClose, onDone }) {
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  return (
    <Modal open title="Report to the GMs ‡" onClose={onClose}>
      <p className="text-sm text-muted">
        Out of character. It goes to the GMs&apos; desk, and they answer you in your DMs. ‡
      </p>
      <div className="field">
        <label className="field-label" htmlFor="hall-report">
          What has happened? ‡
        </label>
        <textarea id="hall-report" rows={5} value={body} maxLength={1800} onChange={(e) => setBody(e.target.value)} />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!body.trim() || pending}
          onClick={() =>
            run(reportToGms, body, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Send it ‡
        </button>
      </div>
    </Modal>
  );
}

// Waiting on you: pending offers, a threat seat, a letter the bird has not
// left with, a lobby assignment. Accept and Decline call the SAME db/lib
// functions the DM's buttons call (db/lib/lessons.js, bind.js, confession.js,
// threatSpawn.js, lobby.js), so an answer given here and one given in Discord
// are one answer, and the second surface finds nothing left to answer.
function WaitingList({ rows, onAnswered }) {
  const { run, pending, error } = useActionRunner();
  if (rows.length === 0) return null;
  return (
    <div className="hall-waiting">
      <p className="hall-section-title">Waiting on you · {rows.length} ‡</p>
      {rows.map((row) => (
        <div key={row.key} className="hall-waiting-row">
          <span className="hall-person-name">{row.label}</span>
          <span className="hall-waiting-actions">
            {row.accept !== false && (
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: true }, { onOk: onAnswered })}
              >
                Accept ‡
              </button>
            )}
            {row.decline !== false && (
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: false }, { onOk: onAnswered })}
              >
                Decline ‡
              </button>
            )}
            {row.href && (
              <Link className="menu-item" href={row.href}>
                Open ‡
              </Link>
            )}
          </span>
        </div>
      ))}
      <FormError>{error}</FormError>
    </div>
  );
}

export default function YouPanel({ initialWaiting = [] }) {
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [waiting, setWaiting] = useState(initialWaiting);

  const refresh = useCallback(() => {
    waitingOnYou()
      .then((res) => {
        if (res?.ok) setWaiting(res.rows);
      })
      .catch(() => {
        // The list is a reminder, not the record. A failed refresh loses
        // nothing a reload does not bring back.
      });
  }, []);

  // A DM answered in Discord clears a row here, and a new offer arrives
  // without one. A minute is often enough for a notice board of this kind,
  // and it costs one small query.
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const say = useCallback(
    (res) => {
      setNotice(res.line ?? null);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="hall-you">
      <p className="hall-section-title">You ‡</p>
      <div className="hall-buttons">
        <button type="button" className="btn" onClick={() => setDialog("move")}>
          Move… ‡
        </button>
        <Link className="btn-secondary" href="/character">
          Sheet ›
        </Link>
        <button type="button" className="btn-quiet" onClick={() => setDialog("report")}>
          Report to the GMs ‡
        </button>
      </div>
      {notice && <p className="hall-quiet-line">{notice}</p>}

      <WaitingList rows={waiting} onAnswered={say} />

      {dialog === "move" && <MoveDialog onClose={() => setDialog(null)} onDone={say} />}
      {dialog === "report" && <ReportDialog onClose={() => setDialog(null)} onDone={say} />}
    </div>
  );
}
