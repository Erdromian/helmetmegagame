"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setVisibleZonesAction } from "@/app/(desk)/gm/zoneViewActions";
import { useSetVisibleZoneNames } from "@/app/components/GmZoneViewProvider";

// How long a burst of clicks is allowed to settle before one write goes out.
// Picking four zones is four clicks and should be one action, not four.
const SETTLE_MS = 350;

// The zone multiselect that sits at the bottom of the inspector on both GM
// desks. What it sets is not a filter default: it decides which rows the desk
// shows AND which "GM: <Zone>" Discord roles the GM holds, so unticking a zone
// takes its Location channels out of their sidebar too.
//
// Nothing selected means every zone — see web/lib/gmZoneView.js. So "All" is
// not a separate mode to store, it is the empty set, which is why the All
// button simply clears the selection.
//
// Nothing here ever waits on the server. Local state paints on the click, the
// desk re-filters through GmZoneViewProvider, and the Discord role grants land
// a moment later in the action's after() — they used to be awaited inside the
// click, which is what made it take twenty seconds.
export default function GmZoneRail({ zones, selectedIds }) {
  const [selected, setSelected] = useState(() => new Set(selectedIds ?? []));
  const [error, setError] = useState(null);
  const publish = useSetVisibleZoneNames();

  // The last selection the server confirmed. A failed write rolls back to
  // THIS, not to whatever was on screen an instant ago: mid-burst those are
  // different, and only one of them is known to be real.
  const confirmed = useRef(new Set(selectedIds ?? []));
  const latest = useRef(selected);
  const timer = useRef(null);

  const flush = useCallback(async () => {
    const next = latest.current;
    const result = await setVisibleZonesAction([...next]);
    if (result?.ok) {
      confirmed.current = next;
      // Only publish if nothing newer has been clicked since — otherwise this
      // stale answer would fight the click the GM just made.
      if (latest.current === next) publish?.(result.zoneNames ?? null);
      setError(null);
      return;
    }
    latest.current = confirmed.current;
    setSelected(confirmed.current);
    setError(result?.error ?? "Couldn't save that.");
  }, [publish]);

  const commit = (next) => {
    setSelected(next);
    setError(null);
    latest.current = next;
    // Paint the desk immediately off the names we already hold; the server
    // only confirms.
    publish?.(
      next.size > 0 ? zones.filter((z) => next.has(z.id)).map((z) => z.name) : null,
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SETTLE_MS);
  };

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

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
      <div className="chip-row" role="group" aria-label="Zones I see">
        <button
          type="button"
          className="chip"
          data-active={all || undefined}
          aria-pressed={all}
          onClick={() => commit(new Set())}
        >
          All
        </button>
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className="chip"
            data-active={selected.has(zone.id) || undefined}
            aria-pressed={selected.has(zone.id)}
            onClick={() => toggle(zone.id)}
          >
            {zone.name}
          </button>
        ))}
      </div>
      {error && <p className="form-error text-xs">{error}</p>}
    </div>
  );
}
