"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { consumableTags } from "@/lib/tagRequests";
import { consumeTagRequest } from "@/app/(app)/character/requestActions";

// Consume: one of the things in your pockets that can be used up, as chips.
// Nothing about what it leaves behind — that is the tag's own business, and
// the tag chip on the sheet is the one-click way in anyway.
export default function ConsumeDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const [tagId, setTagId] = useState(presets?.tagId ?? "");
  const { submit, busy, error } = useSubmit();

  const consumable = consumableTags(roster?.self?.characterTags ?? []);
  const chosen = consumable.find((t) => t.id === tagId) ?? null;

  return (
    <ActionDialog
      title="Consume"
      busy={busy}
      error={error}
      empty={consumable.length === 0 ? "Nothing you're carrying can be used up." : null}
      canSubmit={Boolean(chosen)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => consumeTagRequest({ tagId: chosen.id }),
          (res) => onDone(noticeLine(mode, res, { name: chosen.name })),
        )
      }
    >
      <ChipPicker
        label="What are you using up?"
        options={consumable.map((t) => ({
          id: t.id,
          label: t.name,
          note: t.quantity > 1 ? `×${t.quantity}` : null,
        }))}
        value={tagId}
        onChange={setTagId}
      />
      {chosen && chosen.quantity > 1 && <p className="text-xs text-muted">Takes one of your {chosen.quantity}.</p>}
    </ActionDialog>
  );
}
