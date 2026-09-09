"use client";

import { useState } from "react";
import Select from "../Select";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { scoreMatch } from "@/lib/fuzzySearch";
import { whisperRequest } from "@/app/(app)/character/requestActions";

// The Raven Draught: one sentence, one person, anywhere (docs/systemdocs/
// BIRD.md §8).
//
// It borrows the Bird's recipient list, which is EVERY character alive or
// dead, and its search box narrows on the name the player typed and nothing
// else. Same reasoning: a list of the living is a casualty report anyone
// could read by opening a dialog.
//
// There is no delivered/not-delivered here and there must never be one. The
// dialog says "Sent." whatever happened, because the alternative is a bottle
// that answers "is this person still alive" — which is the exact question the
// Bird was built to refuse.
const MAX = 400;

export default function WhisperDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const targets = pools.birdTargets ?? [];
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [message, setMessage] = useState("");
  const { submit, busy, error } = useSubmit();

  const q = query.trim();
  const choices = q
    ? targets.filter((t) => t.id === targetId || scoreMatch(q, { name: t.name }))
    : targets;
  const body = message.trim();

  return (
    <ActionDialog
      title="Send a message"
      submitLabel="Send it"
      busy={busy}
      error={error}
      canSubmit={Boolean(targetId && body)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => whisperRequest({ recipientId: targetId, message: body }),
          () => onDone("Sent."),
        )
      }
    >
      <label className="field">
        <span className="field-label">Who is it for?</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          data-autofocus
        />
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
          <option value="" disabled>
            Pick someone
          </option>
          {choices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted mono">
          {choices.length} / {targets.length}
        </span>
      </label>
      <label className="field">
        <span className="field-label">What do you say?</span>
        <textarea
          rows={3}
          maxLength={MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="text-xs text-muted mono">
          {body.length} / {MAX}
        </span>
      </label>
    </ActionDialog>
  );
}
