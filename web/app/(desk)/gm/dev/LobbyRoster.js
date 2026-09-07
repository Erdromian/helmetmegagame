"use client";

import { useMemo } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";

// Who is in the lobby, and what they asked for. Read-only: the roll happens
// on Preview and Start (docs/systemdocs/LOBBY.md §3). After Start the same
// rows show what each player got and where their creation window stands.

const COLS = 9;

export default function LobbyRoster({ rows, started }) {
  const filterDefs = useMemo(
    () => [
      { key: "status", label: "Status", options: ["READY", "ASSIGNED", "CREATED", "DECLINED", "EXPIRED", "UNASSIGNED"], value: (r) => r.status },
      { key: "whitelisted", label: "Whitelist", options: ["Yes", "No"], value: (r) => (r.whitelisted ? "Yes" : "No") },
    ],
    [],
  );
  const {
    query, setQuery, filters, setFilters, sort, toggleSort,
    options, pageRows, page, setPage, total, totalPages,
  } = useTableState({
    rows,
    searchFields: [(r) => r.handle, (r) => r.high ?? "", (r) => r.assigned ?? ""],
    filterDefs,
    initialSort: { key: "readyAt", dir: "asc" },
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search"
        searchPlaceholder="Player or role…"
      />
      <TableScroll minWidth="1000px">
        <thead>
          <tr>
            <SortHeader label="Player" sortKey="handle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Ready" sortKey="readyAt" sort={sort} onSort={toggleSort} />
            <SortHeader label="High" sortKey="high" sort={sort} onSort={toggleSort} />
            <th scope="col">Med / Low</th>
            <th scope="col">Opt-ins</th>
            <th scope="col">WL</th>
            <SortHeader label="If nothing fits" sortKey="jobless" sort={sort} onSort={toggleSort} />
            <SortHeader label={started ? "Assigned" : "Status"} sortKey="assigned" sort={sort} onSort={toggleSort} />
            <th scope="col">{started ? "Window" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.discordUserId}>
              <td className="mono">{r.handle}</td>
              <td className="mono text-xs">{r.readyAt}</td>
              <td>{r.high ?? <span className="text-muted">—</span>}</td>
              <td className="mono text-xs">
                {r.medium} / {r.low}
              </td>
              <td>
                {r.optIns.length === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {r.optIns.map((n) => (
                      <span key={n} className="chip">{n}</span>
                    ))}
                  </span>
                )}
              </td>
              <td>{r.whitelisted ? <span className="chip">WL</span> : <span className="text-muted">—</span>}</td>
              <td className="text-xs">{r.jobless}</td>
              <td>
                {started ? (
                  r.assigned ?? <span className="text-muted">{r.status === "UNASSIGNED" ? "lobby" : "—"}</span>
                ) : (
                  <span className="chip">{r.status}</span>
                )}
              </td>
              <td className="text-xs text-muted">
                {started ? `${r.status}${r.expiresAt ? ` · until ${r.expiresAt}` : ""}` : ""}
              </td>
            </tr>
          ))}
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={COLS}>
                <EmptyState title="Nobody has readied up." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </TableScroll>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
    </div>
  );
}
