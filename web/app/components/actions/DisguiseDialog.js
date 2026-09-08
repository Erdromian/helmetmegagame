"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { disguiseSelfRequest } from "@/app/(app)/character/requestActions";

// Disguise: a false name, typed. No people-picker — impersonating somebody
// real is a thing you do by typing their name, and whether you get away with
// it is a GM's question, not a dropdown's.
export default function DisguiseDialog({ mode, onDone, onClose }) {
  const [name, setName] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Disguise"
      busy={busy}
      error={error}
      canSubmit={Boolean(name.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => disguiseSelfRequest({ name }),
          (res) => onDone(noticeLine(mode, res, { name: res.name ?? name.trim() })),
        )
      }
    >
      <label className="field">
        <span className="field-label">Go by what name?</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="A name"
          autoComplete="off"
          maxLength={24}
          required
          data-autofocus
        />
      </label>
      <p className="text-xs text-muted">
        For 3 turns nobody sees your name or your face&mdash;you speak as this instead. You cannot conceal
        yourself on top of a disguise, and it wears off on its own. The kit is not used up.
      </p>
    </ActionDialog>
  );
}
