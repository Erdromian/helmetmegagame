"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { kissRequest } from "@/app/(app)/character/requestActions";

// Kiss (docs/systemdocs/KISS.md). One question, so the dialog is one picker.
//
// Nothing lands here: the verb files an Offer and the other player gets a DM
// with Accept / Decline. What comes back is `pending`, the same answer Learn,
// Teach and Confess give.
//
// The list is already narrowed server-side (web/lib/peoplePools.js) to the
// living, unconcealed people standing at this Location who aren't themselves
// in some state that rules it out — and kissRequestImpl re-runs the whole gate
// on whatever id is posted, so a stale page cannot push one through.
export default function KissDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { kissTargets: pools.kissTargets ?? [] } },
  });
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const { submit, busy, error } = useSubmit();

  const targets = roster?.people?.kissTargets ?? [];
  const target = targets.find((t) => t.id === targetId) ?? null;

  function onSubmit() {
    if (!target) return;
    submit(
      () => kissRequest({ targetCharacterId: target.id }),
      (res) => onDone(noticeLine(mode, res, { name: target.name })),
    );
  }

  return (
    <ActionDialog
      title="Kiss"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "There's nobody here to kiss. ‡" : null}
      canSubmit={Boolean(target)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you kissing?"
        options={targets.map((t) => ({ id: t.id, label: t.name }))}
        value={targetId}
        onChange={setTargetId}
      />
      <p className="text-xs text-muted">
        They have to agree. You can ask again in two hours, whatever they say. ‡
      </p>
    </ActionDialog>
  );
}
