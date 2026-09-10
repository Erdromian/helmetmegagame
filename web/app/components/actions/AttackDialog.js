"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import useSubmit from "./useSubmit";
import {
  loadAttacks,
  attackCharacterRequest,
  cancelAttackRequest,
} from "@/app/(app)/character/attackActions";

// Attacking somebody (docs/systemdocs/ATTACK.md). One person standing here,
// picked from a chip row — BindDialog's shape — plus the list of fights you
// are already in, each with the button that calls it off.
//
// What an attack does is the verb's own help sentence (ACTION_HELP.attack)
// and the confirm dialog's own line, not a second explanation here — the
// dialog itself is just the picker and the list of fights already in progress.
//
// The picker lists everybody here, including the people the button will refuse.
// That is deliberate: filtering them out would answer "who is out of my league"
// to anyone who opened the dialog, which is the one thing docs/systemdocs/
// COMBAT.md §5 is written to prevent. You find out by pressing it.
export default function AttackDialog({ onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState([]);
  const [fighting, setFighting] = useState([]);
  const [targetId, setTargetId] = useState("");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadAttacks()
      .then((res) => {
        if (!live || !res?.ok) return;
        setPeople(res.people ?? []);
        setFighting(res.fighting ?? []);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Anybody you are already fighting is off the picker — the row for them is
  // in the list below, and pressing it again could only ever be refused.
  const busyWith = new Set(fighting.map((row) => row.id));
  const options = people.filter((row) => !busyWith.has(row.id));
  const target = options.find((row) => row.id === targetId) ?? null;

  async function onSubmit() {
    if (!target) return;
    const ok = await confirm({
      title: `Attack ${target.name}?`,
      message: "Neither of you can move until the turn ends.",
      confirmLabel: "Attack them",
    });
    if (!ok) return;
    submit(
      () => attackCharacterRequest({ targetCharacterId: target.id }),
      (res) => onDone(res.line),
    );
  }

  return (
    <ActionDialog
      title="Attack"
      busy={busy}
      error={error}
      loading={loading && options.length === 0 && fighting.length === 0}
      empty={!loading && options.length === 0 && fighting.length === 0 ? "There’s nobody here to attack." : null}
      canSubmit={Boolean(target)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      {options.length > 0 ? (
        <ChipPicker
          label="Who are you attacking?"
          options={options.map((row) => ({ id: row.id, label: row.name }))}
          value={targetId}
          onChange={setTargetId}
        />
      ) : null}

      {fighting.length > 0 ? (
        <div className="field">
          <span className="field-label">You are fighting</span>
          {fighting.map((row) => (
            <div key={row.id} className="chip-row">
              <span className="text-sm">{row.name}</span>
              <button
                type="button"
                className="btn-quiet"
                disabled={busy}
                onClick={() =>
                  submit(
                    () => cancelAttackRequest({ targetCharacterId: row.id }),
                    (res) => {
                      setFighting((rows) => rows.filter((r) => r.id !== row.id));
                      onDone(res.line);
                    },
                  )
                }
              >
                Break off
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ActionDialog>
  );
}
