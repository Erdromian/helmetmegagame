"use client";

import { useState, useTransition } from "react";
import { setVisibleZonesAction } from "@/app/(desk)/gm/zoneViewActions";

// The zone multiselect that sits at the bottom of the inspector on both GM
// desks. What it sets is not a filter default: it decides which rows the desk
// shows AND which "GM: <Zone>" Discord roles the GM holds, so unticking a zone
// takes its Location channels out of their sidebar too.
//
// Nothing selected means every zone — see web/lib/gmZoneView.js. So "All" is
// not a separate mode to store, it is the empty set, which is why the All
// button simply clears the selection.
export default function GmZoneRail({ zones, selectedIds }) {
  const [selected, setSelected] = useState(() => new Set(selectedIds ?? []));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  // Optimistic, and rolled back on failure — the same shape the old zone-seat
  // picker used. A stuck-looking toggle is worse than a brief wrong one.
  const commit = (next) => {
    const previous = selected;
    setSelected(next);
    setError(null);
    startTransition(async () => {
      const result = await setVisibleZonesAction([...next]);
      if (!result?.ok) {
        setSelected(previous);
        setError(result?.error ?? "Couldn't save that.");
      }
    });
  };

  const toggle = (zoneId) => {
    const next = new Set(selected);
    if (next.has(zoneId)) next.delete(zoneId);
    else next.add(zoneId);
    commit(next);
  };

  const all = selected.size === 0;

  return (
    <div className="desk-inspector-zones">
      <span className="field-label">Zones I see</span>
      <div className="segmented segmented--wrap" role="group" aria-label="Zones I see">
        <button type="button" onClick={() => commit(new Set())} aria-pressed={all} disabled={pending}>
          All
        </button>
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => toggle(zone.id)}
            aria-pressed={selected.has(zone.id)}
            disabled={pending}
          >
            {zone.name}
          </button>
        ))}
      </div>
      {error && <p className="form-error text-xs">{error}</p>}
    </div>
  );
}
