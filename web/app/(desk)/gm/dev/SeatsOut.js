"use client";

import { useMemo } from "react";
import useNowTick from "@/app/components/useNowTick";
import { EmptyRow } from "@/app/components/EmptyState";
import { useTableState, SortHeader } from "@/app/components/DataTable";
import StatusPill from "@/app/components/StatusPill";

// Seats that have been handed out and not taken up (LOBBY.md). A GM could not
// see this anywhere before: the full lobby roster lives in the Game section,
// which is superadmin-only because it also holds Start, End and Restart Game.
//
// Read-only on purpose. The seat expires on its own (db/lib/lobbySweep.js) and
// re-offering one is a Start-Game concern, so there is nothing to press here —
// the question this answers is "who has been told, and are they going to
// answer".

const COLS = 4;

// "in 4h", "in 20m", or "overdue" once the window has run out. Whole units
// only: a seat with six hours on it does not need a seconds column.
function untilLabel(expiresAt, now) {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "overdue";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export default function SeatsOut({ rows }) {
  const now = useNowTick(60_000);
  // The shared engine, minus the chrome a four-column list does not need: no
  // search, no pager, just sortable headers — "which of these has run out"
  // was previously answered by reading every row (DESIGN-SYSTEM §5).
  // expiresAt can arrive as a Date or as an ISO string depending on the
  // caller; the engine sorts on the raw field, so give it a number.
  const sortable = useMemo(
    () => rows.map((r) => ({ ...r, expiresAtMs: r.expiresAt ? new Date(r.expiresAt).getTime() : null })),
    [rows],
  );
  const { pageRows, sort, toggleSort } = useTableState({
    rows: sortable,
    searchFields: [(r) => r.handle],
    filterDefs: [],
    initialSort: { key: "expiresAtMs", dir: "asc" },
    pageSize: 500,
  });

  return (
    <table className="data-table">
      <thead>
        <tr>
          <SortHeader label="Player" sortKey="handle" sort={sort} onSort={toggleSort} />
          <SortHeader label="Seat" sortKey="roleName" sort={sort} onSort={toggleSort} />
          <SortHeader label="Answers by" sortKey="expiresAtMs" sort={sort} onSort={toggleSort} />
          <th scope="col">Reminded</th>
        </tr>
      </thead>
      <tbody>
        {pageRows.length === 0 ? (
          <EmptyRow cols={COLS}>Every seat that went out has been taken up.</EmptyRow>
        ) : (
          pageRows.map((r) => {
            const overdue = r.expiresAt && new Date(r.expiresAt).getTime() <= now;
            return (
              <tr key={r.discordUserId}>
                <td>{r.handle}</td>
                <td>{r.roleName}</td>
                <td className="mono">
                  {overdue ? (
                    // A seat nobody answered is the one row on this table a
                    // GM is meant to act on, and it was drawn in the quietest
                    // thing the app has.
                    <StatusPill tone="warn">Overdue</StatusPill>
                  ) : (
                    untilLabel(r.expiresAt, now)
                  )}
                </td>
                <td className="text-muted">{r.reminded ? "yes" : "not yet"}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
