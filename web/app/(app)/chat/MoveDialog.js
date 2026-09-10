"use client";

import { useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { submitMove } from "./actions";

// Filing the one Move a turn. It never asks twice, and there is nothing to
// come back to: the @@unique([characterId, turnId]) row IS the turn, and a
// filed Move is final. This dialog used to double as an editor with a
// once-a-turn cap on changing the kind; the rule now is that you get one Move
// and it stands.

// The three help lines are Bascinet's own, word for word from the Discord
// modal's radio group (bot/src/lib/moveModal.js) — so a player reads the same
// sentence whichever face they file from. If the wording changes, change it
// in both places.
export const MOVE_KINDS = [
  { value: "ROUTINE", label: "Routine", help: "Easy — it resolves itself." },
  { value: "GAMBIT", label: "Gambit", help: "Could go either way — rolls a die." },
  { value: "LABOR", label: "Labor", help: "Work the day. Your best skill, where you stand." },
];

export function moveKindLabel(kind) {
  return MOVE_KINDS.find((entry) => entry.value === kind)?.label ?? "Move";
}

export default function MoveDialog({ onClose, onDone }) {
  const [kind, setKind] = useState("ROUTINE");
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  const chosen = MOVE_KINDS.find((k) => k.value === kind);

  return (
    <Modal open title="Your Move" onClose={onClose}>
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move">
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
        <label className="field-label" htmlFor="chat-move">
          What do you do?
        </label>
        <textarea id="chat-move" rows={6} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
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
          File it
        </button>
      </div>
    </Modal>
  );
}
