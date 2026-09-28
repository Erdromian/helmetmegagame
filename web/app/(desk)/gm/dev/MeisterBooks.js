"use client";

import { FilterBar, TableScroll, SortHeader, useTableState } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import { MEISTER_TERMINAL_TEXT as T, signedObols } from "@lifeweb/db/lib/meisterTerminalText";

// The Meister's books, read-only, for the superadmin (docs/systemdocs/MEISTERY.md).
// This replaced the read-only /treasury page a superadmin used to get: the
// terminal itself is a fixture on the Meister's Study wall now, and only the
// three rings work it. Every change made at it is on /gm/audit (Meister).

const SEARCH = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.roleName];
const FILTERS = [
  { key: "class", label: T.colClass, value: (r) => r.class },
  { key: "job", label: T.colJob, value: (r) => r.roleName || "—" },
];

function wageLabel(wage) {
  if (!wage?.source) return T.wageNone;
  return `${signedObols(wage.amount)} · ${wage.source === "job" ? T.wageFromJob : T.wageOwn}`;
}

export default function MeisterBooks({ books }) {
  const table = useTableState({
    rows: books.accounts,
    searchFields: SEARCH,
    filterDefs: FILTERS,
    initialSort: { key: "balance", dir: "desc" },
  });
  const jobWages = books.jobs.filter((f) => f.amount != null);

  return (
    <div className="flex flex-col gap-4">
      <dl className="depot-totals">
        <div className={books.short ? "text-danger" : undefined}>
          <dt>{T.totalVault}</dt>
          <dd className="mono">{books.vault} ¢</dd>
        </div>
        <div>
          <dt>{T.totalClaimed}</dt>
          <dd className="mono">{books.claims} ¢</dd>
        </div>
        <div>
          <dt>{T.totalOnOrder}</dt>
          <dd className="mono">{books.onOrder} ¢</dd>
        </div>
        <div>
          <dt>{T.totalTax}</dt>
          <dd className="mono">{books.taxRate}%</dd>
        </div>
        <div>
          <dt>{T.totalWages}</dt>
          <dd className="mono">
            +{books.dailyBill.credit} / -{books.dailyBill.debit} ¢
          </dd>
        </div>
      </dl>
      {books.short && <p className="text-sm text-danger">{T.short}</p>}

      <p className="text-sm text-muted">
        {T.wagesByJob}:{" "}
        {jobWages.length ? jobWages.map((f) => `${f.name} ${signedObols(f.amount)}`).join(", ") : T.wageNone}
      </p>

      <FilterBar
        filterDefs={FILTERS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel={T.searchAccounts}
      />
      <TableScroll minWidth="40rem">
        <thead>
          <tr>
            <SortHeader label={T.colHolder} sortKey="holderName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label={T.colFingerprint} sortKey="fingerprint" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label={T.colJob} sortKey="roleName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label={T.colClass} sortKey="class" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label={T.colBalance} sortKey="balance" sort={table.sort} onSort={table.toggleSort} />
            <th>{T.colWage}</th>
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((row) => (
            <tr key={row.id}>
              <td>
                {row.holderName}
                {row.locked && <span className="chip ml-2">{T.lockedBadge}</span>}
              </td>
              <td className="mono text-muted">{row.fingerprint}</td>
              <td className="text-muted">{row.roleName || "—"}</td>
              <td className="text-muted">{row.class}</td>
              <td className={row.balance < 0 ? "mono text-danger" : "mono"}>{row.balance} ¢</td>
              <td className="mono text-muted">{wageLabel(row.wage)}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <Pager page={table.page} totalPages={table.totalPages} total={table.total} unit="accounts" onPage={table.setPage} />
    </div>
  );
}
