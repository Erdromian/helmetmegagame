"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import ChipPicker from "../ChipPicker";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { loadEscort, startEscort, endEscort } from "@/app/(app)/character/guardActions";

// Escort (docs/systemdocs/ATTACK.md §6a, MAP.md §3d). Pick somebody here to guard: you follow them when
// they travel, paying your own way, and step in on their side if they are attacked. Re-openable, like
// Intercept: it says who you are escorting now, and Stop escorting lives down here too.
//
// Confirm greys on YOUR OWN sheet only — combat mode, being tied up — with the server's own sentence
// printed under the picker (SHEET.md §3: never a tooltip). The picker is everybody standing here, a hood
// by its token (db/lib/targetKey.js), and db/lib/verbs/guard.js re-checks whatever key is posted.
export default function EscortDialog({ mode, presets, onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState([]);
  const [current, setCurrent] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const preset = presets?.targetId ?? "";
  const [targetKey, setTargetKey] = useState(preset);
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadEscort()
      .then((res) => {
        if (!live || !res?.ok) return;
        setPeople(res.people ?? []);
        setCurrent(res.current ?? null);
        setBlocked(res.blocked ?? null);
        // Opened from the menu rather than on somebody: start on whoever you are escorting now.
        if (!preset) setTargetKey((res.people ?? []).find((p) => p.current)?.key ?? "");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [preset]);

  const target = people.find((p) => p.key === targetKey) ?? null;

  return (
    <ActionDialog
      title="Escort"
      busy={busy}
      error={error}
      loading={loading}
      empty={!loading && people.length === 0 && !current ? "There's nobody here to escort." : null}
      canSubmit={Boolean(target) && !blocked && !target?.current}
      onClose={onClose}
      onSubmit={() => submit(() => startEscort({ targetKey }), (res) => onDone(noticeLine(mode, res, { name: target?.name })))}
    >
      {current ? (
        <p className="text-sm text-muted">
          {current.here ? `You're escorting ${current.name}.` : `You're escorting ${current.name}, but they aren't here. You'll pick up again when you're together.`}
        </p>
      ) : null}
      <ChipPicker
        label="Who do you want to escort?"
        options={people.map((p) => ({ id: p.key, label: p.name }))}
        value={targetKey}
        onChange={setTargetKey}
        emptyLabel="There's nobody here."
      />
      {blocked ? <p className="text-xs text-muted">{blocked}</p> : null}
      <p className="text-xs text-muted">
        You follow them when they travel, spending your own travel, then your Move if you haven&apos;t used it. If you
        can&apos;t follow, you stay behind until you catch up. If they are attacked, you join the fight on their side.
        Needs combat mode, and ends when it goes off.
      </p>
      {current ? (
        <button type="button" className="btn-quiet" disabled={busy} onClick={() => submit(() => endEscort(), (res) => onDone(res.line))}>
          Stop escorting
        </button>
      ) : null}
    </ActionDialog>
  );
}
