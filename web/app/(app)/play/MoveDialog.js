"use client";

import { useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { submitMove, updateMove } from "./actions";

// One dialog, two callers. With no `initial` it files a Move; with one it
// changes the Move already filed — the same three kinds and the same box,
// because a player correcting a typo is doing the thing they just did.
//
// It never asks twice: the one-Move-a-turn row IS the turn, so there is no
// cancel-and-re-file to offer.

export const MOVE_KINDS = [
  { value: "ROUTINE", label: "Routine", help: "The day's ordinary business. It just happens. ‡" },
  { value: "GAMBIT", label: "Gambit", help: "A reach. It is rolled for, and it can fail. ‡" },
  { value: "LABOR", label: "Labor", help: "A day's work for ⬢, instead of the day's other business. ‡" },
];

export function moveKindLabel(kind) {
  return MOVE_KINDS.find((entry) => entry.value === kind)?.label ?? "Move";
}

// Said in two places at once — under the disabled chips, and by
// db/lib/moves.js#editMove when somebody posts around them.
export const KIND_SPENT = "You can change what kind of Move it is once a turn. ‡";

export default function MoveDialog({ initial = null, onClose, onDone }) {
  const [kind, setKind] = useState(initial?.kind ?? "ROUTINE");
  const [body, setBody] = useState(initial?.description ?? "");
  const { run, pending, error } = useActionRunner();
  const chosen = MOVE_KINDS.find((k) => k.value === kind);
  const editing = Boolean(initial);
  // The kind change is one a turn, because changing it re-rolls. The text is
  // still free to fix, so the box stays open and only the chips shut.
  const kindLocked = Boolean(initial?.kindLocked);

  return (
    <Modal open title={editing ? "Change your Move ‡" : "Your Move"} onClose={onClose}>
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move ‡">
        {MOVE_KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="radio"
            className="chip"
            data-active={kind === entry.value ? "true" : undefined}
            aria-checked={kind === entry.value}
            disabled={kindLocked && entry.value !== kind}
            onClick={() => setKind(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{kindLocked ? KIND_SPENT : chosen?.help}</p>
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
          onClick={() => {
            const done = {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            };
            if (editing) {
              run(updateMove, { actionId: initial.actionId, moveKind: kind, description: body }, done);
            } else {
              run(submitMove, { moveKind: kind, description: body }, done);
            }
          }}
        >
          {editing ? "Save it" : "File it"}
        </button>
      </div>
    </Modal>
  );
}
