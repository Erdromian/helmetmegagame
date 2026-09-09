"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { researchRequest } from "@/app/(app)/character/requestActions";

// Research (docs/systemdocs/CRAFTING.md §2b): one question — which held
// ingredient the Scholastic takes into the Cathedral's archives.
//
// No useRoster read. Every other dialog asks the world who is standing here
// the moment it opens; this one asks nothing of the world at all. The
// shortlist is your own pockets against the craftable catalog, computed
// server-side in character/page.js and play/page.js, and researchRequest
// re-checks the ingredient, the ground and the Move under its own read.
//
// It only ever opens on `pools.canResearch`, so the empty state is
// unreachable — it is spelled out anyway, because the sentence is cheaper
// than the rule that says it cannot happen.
export default function ResearchAction({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const options = pools.researchOptions ?? [];
  // The first option is already chosen: a shortlist of things worth studying
  // has no meaningful "nothing picked" state the way a recipe's ingredient
  // slot does.
  const [slug, setSlug] = useState(presets?.ingredientSlug ?? options[0]?.slug ?? "");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const chosen = options.find((o) => o.slug === slug) ?? null;

  async function onSubmit() {
    if (!chosen) return;
    const ok = await confirm({
      title: "Spend your Move?",
      message:
        "This spends your Move as a Gambit. A failed roll will increase your familiarity with the subject, making future research on this item easier.",
      confirmLabel: "Research",
    });
    if (!ok) return;
    submit(
      () => researchRequest({ ingredientSlug: chosen.slug }),
      (res) => onDone(noticeLine(mode, res, { name: chosen.name })),
    );
  }

  return (
    <ActionDialog
      title="Research"
      busy={busy}
      error={error}
      empty={options.length === 0 ? "You're carrying nothing worth studying." : null}
      canSubmit={Boolean(chosen)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="What will you study?"
        options={options.map((o) => ({ id: o.slug, label: o.name }))}
        value={slug}
        onChange={setSlug}
      />
    </ActionDialog>
  );
}
