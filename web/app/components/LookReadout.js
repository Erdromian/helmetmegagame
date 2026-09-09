"use client";

import Modal from "./Modal";
import FormError from "./FormError";
import { Readout } from "./ExamineDialog";

// What looking at somebody shows you, wherever you looked from.
//
// There were three copies of this block — one in the composer for `/look`, one
// in the HERE column for a hood, one on the sheet — and the hood's was the
// poorest of them, so looking at a stranger told you less than looking at a
// neighbour for no reason anybody had decided. db/lib/examine.js decides WHAT
// a look gives away and db/lib/examineRow.js decides WHO it is about; this
// only draws the answer.
//
// `state` is { loading } | { error } | { readout }, which is the shape every
// look action on the page answers with.
export default function LookReadout({ state, onClose, title = "Look at" }) {
  const readout = state?.readout ?? null;
  return (
    <Modal open title={readout?.name ?? title} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Looking…</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {readout && <Readout readout={readout} />}
      </div>
    </Modal>
  );
}
