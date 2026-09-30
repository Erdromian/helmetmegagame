"use client";

import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import Pager from "@/app/components/Pager";
import ChipLabel from "@/app/components/ChipLabel";

// The same table engine every other roster uses (DESIGN-SYSTEM §5, §5a). No
// GM notes, no messaging, no edit actions — a lookup, not a desk.

const COLS = 7;

export default function EconRosterTable({ rows }) {
  // The search runs over every row the page loaded — the whole ALIVE roster —
  // and the pager cuts the matches afterwards, so a hit on page three is
  // found from page one. A tag's name is a search field too: "pickaxe" lists
  // everyone holding one, which is the question this page is for.
  const { pageRows, query, setQuery, sort, toggleSort, page, totalPages, total, setPage } = useTableState({
    rows,
    searchFields: [(r) => r.name, (r) => r.location, (r) => r.zone, (r) => r.tags.map((ct) => ct.tag.name).join(" ")],
    filterDefs: [],
    initialSort: { key: "name", dir: "asc" },
    pageSize: 50,
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={[]}
        filters={{}}
        setFilters={() => {}}
        options={{}}
        query={query}
        setQuery={setQuery}
        searchLabel="Search"
        searchPlaceholder="Name, zone, location, tag…"
      />
      <TableScroll>
        <thead>
          <tr>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="zone" sort={sort} onSort={toggleSort} />
            <SortHeader label="Location" sortKey="location" sort={sort} onSort={toggleSort} />
            <SortHeader label="Hunger" sortKey="hunger" sort={sort} onSort={toggleSort} />
            <SortHeader label="⬢ on hand" sortKey="resources" sort={sort} onSort={toggleSort} />
            <SortHeader label="¢ (obols + banked)" sortKey="totalObols" sort={sort} onSort={toggleSort} />
            <th scope="col">Economic tags</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <EmptyRow cols={COLS}>No ALIVE characters found.</EmptyRow>
          ) : (
            pageRows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.zone ?? "—"}</td>
                <td>{r.location ?? "—"}</td>
                <td>{r.hunger}</td>
                <td>{r.resources}</td>
                <td>
                  {r.obols} on hand
                  {r.banked > 0 && <span className="chip-quiet"> + {r.banked} banked</span>}
                </td>
                <td>
                  {r.tags.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {r.tags.map((ct) => (
                        <ChipLabel key={ct.tag.slug} tag={ct.tag} quantity={ct.quantity} />
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableScroll>
      <Pager page={page} totalPages={totalPages} total={total} unit="characters" onPage={setPage} />
    </div>
  );
}
