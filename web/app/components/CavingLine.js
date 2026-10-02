"use client";

import { useState } from "react";
import CavingResponseDialog from "./CavingResponseDialog";

// One line under the turn card, on /chat and the sheet, while a failed Caving roll found you on guard — the
// doc's prompt "as to how they might respond to any threats" (Combat Mode.docx, COMBAT-MODE.md §6). FightLine.js's
// shape. `caving` is chat/actions.js#myMove's summary; null when there is nothing to write for. The minute poll
// catches up with a save, and until then the line remembers it was written.
export default function CavingLine({ caving }) {
  const [open, setOpen] = useState(false);
  const [written, setWritten] = useState(false);
  if (!caving) return null;
  const where = caving.locationName ? ` in ${caving.locationName}` : "";
  const line =
    caving.needsWriting && !written
      ? `Something is wrong down here${where}. Write how you respond.`
      : `Something is wrong down here${where}. You've written how you respond.`;
  return (
    <div className="chat-waiting-row">
      <p className="quote">{line}</p>
      <div className="chat-buttons">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {caving.needsWriting && !written ? "Write" : "Change"}
        </button>
      </div>
      {open ? <CavingResponseDialog onClose={() => setOpen(false)} onSaved={() => setWritten(true)} /> : null}
    </div>
  );
}
