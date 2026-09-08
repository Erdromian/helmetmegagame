"use client";

import ExamineDialog from "../ExamineDialog";

// Look at, in the dialog-file shape the provider mounts. ExamineDialog is
// already self-contained (its own roster fetch, its own readout); this only
// hands it the preset — Chat's HERE rows and its feed rows name the person
// before the dialog opens, so the picker is skipped.
export default function ExamineAction({ presets, onClose }) {
  return <ExamineDialog open targetId={presets?.targetId || null} onClose={onClose} />;
}
