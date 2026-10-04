"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import ChipPicker from "../ChipPicker";
import CheckField from "../CheckField";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { loadEscort, startEscort, endEscort } from "@/app/(app)/character/guardActions";

// Escort (docs/systemdocs/ATTACK.md §6a, MAP.md §3d). Pick somebody here to guard: you follow them when
// they travel, paying your own way, and step into their fights the way the two boxes say — when they are
// attacked (on by default), and when they attack somebody (off by default).
//
// Pressed while you are escorting somebody, it is the off switch (Bascinet, 2026-10-04): the dialog says who
// you are escorting and its one button stops it. Which of the two it is comes from loadEscort, read the
// moment it opens, never from the page's copy. To switch charges or change the boxes, stop and escort again.
//
// Confirm greys on YOUR OWN sheet only — combat mode, being tied up — with the server's own sentence
// printed under the picker (SHEET.md §3: never a tooltip). The picker is everybody standing here, a hood
// by its token (db/lib/targetKey.js), and db/lib/verbs/guard.js re-checks whatever key is posted.
export default function EscortDialog({ mode, presets, onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState([]);
  const [current, setCurrent] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [targetKey, setTargetKey] = useState(presets?.targetId ?? "");
  const [defends, setDefends] = useState(true);
  const [attacks, setAttacks] = useState(false);
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadEscort()
      .then((res) => {
        if (!live || !res?.ok) return;
        setPeople(res.people ?? []);
        setCurrent(res.current ?? null);
        setBlocked(res.blocked ?? null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  if (current) {
    return (
      <ActionDialog
        title="Stop escorting"
        busy={busy}
        error={error}
        loading={loading}
        onClose={onClose}
        onSubmit={() => submit(() => endEscort(), (res) => onDone(res.line))}
      >
        <p className="text-sm text-muted">
          {current.here
            ? `You're escorting ${current.name}.`
            : `You're escorting ${current.name}, but they aren't here. You'll pick up again when you're together.`}
        </p>
      </ActionDialog>
    );
  }

  const target = people.find((p) => p.key === targetKey) ?? null;

  return (
    <ActionDialog
      title="Escort"
      busy={busy}
      error={error}
      loading={loading}
      empty={!loading && people.length === 0 ? "There's nobody here to escort." : null}
      canSubmit={Boolean(target) && !blocked}
      onClose={onClose}
      onSubmit={() =>
        submit(() => startEscort({ targetKey, defends, attacks }), (res) => onDone(noticeLine(mode, res, { name: target?.name })))
      }
    >
      <ChipPicker
        label="Who do you want to escort?"
        options={people.map((p) => ({ id: p.key, label: p.name }))}
        value={targetKey}
        onChange={setTargetKey}
        emptyLabel="There's nobody here."
      />
      <div className="flex flex-col gap-1">
        <CheckField checked={defends} onChange={(e) => setDefends(e.target.checked)}>
          Defend them if they&apos;re attacked
        </CheckField>
        <CheckField checked={attacks} onChange={(e) => setAttacks(e.target.checked)}>
          Join them if they attack someone
        </CheckField>
      </div>
      {blocked ? <p className="text-xs text-muted">{blocked}</p> : null}
      {/* Bascinet's words (the Escort copy sheet, 2026-09-30), less the sentence the two boxes now say. */}
      <p className="text-xs text-muted">
        You will follow your target to the best of your ability, and continue escorting them if they return after being
        separated. You must have combat mode enabled.
      </p>
    </ActionDialog>
  );
}
