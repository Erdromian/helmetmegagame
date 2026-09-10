"use client";

import { CANNOT_READ } from "@lifeweb/db/lib/reading";
import { TableScroll, SortHeader, FilterBar, useTableState } from "./DataTable";
import Pager from "./Pager";
import EmptyState from "./EmptyState";

const SEARCH_FIELDS = [(r) => r.what, (r) => r.who];
const FILTER_DEFS = [{ key: "dir", label: "In/Out", value: (r) => r.dir }];

// The books, inside the Silo tab (FACTIONS.md §4c). Officers with the key only,
// and the server has already decided that — this draws what it was handed.
//
// A section inside the silo panel rather than a panel of its own, so it reads
// as the second half of one thing: what is in there, then how it got there.
export default function SiloLedger({ rows, blocked }) {
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "at", dir: "desc" },
  });

  // One line for every cause. A blind officer and an illiterate one see the
  // same thing and neither is told which, the rule db/lib/reading.js exists to
  // hold — so this never says why, and never says it anywhere else either.
  // Drawn flat and italic like any other refusal (.paper-sheet-plain).
  if (blocked) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="section-title">Ledger</h3>
        <p className="paper-sheet-plain">{CANNOT_READ}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="section-title">Ledger</h3>

      {rows.length === 0 ? (
        <EmptyState>Nothing has moved in or out yet.</EmptyState>
      ) : (
        <>
          <FilterBar
            filterDefs={FILTER_DEFS}
            filters={table.filters}
            setFilters={table.setFilters}
            options={table.options}
            query={table.query}
            setQuery={table.setQuery}
            searchPlaceholder="What, or who…"
          />
          <TableScroll minWidth="34rem">
            <thead>
              <tr>
                <SortHeader label="Turn" sortKey="at" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="In/Out" sortKey="dir" sort={table.sort} onSort={table.toggleSort} />
                <th scope="col">What</th>
                <SortHeader label="Who" sortKey="who" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Resources" sortKey="delta" sort={table.sort} onSort={table.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((row) => (
                <tr key={row.id}>
                  <td className="mono text-muted">{row.turn ?? "—"}</td>
                  <td>{row.dir}</td>
                  <td className="text-muted">{row.what}</td>
                  <td>{row.who}</td>
                  <td
                    className={`mono ${row.delta > 0 ? "text-positive" : row.delta < 0 ? "text-danger" : "text-muted"}`}
                  >
                    {row.delta ? `${row.delta > 0 ? "+" : ""}${row.delta} ⬢` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <Pager
            page={table.page}
            totalPages={table.totalPages}
            total={table.total}
            unit="entries"
            onPage={table.setPage}
          />
        </>
      )}
    </section>
  );
}
