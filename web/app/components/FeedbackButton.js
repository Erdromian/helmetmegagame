"use client";

import { useState, useTransition } from "react";
import { MAX_FEEDBACK_LENGTH } from "@lifeweb/db/lib/feedbackLimits";
import { submitFeedback } from "../feedbackActions";
import RequestDialog from "./RequestDialog";

// One composer, two buttons: the top bar's (NavLinks.js) and the small one in
// the corner of the character sheet (LedgerBand.js). `className` is what tells
// them apart — everything else, the dialog included, is shared.
//
// The action returns {error} instead of throwing, so a refusal (the rate
// limit especially) reads as a line in the dialog rather than a crashed page,
// and what they wrote stays in the box.
export default function FeedbackButton({ className = "nav-link", label = "Feedback" }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);
  const [busy, startTransition] = useTransition();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setBody("");
    setError(null);
  };

  const send = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitFeedback(body);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setBody("");
    });
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>

      <RequestDialog
        open={open}
        title="Feedback"
        submitLabel="Send"
        width="narrow"
        busy={busy}
        error={error}
        canSubmit={body.trim().length > 0}
        onCancel={close}
        onConfirm={send}
      >
        <label className="field">
          <span className="field-label">
            What bugs or feedback would you like to report to development?
          </span>
          <textarea
            name="feedback"
            rows={6}
            autoFocus
            maxLength={MAX_FEEDBACK_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened…"
          />
        </label>
        <p className="text-xs mono" style={{ color: "var(--text-muted)" }}>
          {body.length} / {MAX_FEEDBACK_LENGTH}
        </p>
      </RequestDialog>
    </>
  );
}
