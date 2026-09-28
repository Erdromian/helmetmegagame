"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { NAME_LIMITS, TITLE_WORDS } from "@/lib/characterName";
import { disguiseSelfRequest } from "@/app/(app)/character/requestActions";

// Disguise: a false name, typed. No people-picker — impersonating somebody
// real is a thing you do by typing their name. Whether it works is decided per
// reader (docs/systemdocs/STRANGERS.md §10): the full name of somebody real
// fools everyone who knows them, and a title is any the game has, since a
// disguise claims what it likes.
export default function DisguiseDialog({ mode, onDone, onClose }) {
  const [honorific, setHonorific] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const { submit, busy, error } = useSubmit();
  const typed = [honorific, firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

  return (
    <ActionDialog
      title="Disguise"
      busy={busy}
      error={error}
      canSubmit={Boolean(firstName.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => disguiseSelfRequest({ honorific, firstName, lastName }),
          (res) => onDone(noticeLine(mode, res, { name: res.name ?? typed })),
        )
      }
    >
      <label className="field">
        <span className="field-label">Title</span>
        <select value={honorific} onChange={(e) => setHonorific(e.target.value)}>
          <option value="">(none)</option>
          {TITLE_WORDS.map((word) => (
            <option key={word} value={word}>
              {word}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">First name</span>
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="A name"
          autoComplete="off"
          maxLength={NAME_LIMITS.firstName}
          required
          data-autofocus
        />
      </label>
      <label className="field">
        <span className="field-label">Last name</span>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="off"
          maxLength={NAME_LIMITS.lastName}
        />
      </label>
      <p className="text-xs text-muted">
        For 3 turns nobody sees your name or your face&mdash;you go by this instead. People who know the person
        you name will take you for them. Everyone else sees a stranger until they hear the name. You cannot
        conceal yourself on top of a disguise, and it wears off on its own. The kit is not used up.
      </p>
    </ActionDialog>
  );
}
