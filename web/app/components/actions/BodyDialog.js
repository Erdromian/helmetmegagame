"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { corpseIdOf, corpseLabel, yieldLabel } from "./corpseRows";
import { buryCharacterRequest, butcherCorpseRequest } from "@/app/(app)/character/requestActions";

// Bury and Butcher: one body in reach — held, or lying in a room here. Butcher
// takes anything and says what it yields; Bury needs a person, so a Nekker
// isn't offered rather than being offered and refused (CORPSES.md).
const VERBS = {
  bury: {
    title: "Bury person",
    empty: "You aren’t holding a body, and there’s none lying anywhere you can reach.",
    fit: (c) => c.human,
    run: (c) => buryCharacterRequest({ tagId: c.tagId, sourceKey: c.sourceKey }),
    note: () => null,
    // Said unconditionally rather than read off what is equipped: the dialog
    // has no equip list to check, and plumbing one in to save a clause would
    // buy a player nothing they cannot see on their own sheet.
    cost: "Costs your whole Move — half with a Shovel equipped.",
  },
  butcher: {
    title: "Butcher",
    empty: "There’s nothing here to cut up.",
    fit: () => true,
    run: (c) => butcherCorpseRequest({ tagId: c.tagId, sourceKey: c.sourceKey }),
    note: (c) => `gives ${yieldLabel(c)}`,
    cost: null,
  },
};

export default function BodyDialog({ mode, onDone, onClose }) {
  const verb = VERBS[mode];
  const pools = useActionPools();
  const { roster, loading } = useRoster(["corpses"], { seed: { corpses: pools.corpses ?? [] } });
  const [key, setKey] = useState("");
  const { submit, busy, error } = useSubmit();

  const list = (roster?.corpses ?? []).filter(verb.fit);
  const chosen = list.find((c) => corpseIdOf(c) === key) ?? null;

  function onSubmit() {
    if (!chosen) return;
    submit(
      () => verb.run(chosen),
      (res) => onDone(noticeLine(mode, res, { name: chosen.deadName ?? chosen.tagName })),
    );
  }

  return (
    <ActionDialog
      title={verb.title}
      busy={busy}
      error={error}
      loading={loading && list.length === 0}
      empty={!loading && list.length === 0 ? verb.empty : null}
      canSubmit={Boolean(chosen)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Whose body?"
        options={list.map((c) => ({ id: corpseIdOf(c), label: corpseLabel(c), note: verb.note(c) }))}
        value={key}
        onChange={setKey}
      />
      {verb.cost ? <p className="text-xs text-muted">{verb.cost}</p> : null}
    </ActionDialog>
  );
}
