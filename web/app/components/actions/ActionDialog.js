"use client";

import RequestDialog from "../RequestDialog";

// The shell every player-action dialog renders exactly one of. A thin frame
// over RequestDialog — title, fields, error line, Cancel/Confirm — plus the
// two states the old inline dialogs got wrong:
//
//   loading — the roster is still being read. The body says so and the
//             Confirm stays off, so nobody submits against a list that has
//             not arrived.
//   empty   — the roster came back with nobody in it. The sentence is shown
//             and the footer is a single Close: a disabled Confirm under
//             "Nobody here is bound." was a dead button under an answer.
//
// Three rules for the dialog files that use this (components/actions/*):
//   1. Confirm BEFORE startTransition, never inside it (DESIGN-SYSTEM.md §8).
//   2. onDone(line) closes and hands the provider a sentence to say; a dialog
//      never raises a notice itself, so every success reads the same way.
//   3. An empty roster is `empty="…"` here — never a live Confirm.
export default function ActionDialog({
  title,
  submitLabel,
  width,
  busy = false,
  error = null,
  canSubmit = true,
  loading = false,
  empty = null,
  onClose,
  onSubmit,
  children,
}) {
  const closeOnly = Boolean(empty) && !loading;
  return (
    <RequestDialog
      open
      title={title}
      submitLabel={submitLabel ?? title}
      width={width}
      busy={busy}
      error={error}
      canSubmit={canSubmit && !loading && !closeOnly}
      onCancel={() => !busy && onClose?.()}
      onConfirm={onSubmit}
      footer={
        closeOnly ? (
          <div className="modal-actions">
            <button type="button" className="btn-quiet" onClick={() => onClose?.()}>
              Close
            </button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-muted">Looking… ‡</p>
      ) : closeOnly ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        children
      )}
    </RequestDialog>
  );
}
