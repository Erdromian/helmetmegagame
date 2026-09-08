"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { sealLetter } from "@/app/(app)/character/paperActions";

// Seal Letter: which written letter, whose wax (PAPERWORK.md).
export default function SealDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const letters = pools.sealOptions?.letters ?? [];
  const stamps = pools.sealOptions?.stamps ?? [];
  const [tagId, setTagId] = useState("");
  const [stampId, setStampId] = useState(stamps.length === 1 ? stamps[0].tagId : "");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Seal Letter"
      submitLabel="Seal it"
      busy={busy}
      error={error}
      empty={letters.length === 0 ? "You aren't carrying a written letter to close." : null}
      canSubmit={Boolean(tagId && stampId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => sealLetter({ tagId, stampTagId: stampId }),
          (res) => onDone(`${res.name ?? "The letter"} is sealed.`),
        )
      }
    >
      <ChipPicker
        label="Which letter?"
        options={letters.map((o) => ({ id: o.tagId, label: o.name, note: o.excerpt ?? null }))}
        value={tagId}
        onChange={setTagId}
      />
      <ChipPicker label="Whose wax?" options={stamps.map((o) => ({ id: o.tagId, label: o.name }))} value={stampId} onChange={setStampId} />
    </ActionDialog>
  );
}
