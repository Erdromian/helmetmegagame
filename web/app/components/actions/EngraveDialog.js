"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { ENGRAVE_RESOURCE_COST } from "@/lib/constants";
import { engraveHeadstoneRequest } from "@/app/(app)/character/requestActions";

// Engrave types its target instead of picking it — a dropdown would be a list
// of the dead, and this one searches every zone (REQUESTS.md §5d). No "nobody
// here" line either, for the same reason: you type a name and find out.
export default function EngraveDialog({ mode, onDone, onClose }) {
  const [name, setName] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Engrave"
      busy={busy}
      error={error}
      canSubmit={Boolean(name.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => engraveHeadstoneRequest({ firstName: name }),
          (res) => onDone(noticeLine(mode, res, { name: name.trim() })),
        )
      }
    >
      <label className="field">
        <span className="field-label">Whose name?</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name"
          autoComplete="off"
          maxLength={24}
          required
          data-autofocus
        />
      </label>
      <p className="text-xs text-muted">Costs {ENGRAVE_RESOURCE_COST} ⬢ and your turn.</p>
    </ActionDialog>
  );
}
