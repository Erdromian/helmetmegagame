"use client";

import FormError from "@/app/components/FormError";

import Modal from "./Modal";

// The shared confirm-with-fields modal. One of these opens for any player
// action that needs input before it fires: the caller passes its own
// type-specific fields as children, and this supplies the title, the confirm
// button and the error line. It asks for nothing itself — the reason box it
// used to carry went when player actions stopped being Requests.
//
// The shell only mounts its body while open, so the fields reset between
// openings for free.
export default function RequestDialog({ open, ...props }) {
  if (!open) return null;
  return <RequestDialogBody {...props} />;
}

function RequestDialogBody({
  title,
  submitLabel = "Confirm",
  // Forwarded to Modal's own narrow/wide/widest sizes. A dialog whose body is
  // a browsable tag catalog needs the room; the ordinary two-field ones don't.
  width = undefined,
  // Forwarded to Modal too: a GM-side reason prompt on the desks floats so
  // the inspector stays browsable, while every player-facing one blocks.
  modeless = false,
  busy = false,
  error = null,
  canSubmit = true,
  onCancel,
  onConfirm,
  children,
}) {

  const ready = !busy && canSubmit;

  return (
    <Modal modeless={modeless} title={title} width={width} onClose={() => !busy && onCancel?.()}>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm?.();
        }}
      >

        {children && (
          <div
            className="flex flex-col gap-3"
          >
            {children}
          </div>
        )}

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => onCancel?.()} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!ready}>
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
