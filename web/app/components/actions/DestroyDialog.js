"use client";

import { useState } from "react";
import { useConfirm } from "../ConfirmProvider";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { destroyableTags } from "@/lib/tagRequests";
import { destroyTagRequest } from "@/app/(app)/character/requestActions";

// Destroy: what you are carrying, as rows with a count. One stack at a time
// — the server takes one tag and a quantity — so the rows are a picker, and
// the first row with a count is the one that goes.
export default function DestroyDialog({ presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const removable = destroyableTags(roster?.self?.characterTags ?? []);
  const [picks, setPicks] = useState(() => (presets?.tagId ? { [presets.tagId]: "1" } : {}));
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const rows = removable.map((t) => ({ id: t.id, name: t.name, held: t.quantity, max: t.stackable ? t.quantity : 1 }));
  const line = pickedLines(picks)[0] ?? null;
  const chosen = line ? removable.find((t) => t.id === line.tagId) : null;

  async function onSubmit() {
    if (!chosen) return;
    const what = line.quantity > 1 ? `${line.quantity}× ${chosen.name}` : chosen.name;
    const ok = await confirm({
      title: "Destroy it?",
      message: `${what} is gone for good. Nothing comes back.`,
      confirmLabel: "Destroy",
    });
    if (!ok) return;
    submit(
      () => destroyTagRequest({ tagId: chosen.id, quantity: String(line.quantity) }),
      () => onDone(`${what} destroyed.`),
    );
  }

  return (
    <ActionDialog
      title="Destroy"
      busy={busy}
      error={error}
      empty={rows.length === 0 ? "You're carrying nothing you could destroy. ‡" : null}
      canSubmit={Boolean(chosen)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <span className="field-label">What are you destroying?</span>
      <StackPicker
        rows={rows}
        picks={picks}
        // One stack: a count on a second row replaces the first.
        onChange={(next) => {
          const keys = Object.keys(next);
          const kept = keys.length > 1 ? keys.filter((k) => !(k in picks)) : keys;
          setPicks(Object.fromEntries(kept.slice(0, 1).map((k) => [k, next[k]])));
        }}
      />
    </ActionDialog>
  );
}
