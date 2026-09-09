"use client";

import { useState } from "react";
import CheckField from "../CheckField";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import TagPicker from "./TagPicker";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { harmCharacterRequest } from "@/app/(app)/character/requestActions";

// Harm: somebody helpless here, an injury from the catalog, and the lethal
// tick for the Dying or Bound. The injury is optional and so is the tick, but
// one of the two has to be there.
export default function HarmDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { harmTargets: pools.harmTargets ?? [], harmTags: pools.harmTags ?? [] } },
  });
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const [tagId, setTagId] = useState(null);
  const [lethal, setLethal] = useState(false);
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const targets = roster?.people?.harmTargets ?? [];
  const harmTags = roster?.people?.harmTags ?? pools.harmTags ?? [];
  const target = targets.find((t) => t.id === targetId) ?? null;

  async function onSubmit() {
    if (!target) return;
    if (lethal) {
      const ok = await confirm({
        title: "Finish them off?",
        message: `This kills ${target.name}, now and for good.`,
        confirmLabel: "Kill them",
      });
      if (!ok) return;
    }
    submit(
      () => harmCharacterRequest({ targetCharacterId: target.id, tagId, lethal }),
      (res) => onDone(noticeLine(mode, res, { name: target.name })),
    );
  }

  return (
    <ActionDialog
      title="Harm"
      width="wide"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "Nobody here is helpless enough for that." : null}
      canSubmit={Boolean(target && (tagId || lethal))}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you hurting?"
        options={targets.map((t) => ({ id: t.id, label: t.name, note: t.condition ?? "Helpless" }))}
        value={targetId}
        onChange={(id) => {
          setTargetId(id);
          setLethal(false);
        }}
      />
      <span className="field-label">What injury? (optional)</span>
      <TagPicker tags={harmTags} selectedId={tagId} onSelect={setTagId} emptyLabel="No injuries in the catalog." />
      <CheckField checked={lethal} onChange={(e) => setLethal(e.target.checked)} disabled={!target?.finishable}>
        Finish them off
      </CheckField>
      <p className="text-xs text-muted">
        Only someone Dying or Bound can be finished off, and doing it <strong>kills them</strong> — there is no
        taking it back. Pick an injury, tick the box, or both.
      </p>
    </ActionDialog>
  );
}
