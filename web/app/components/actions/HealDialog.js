"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { healCharacterRequest } from "@/app/(app)/character/requestActions";

// Heal: a patient standing here (you included), one of their afflictions, and
// who pays — three chip rows, each appearing once the one above is answered.
// Gated on YOUR Medical training, never on who is hurt nearby.

function partyChips(parties, selfId) {
  return [
    ...(parties?.characters ?? []).map((c) => ({ id: `character:${c.id}`, label: c.id === selfId ? `${c.name} (you)` : c.name })),
    ...(parties?.rooms ?? []).map((r) => ({ id: `room:${r.id}`, label: r.name, note: "room" })),
  ];
}

export default function HealDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const selfId = pools.selfId;
  const selfKey = selfId ? `character:${selfId}` : "";
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { healTargets: pools.healTargets ?? [], peopleParties: pools.healParties?.characters ?? [] } },
  });
  const targets = roster?.people?.healTargets ?? [];
  const parties = { characters: roster?.people?.peopleParties ?? [], rooms: pools.healParties?.rooms ?? [] };

  const [patientId, setPatientId] = useState(presets?.patientId ?? "");
  const [tagId, setTagId] = useState("");
  const [payerKey, setPayerKey] = useState(selfKey);
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const patient = targets.find((t) => t.id === patientId) ?? null;
  const affliction = patient?.healable.find((h) => h.tagId === tagId) ?? null;
  const payers = partyChips(parties, selfId);

  async function onSubmit() {
    if (!patient || !affliction || !payerKey) return;
    if (payerKey !== selfKey) {
      const payerName = payers.find((p) => p.id === payerKey)?.label ?? "They";
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    const self = patient.id === selfId;
    submit(
      () => healCharacterRequest({ targetCharacterId: patient.id, tagId: affliction.tagId, payerKey }),
      (res) =>
        onDone(
          res.gambit
            ? `${self ? "Your" : `${patient.name}'s`} ${affliction.tagName} is a Gambit — you'll both know at the end of the turn.`
            : noticeLine(mode, res, { name: self ? "You" : patient.name, self }),
        ),
    );
  }

  return (
    <ActionDialog
      title="Heal"
      submitLabel="Treat"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "Nobody here needs treating." : null}
      canSubmit={Boolean(patient && affliction && payerKey)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you treating?"
        options={targets.map((t) => ({ id: t.id, label: t.id === selfId ? `${t.name} (you)` : t.name }))}
        value={patientId}
        onChange={(id) => {
          setPatientId(id);
          setTagId("");
        }}
      />
      {patient && (
        <ChipPicker
          label="What are you treating?"
          options={patient.healable.map((h) => ({ id: h.tagId, label: h.tagName, note: h.gambit ? "Gambit" : null }))}
          value={tagId}
          onChange={setTagId}
          emptyLabel="Nothing on them you could treat."
        />
      )}
      {affliction && (
        <>
          <ChipPicker label="Paid for by" options={payers} value={payerKey} onChange={(k) => k && setPayerKey(k)} />
          <p className={`text-xs ${affliction.gambit ? "text-accent" : "text-muted"}`}>
            Costs <span className="mono">{affliction.cost} ⬢</span>.
            {affliction.gambit
              ? " This is beyond routine, so it counts as a Gambit. It uses your Move, a die is rolled, and a poor result can leave them worse off. You'll both know the outcome at the end of the turn."
              : affliction.counts
                ? ` One of the ${pools.healsLeft ?? "few"} cases you can work this turn.`
                : " First aid doesn't cost a Move."}
          </p>
        </>
      )}
    </ActionDialog>
  );
}
