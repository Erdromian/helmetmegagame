"use client";

import { EmptyRow } from "@/app/components/EmptyState";
import {
  useTableState,
  SortHeader,
  FilterBar,
  TableScroll,
} from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

// Everything written in the Feedback composer, newest first. The same
// DataTable toolkit CharactersTable.js uses — `rows` is a flat DTO from
// page.js, with createdAt already an epoch number so no Date crosses the
// boundary.

const COL_COUNT = 4;

// The one filter worth having: a note from somebody in the game reads
// differently from one from a GM or a spectator who has no character.
const FILTER_DEFS = [
  { key: "who", label: "From", value: (f) => (f.characterName ? "A player" : "No character") },
];

const SEARCH_FIELDS = [(f) => f.discordUsername, (f) => f.characterName ?? "", (f) => f.body];

function when(epoch) {
  const d = new Date(epoch);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FeedbackTable({ rows }) {
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "createdAt", dir: "desc" },
  });

  return (
    <>
      <section className="panel flex flex-col gap-3 p-3">
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search feedback"
          searchPlaceholder="Name, character, words…"
        />
      </section>

      <TableScroll minWidth="720px">
        <thead>
          <tr>
            <SortHeader label="When" sortKey="createdAt" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Who" sortKey="discordUsername" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Character" sortKey="characterName" sort={table.sort} onSort={table.toggleSort} />
            <th>Feedback</th>
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((f) => (
            <tr key={f.id}>
              <td className="mono whitespace-nowrap">{when(f.createdAt)}</td>
              <td>{f.discordUsername}</td>
              <td className="text-muted">{f.characterName ?? "—"}</td>
              <td style={{ whiteSpace: "pre-wrap" }}>{f.body}</td>
            </tr>
          ))}
          {table.pageRows.length === 0 && (
            <EmptyRow cols={COL_COUNT}>No feedback yet.</EmptyRow>
          )}
        </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="notes"
        onPage={table.setPage}
      />
    </>
  );
}
