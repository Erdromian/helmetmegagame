"use client";

import { useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import CheckField from "@/app/components/CheckField";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import InfoIcon from "@/app/components/InfoIcon";
import Pager from "@/app/components/Pager";
import { FilterBar, TableScroll, SortHeader, useTableState } from "@/app/components/DataTable";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { MEISTER_TERMINAL_TEXT as T, fillMeisterText, signedObols } from "@lifeweb/db/lib/meisterTerminalText";
import {
  meisterTerminalView,
  meisterTerminalLedger,
  meisterSetTax,
  meisterSetBalance,
  meisterCloseAccount,
  meisterSetWage,
  meisterConnectRing,
} from "./actions";

// The Meister's Terminal on the Meister's Study wall (docs/systemdocs/MEISTERY.md):
// the totals and the tax on top, and four tabs under them — every account,
// the daily wages, connecting a ring, and the ledger. Every rule is in
// db/lib/meisterTerminal.js; this is the shape of the page. Every write
// re-reads the terminal, because the books are shared and somebody else may
// have moved them since this opened.

function classLabel(value) {
  if (value === "OFFSHORE") return T.classOffshore;
  if (value === "CROWN") return T.classCrown;
  if (value === "TREASURY") return T.classTreasury;
  return "—";
}

function wageLabel(wage) {
  if (!wage?.source) return T.wageNone;
  const tail = wage.source === "job" ? T.wageFromJob : T.wageOwn;
  return `${signedObols(wage.amount)} · ${tail}`;
}

export default function MeisterTerminalDialog({ entry, onClose, onDone }) {
  const roomId = entry.roomId;
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("accounts");
  const [taxDraft, setTaxDraft] = useState(null);
  const { run, pending, error, setError } = useActionRunner({ refuseSfx: "refuse-money" });

  useEffect(() => {
    let cancelled = false;
    meisterTerminalView({ roomId })
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: T.noTerminal });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const reread = () =>
    meisterTerminalView({ roomId })
      .then((next) => setState(next?.ok ? next : { ok: false, error: next?.error ?? T.noTerminal }))
      .catch(() => {});
  const act = (fn, args, after) =>
    run(fn, { roomId, ...args }, {
      onOk: (res) => {
        onDone(res);
        after?.(res);
        reread();
      },
    });

  if (!state) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <p className="text-sm text-muted">{T.loading}</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  const tax = taxDraft ?? String(state.taxRate);
  const tabs = [
    ["accounts", T.tabAccounts],
    ["wages", T.tabWages],
    ["rings", T.tabRings],
    ["ledger", T.tabLedger],
  ];

  return (
    <Modal open title={T.title} onClose={onClose} width="widest">
      <dl className="depot-totals">
        <div className={state.short ? "text-danger" : undefined}>
          <dt>{T.totalVault}</dt>
          <dd className="mono">{state.vault} ¢</dd>
        </div>
        <div>
          <dt>{T.totalClaimed}</dt>
          <dd className="mono">{state.claims} ¢</dd>
        </div>
        <div>
          <dt>{T.totalOnOrder}</dt>
          <dd className="mono">{state.onOrder} ¢</dd>
        </div>
        <div>
          <dt>{T.totalTax}</dt>
          <dd className="mono">{state.taxRate}%</dd>
        </div>
        <div>
          <dt>{T.totalWages}</dt>
          <dd className="mono">
            +{state.dailyBill.credit} / -{state.dailyBill.debit} ¢
          </dd>
        </div>
      </dl>
      {state.short && <p className="text-sm text-danger">{T.short}</p>}

      <div className="field">
        <label className="field-label" htmlFor="meister-tax">
          {T.taxLabel} <InfoIcon text={T.taxHelp} />
        </label>
        <div className="flex items-center gap-3">
          <input
            id="meister-tax"
            type="number"
            className="w-24"
            min={0}
            max={100}
            value={tax}
            onChange={(e) => setTaxDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || tax === String(state.taxRate)}
            onClick={() => act(meisterSetTax, { rate: Number(tax) }, () => setTaxDraft(null))}
          >
            {T.taxSet}
          </button>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-active={tab === key}
            className="tab-item"
            onClick={() => {
              setError(null);
              setTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <FormError>{error}</FormError>
      {tab === "accounts" && <AccountsTab state={state} act={act} pending={pending} />}
      {tab === "wages" && <WagesTab state={state} act={act} pending={pending} />}
      {tab === "rings" && <RingsTab state={state} act={act} pending={pending} />}
      {tab === "ledger" && <LedgerTab roomId={roomId} accounts={state.accounts} />}
    </Modal>
  );
}

// ─── Accounts ────────────────────────────────────────────────────────────────

const ACCOUNT_SEARCH = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.roleName];
const ACCOUNT_FILTERS = [
  { key: "class", label: T.colClass, value: (r) => classLabel(r.class) },
  { key: "job", label: T.colJob, value: (r) => r.roleName || "—" },
];

function AccountsTab({ state, act, pending }) {
  const [selectedId, setSelectedId] = useState(null);
  const rows = state.accounts.map((a) => ({ ...a, wageAmount: a.wage?.amount ?? 0 }));
  const table = useTableState({
    rows,
    searchFields: ACCOUNT_SEARCH,
    filterDefs: ACCOUNT_FILTERS,
    initialSort: { key: "balance", dir: "desc" },
  });
  const selected = selectedId ? rows.find((a) => a.id === selectedId) : null;

  if (selected) {
    return <AccountCard account={selected} act={act} pending={pending} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={ACCOUNT_FILTERS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel={T.searchAccounts}
      />
      {table.total === 0 ? (
        <EmptyState>{T.noAccounts}</EmptyState>
      ) : (
        <TableScroll minWidth="36rem">
          <thead>
            <tr>
              <SortHeader label={T.colHolder} sortKey="holderName" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label={T.colFingerprint} sortKey="fingerprint" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label={T.colJob} sortKey="roleName" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label={T.colBalance} sortKey="balance" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label={T.colWage} sortKey="wageAmount" sort={table.sort} onSort={table.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {table.pageRows.map((row) => (
              <tr key={row.id} className="cursor-pointer" onClick={() => setSelectedId(row.id)}>
                <td>
                  <button type="button" className="text-left hover:underline" onClick={() => setSelectedId(row.id)}>
                    {row.holderName}
                  </button>
                  {row.locked && <span className="chip ml-2">{T.lockedBadge}</span>}
                </td>
                <td className="mono text-muted">{row.fingerprint}</td>
                <td className="text-muted">{row.roleName || "—"}</td>
                <td className={row.balance < 0 ? "mono text-danger" : "mono"}>{row.balance} ¢</td>
                <td className="mono text-muted">{wageLabel(row.wage)}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
      <Pager page={table.page} totalPages={table.totalPages} total={table.total} unit="accounts" onPage={table.setPage} />
    </div>
  );
}

function AccountCard({ account, act, pending, onBack }) {
  const confirm = useConfirm();
  const [balance, setBalance] = useState(String(account.balance));
  const ownWage = account.wage?.source === "character" ? String(account.wage.amount) : "";
  const [wage, setWage] = useState(ownWage);

  // Confirm first, then the action — never a confirm inside a transition
  // (DESIGN-SYSTEM.md §8).
  async function close() {
    const ok = await confirm({
      title: T.deleteButton,
      message: fillMeisterText("deleteConfirm", { name: account.holderName }),
      confirmLabel: T.deleteButton,
    });
    if (ok) act(meisterCloseAccount, { accountId: account.id }, onBack);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className="btn-quiet" onClick={onBack}>
          {T.backToAccounts}
        </button>
      </div>
      <h3>{account.holderName}</h3>
      <dl className="depot-totals">
        <div>
          <dt>{T.colFingerprint}</dt>
          <dd className="mono">{account.fingerprint}</dd>
        </div>
        <div>
          <dt>{T.colClass}</dt>
          <dd>{classLabel(account.class)}</dd>
        </div>
        <div>
          <dt>{T.colJob}</dt>
          <dd>{account.roleName || "—"}</dd>
        </div>
        <div>
          <dt>{T.colBalance}</dt>
          <dd className="mono">{account.balance} ¢</dd>
        </div>
        <div>
          <dt>{T.colWage}</dt>
          <dd className="mono">{wageLabel(account.wage)}</dd>
        </div>
      </dl>

      {account.locked ? (
        <p className="text-sm text-muted">{T.lockedNote}</p>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor="meister-balance">
              {T.balanceLabel}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="meister-balance"
                type="number"
                className="w-32"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={pending || balance === String(account.balance) || balance === ""}
                onClick={() => act(meisterSetBalance, { accountId: account.id, balance: Number(balance) })}
              >
                {T.balanceSet}
              </button>
            </div>
          </div>

          {account.status === "ALIVE" && account.characterId && (
            <div className="field">
              <label className="field-label" htmlFor="meister-own-wage">
                {T.wageLabel} <InfoIcon text={T.wagesHelp} />
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="meister-own-wage"
                  type="number"
                  className="w-32"
                  value={wage}
                  placeholder={account.wage?.source === "job" ? String(account.wage.amount) : ""}
                  onChange={(e) => setWage(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pending || wage === "" || wage === ownWage}
                  onClick={() => act(meisterSetWage, { characterId: account.characterId, amount: Number(wage) })}
                >
                  {T.wageSave}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pending || !ownWage}
                  onClick={() => act(meisterSetWage, { characterId: account.characterId, amount: null }, () => setWage(""))}
                >
                  {T.wageClear}
                </button>
              </div>
            </div>
          )}

          <div>
            <button type="button" className="btn-danger" disabled={pending} onClick={close}>
              {T.deleteButton}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Wages ───────────────────────────────────────────────────────────────────

const JOB_SEARCH = [(r) => r.name, (r) => r.groupName];

function WagesTab({ state, act, pending }) {
  const [drafts, setDrafts] = useState({});
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const jobs = useTableState({ rows: state.jobs, searchFields: JOB_SEARCH, filterDefs: [], pageSize: 12 });

  // Anybody living with an account who can be paid, for the add row.
  const payable = state.accounts.filter((a) => a.status === "ALIVE" && !a.locked && a.characterId);
  const draftOf = (job) => drafts[job.roleId] ?? (job.amount == null ? "" : String(job.amount));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{T.wagesHelp}</p>
      <p className="text-sm mono">
        {fillMeisterText("dailyBill", { credit: state.dailyBill.credit, debit: state.dailyBill.debit })}
      </p>

      <section className="flex flex-col gap-2">
        <h3>{T.wagesByJob}</h3>
        <FilterBar
          filterDefs={[]}
          filters={jobs.filters}
          setFilters={jobs.setFilters}
          options={jobs.options}
          query={jobs.query}
          setQuery={jobs.setQuery}
          searchLabel={T.colJob}
        />
        {jobs.pageRows.map((job) => {
          const draft = draftOf(job);
          const saved = job.amount == null ? "" : String(job.amount);
          return (
            <div key={job.roleId} className="terminal-ware">
              <div className="terminal-ware-text">
                <span className="chat-person-name">{job.name}</span>
                <span className="text-sm text-muted">
                  {job.groupName} · {fillMeisterText("jobHolders", { count: job.holders })}
                </span>
              </div>
              <input
                type="number"
                className="control w-20"
                aria-label={`${T.wageLabel} — ${job.name}`}
                value={draft}
                placeholder="0"
                onChange={(e) => setDrafts((d) => ({ ...d, [job.roleId]: e.target.value }))}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={pending || draft === "" || draft === saved}
                onClick={() =>
                  act(meisterSetWage, { roleId: job.roleId, amount: Number(draft) }, () =>
                    setDrafts((d) => ({ ...d, [job.roleId]: undefined })),
                  )
                }
              >
                {T.wageSave}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={pending || job.amount == null}
                onClick={() =>
                  act(meisterSetWage, { roleId: job.roleId, amount: null }, () =>
                    setDrafts((d) => ({ ...d, [job.roleId]: undefined })),
                  )
                }
              >
                {T.wageClear}
              </button>
            </div>
          );
        })}
        <Pager page={jobs.page} totalPages={jobs.totalPages} total={jobs.total} unit="jobs" onPage={jobs.setPage} />
      </section>

      <section className="flex flex-col gap-2">
        <h3>{T.wagesByCharacter}</h3>
        {state.characterWages.length === 0 && <p className="text-sm text-muted">{T.noCharacterWages}</p>}
        {state.characterWages.map((w) => (
          <div key={w.characterId} className="terminal-ware">
            <div className="terminal-ware-text">
              <span className="chat-person-name">{w.name}</span>
              {w.roleName && <span className="text-sm text-muted">{w.roleName}</span>}
            </div>
            <span className="mono text-sm">{signedObols(w.amount)}</span>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={() => act(meisterSetWage, { characterId: w.characterId, amount: null })}
            >
              {T.wageClear}
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <div className="field">
            <label className="field-label" htmlFor="meister-wage-who">
              {T.wagePickCharacter}
            </label>
            <Select id="meister-wage-who" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">—</option>
              {payable.map((a) => (
                <option key={a.characterId} value={a.characterId}>
                  {a.characterName}
                  {a.roleName ? ` · ${a.roleName}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="meister-wage-amount">
              {T.wageLabel}
            </label>
            <input
              id="meister-wage-amount"
              type="number"
              className="w-24"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || !who || amount === ""}
            onClick={() =>
              act(meisterSetWage, { characterId: who, amount: Number(amount) }, () => {
                setWho("");
                setAmount("");
              })
            }
          >
            {T.wageAdd}
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Rings ───────────────────────────────────────────────────────────────────

function RingsTab({ state, act, pending }) {
  const rings = state.rings ?? [];
  const seats = state.seats ?? [];
  const [ringId, setRingId] = useState(rings[0]?.tagId ?? "");
  const [picked, setPicked] = useState(() => new Set());
  const [accountChoice, setAccountChoice] = useState("new");

  const ring = rings.find((r) => r.tagId === ringId) ?? rings[0] ?? null;
  if (!ring) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{T.registerIntro}</p>
        <EmptyState>{T.registerNone}</EmptyState>
      </div>
    );
  }

  const accounts = state.accounts;
  // Nobody left to open an account for, so the first existing one is the default.
  const choice = ring.ownerGone && accountChoice === "new" ? (accounts[0]?.id ?? "") : accountChoice;
  // The engraved person already has an account (one each), so "new" links it.
  const ownerLabel = ring.ownerAccountId
    ? fillMeisterText("registerAccountOwn", { name: ring.ownerName })
    : fillMeisterText("registerAccountNew", { name: ring.ownerName ?? ring.initials });

  function toggle(slug) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{T.registerIntro}</p>
      <div className="field">
        <label className="field-label" htmlFor="meister-ring-pick">
          {T.ringLabel}
        </label>
        <Select id="meister-ring-pick" value={ring.tagId} onChange={(e) => setRingId(e.target.value)}>
          {rings.map((r) => (
            <option key={r.tagId} value={r.tagId}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <legend className="field-label mb-1">{T.registerRoles}</legend>
          {seats.map((seat) => (
            <CheckField
              key={seat.slug}
              id={`meister-seat-${seat.slug}`}
              checked={picked.has(seat.slug)}
              disabled={!seat.allowed}
              title={seat.allowed ? undefined : fillMeisterText("registerNeedsAuth", { role: seat.name, item: seat.needs })}
              onChange={() => toggle(seat.slug)}
            >
              {seat.name}
              {seat.needs && <span className="text-xs text-muted"> · {seat.needs}</span>}
            </CheckField>
          ))}
      </fieldset>

      <div className="field">
        <label className="field-label" htmlFor="meister-ring-account">
          {T.accountLabel}
        </label>
        <Select id="meister-ring-account" value={choice} onChange={(e) => setAccountChoice(e.target.value)}>
          {!ring.ownerGone && <option value="new">{ownerLabel}</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {T.registerAccountExisting}: {a.holderName} · {a.fingerprint}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <button
          type="button"
          className="btn"
          disabled={pending || !choice}
          onClick={() =>
            act(
              meisterConnectRing,
              {
                ringTagId: ring.tagId,
                roleSlugs: [...picked],
                newAccount: choice === "new",
                accountId: choice === "new" ? null : choice,
              },
              () => {
                setPicked(new Set());
                setRingId("");
              },
            )
          }
        >
          {T.registerConfirm}
        </button>
      </div>
    </div>
  );
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

const LEDGER_SEARCH = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.detail];
const LEDGER_FILTERS = [
  { key: "kind", label: T.colType, value: (r) => r.kind },
  { key: "class", label: T.colClass, value: (r) => classLabel(r.accountClass) },
];

function LedgerTab({ roomId, accounts }) {
  const [accountId, setAccountId] = useState("");
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    let cancelled = false;
    meisterTerminalLedger({ roomId, accountId: accountId || null })
      .then((res) => {
        if (!cancelled) setLedger(res);
      })
      .catch(() => {
        if (!cancelled) setLedger({ ok: false, error: T.noTerminal });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, accountId]);

  const table = useTableState({
    rows: ledger?.ok ? ledger.rows : [],
    searchFields: LEDGER_SEARCH,
    filterDefs: LEDGER_FILTERS,
    initialSort: { key: "at", dir: "desc" },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <label className="field-label" htmlFor="meister-ledger-account">
          {T.accountLabel}
        </label>
        <Select id="meister-ledger-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{T.ledgerAllAccounts}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.holderName} · {a.fingerprint}
            </option>
          ))}
        </Select>
      </div>
      {!ledger && <p className="text-sm text-muted">{T.loading}</p>}
      {ledger && !ledger.ok && <FormError>{ledger.error}</FormError>}
      {ledger?.ok && (
        <>
          <FilterBar
            filterDefs={LEDGER_FILTERS}
            filters={table.filters}
            setFilters={table.setFilters}
            options={table.options}
            query={table.query}
            setQuery={table.setQuery}
            searchLabel={T.searchLedger}
          />
          {table.total === 0 ? (
            <EmptyState>{T.ledgerEmpty}</EmptyState>
          ) : (
            <TableScroll minWidth="40rem">
              <thead>
                <tr>
                  <SortHeader label={T.colTurn} sortKey="turn" sort={table.sort} onSort={table.toggleSort} />
                  <SortHeader label={T.colHolder} sortKey="holderName" sort={table.sort} onSort={table.toggleSort} />
                  <SortHeader label={T.colType} sortKey="kind" sort={table.sort} onSort={table.toggleSort} />
                  <th>{T.colDetail}</th>
                  <SortHeader label={T.colAmount} sortKey="amount" sort={table.sort} onSort={table.toggleSort} />
                </tr>
              </thead>
              <tbody>
                {table.pageRows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono text-muted">{row.turn ?? "—"}</td>
                    <td>
                      {row.holderName || "—"}
                      {row.fingerprint && <span className="mono text-muted"> · {row.fingerprint}</span>}
                    </td>
                    <td className="text-muted">{row.kind}</td>
                    <td className="text-muted">{row.detail || "—"}</td>
                    <td className={row.amount < 0 ? "mono text-danger" : "mono"}>{signedObols(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          )}
          <Pager
            page={table.page}
            totalPages={table.totalPages}
            total={table.total}
            unit="transactions"
            onPage={table.setPage}
          />
        </>
      )}
    </div>
  );
}
