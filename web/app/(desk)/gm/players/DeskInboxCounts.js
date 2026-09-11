"use client";

import { useEffect, useMemo } from "react";
import { mergeRailRows, useRailPatches, useReadOverrides, reconcileReadOverrides } from "./liveInbox";
import { countInbox } from "./railCounts";
import { setNavUnread } from "@/app/components/navBadge";

// The header's "N unread · N awaiting" chips, counted over the same live-
// merged rows the rail shows — otherwise the header would say 3 beside a rail
// showing 4 for up to 30 seconds.
//
// It is also the one place that knows the desk's real unread number, so it
// publishes that to the nav rail's Players badge (navBadge.js). Doing it here
// rather than in the rail component means the two can never disagree.
export default function DeskInboxCounts({ rows, rowsAsOfMs }) {
  const patches = useRailPatches();
  const readOverrides = useReadOverrides();
  const merged = useMemo(
    () => mergeRailRows(rows, patches, rowsAsOfMs, readOverrides),
    [rows, patches, rowsAsOfMs, readOverrides],
  );
  const { unread, awaiting } = useMemo(() => countInbox(merged), [merged]);

  // Retiring an override is a store write, so it happens after the render that
  // used it — mergeRailRows stays a pure function of its arguments.
  useEffect(() => {
    reconcileReadOverrides(rows, rowsAsOfMs);
  }, [rows, rowsAsOfMs]);

  // Published from an effect, and withdrawn when the desk unmounts so the
  // rail goes back to the server's number on every other page.
  useEffect(() => {
    setNavUnread(unread);
    return () => setNavUnread(null);
  }, [unread]);

  // One muted run, not two chips. These are counts, and the header's chips
  // are reserved for the two facts the desk is keyed to (the turn and the
  // lock) — a count in a bubble beside them claimed the same rank as the turn
  // and made the header a row of six equal things.
  if (unread === 0 && awaiting === 0) return null;
  return (
    <span className="text-xs text-muted">
      {[unread > 0 ? `${unread} unread` : null, awaiting > 0 ? `${awaiting} awaiting` : null]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}
