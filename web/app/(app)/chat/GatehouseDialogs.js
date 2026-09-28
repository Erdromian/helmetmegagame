"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import { TableScroll } from "@/app/components/DataTable";
import StackPicker, { pickedLines } from "@/app/components/StackRow";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  GATEHOUSE_TEXT as T,
  REQUEST_TEXT_MAX,
  DOCUMENT_FIELD_MAX,
} from "@lifeweb/db/lib/gatehouseText";
import {
  gatePassageView,
  gateRequestPassage,
  gateProcessView,
  gateHistory,
  gateApprove,
  gateDeny,
  gateMagma,
  gateDocumentsView,
  gateApproveDocuments,
  gateDenyDocuments,
} from "./gatehouseActions";

// The Town Gatehouse's dialogs (Incarn and gates.docx,
// docs/systemdocs/GATEHOUSE.md): asking to pass at a window, the clerk's
// Process Requests terminal, and Create Documents. Opened from
// ./PlacePanel.js#usePlaceActions like every other fixture. Every rule is in
// db/lib/gatehouse.js; this is the shape of the pages, and nothing here is
// trusted — the server re-reads who is standing where on every press.

// Loads a view once, and again on demand. `load` must be a stable server action.
function useView(load, arg) {
  const [state, setState] = useState(null);
  const key = JSON.stringify(arg ?? null);
  const reload = useCallback(() => {
    load(arg)
      .then((res) =>
        setState(res ?? { ok: false, error: "Something went wrong." }),
      )
      .catch(() => setState({ ok: false, error: "Something went wrong." }));
    // `key` stands in for `arg`, which is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, key]);
  useEffect(() => {
    let cancelled = false;
    load(arg)
      .then((res) => {
        if (!cancelled)
          setState(res ?? { ok: false, error: "Something went wrong." });
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: "Something went wrong." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, key]);
  return [state, reload];
}

function Loading({ title, onClose }) {
  return (
    <Modal open title={title} onClose={onClose}>
      <p className="text-sm text-muted">The screen flickers on…</p>
    </Modal>
  );
}

function Refused({ title, error, onClose }) {
  return (
    <Modal open title={title} onClose={onClose}>
      <FormError>{error}</FormError>
    </Modal>
  );
}

// "Dagger, Obol x 12" — an offer or a hand-over, in one line.
function linesText(lines) {
  if (!lines?.length) return null;
  return lines
    .map((l) => (l.quantity > 1 ? `${l.name} x ${l.quantity}` : l.name))
    .join(", ");
}

// ─── Request Passage ──────────────────────────────────────────────────────

export function PassageDialog({ entry, onClose, onDone }) {
  const [state] = useView(gatePassageView, { roomId: entry.roomId });
  const [text, setText] = useState(null);
  const [picks, setPicks] = useState(null);
  const { run, pending, error } = useActionRunner();

  if (!state) return <Loading title={T.requestTitle} onClose={onClose} />;
  if (!state.ok)
    return (
      <Refused title={T.requestTitle} error={state.error} onClose={onClose} />
    );

  // A request already waiting opens pre-filled, so sending again edits it.
  const draft = text ?? state.pending?.text ?? "";
  const chosen =
    picks ??
    Object.fromEntries(
      (state.pending?.offered ?? []).map((l) => [l.tagId, String(l.quantity)]),
    );
  const rows = state.things.map((t) => ({
    id: t.tagId,
    name: t.name,
    held: t.quantity,
  }));

  return (
    <Modal open title={T.requestTitle} onClose={onClose}>
      <div className="gate-dialog">
        <p className="text-sm text-muted">{state.intro}</p>
        {state.pending && <p className="text-sm">{T.requestWaiting}</p>}
        <label className="field">
          <span className="field-label">{T.requestTextLabel}</span>
          <textarea
            rows={4}
            maxLength={REQUEST_TEXT_MAX}
            value={draft}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <section className="gate-group">
          <p className="group-label">{T.requestOfferLabel}</p>
          <StackPicker
            rows={rows}
            picks={chosen}
            onChange={setPicks}
            emptyLabel={T.requestOfferNone}
            disabled={pending}
          />
        </section>
        <FormError>{error}</FormError>
      </div>
      <div className="modal-actions modal-actions--sticky">
        <button
          type="button"
          className="btn"
          disabled={pending || !draft.trim()}
          onClick={() =>
            run(
              gateRequestPassage,
              {
                roomId: entry.roomId,
                text: draft,
                offered: pickedLines(chosen),
              },
              {
                onOk: (res) => {
                  onDone(res);
                  onClose();
                },
              },
            )
          }
        >
          {T.requestSend}
        </button>
      </div>
    </Modal>
  );
}

// ─── Process Requests ─────────────────────────────────────────────────────

function RequestRow({ row, checked, onPick }) {
  const offer = linesText(row.offered);
  return (
    <label className="gate-request" data-checked={checked ? "" : undefined}>
      <input
        type="radio"
        name="gate-request"
        checked={checked}
        onChange={() => onPick(row.id)}
      />
      <span className="gate-request-body">
        <span className="gate-request-who">{row.who}</span>
        <span className="gate-request-text">{row.text}</span>
        <span className="gate-request-offer">
          {T.requestOfferLabel}: {offer ?? T.offeredNone}
        </span>
      </span>
    </label>
  );
}

function RequestGroup({ title, rows, picked, onPick }) {
  return (
    <section className="gate-group">
      <p className="group-label">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{T.groupEmpty}</p>
      ) : (
        rows.map((row) => (
          <RequestRow
            key={row.id}
            row={row}
            checked={picked === row.id}
            onPick={onPick}
          />
        ))
      )}
    </section>
  );
}

function ApproveScreen({ request, yours, onBack, onApproved }) {
  const [take, setTake] = useState({});
  const [give, setGive] = useState({});
  const { run, pending, error } = useActionRunner();
  const offerRows = request.offered.map((l) => ({
    id: l.tagId,
    name: l.name,
    held: l.quantity,
  }));
  const yourRows = yours.map((l) => ({
    id: l.tagId,
    name: l.name,
    held: l.quantity,
  }));

  return (
    <>
      <div className="gate-dialog">
        <div className="gate-request">
          <span className="gate-request-body">
            <span className="gate-request-who">{request.who}</span>
            <span className="gate-request-text">{request.text}</span>
          </span>
        </div>
        <p className="text-sm text-muted">{T.approveIntro}</p>
        <section className="gate-group">
          <p className="group-label">{T.approveOffered}</p>
          <StackPicker
            rows={offerRows}
            picks={take}
            onChange={setTake}
            emptyLabel={T.offeredNone}
            disabled={pending}
          />
        </section>
        <section className="gate-group">
          <p className="group-label">{T.approveYours}</p>
          <StackPicker
            rows={yourRows}
            picks={give}
            onChange={setGive}
            emptyLabel={T.approveNothing}
            disabled={pending}
          />
        </section>
        <FormError>{error}</FormError>
      </div>
      <div className="modal-actions modal-actions--sticky">
        <button
          type="button"
          className="btn-secondary mr-auto"
          disabled={pending}
          onClick={onBack}
        >
          {T.back}
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            run(
              gateApprove,
              {
                passageId: request.id,
                keep: pickedLines(take),
                give: pickedLines(give),
              },
              { onOk: onApproved },
            )
          }
        >
          {T.approveConfirm}
        </button>
      </div>
    </>
  );
}

function HistoryScreen({ onBack }) {
  const [state] = useView(gateHistory, null);
  return (
    <>
      {!state && <p className="text-sm text-muted">The screen flickers on…</p>}
      {state && !state.ok && <FormError>{state.error}</FormError>}
      {state?.ok && state.rows.length === 0 && (
        <EmptyState>{T.historyEmpty}</EmptyState>
      )}
      {state?.ok && state.rows.length > 0 && (
        <div className="gate-list">
          {state.rows.map((row) => (
            <div
              key={row.id}
              className="gate-request"
              data-outcome={row.status}
            >
              <span className="gate-request-body">
                <span className="gate-request-who">
                  {row.who} · {row.asked} ·{" "}
                  <span
                    className={row.status === "APPROVED" ? "" : "text-danger"}
                  >
                    {row.outcome}
                  </span>
                </span>
                <span className="gate-request-text">{row.text}</span>
                {linesText(row.kept) && (
                  <span className="gate-request-offer">
                    {T.historyKept}: {linesText(row.kept)}
                  </span>
                )}
                {linesText(row.given) && (
                  <span className="gate-request-offer">
                    {T.historyGiven}: {linesText(row.given)}
                  </span>
                )}
                <span className="gate-request-offer">{row.by}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions modal-actions--sticky">
        <button
          type="button"
          className="btn-secondary mr-auto"
          onClick={onBack}
        >
          {T.back}
        </button>
      </div>
    </>
  );
}

export function ProcessRequestsDialog({ onClose, onDone }) {
  const [state, reload] = useView(gateProcessView, null);
  const [picked, setPicked] = useState(null);
  const [screen, setScreen] = useState("list");
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  if (!state) return <Loading title={T.processTitle} onClose={onClose} />;
  if (!state.ok)
    return (
      <Refused title={T.processTitle} error={state.error} onClose={onClose} />
    );

  const all = [...state.into, ...state.outOf];
  const request = all.find((r) => r.id === picked) ?? null;
  const done = (res) => {
    onDone(res);
    setPicked(null);
    setScreen("list");
    reload();
  };

  if (screen === "approve" && request) {
    return (
      <Modal open title={T.approveTitle} onClose={onClose} width="wide">
        <ApproveScreen
          request={request}
          yours={state.yours}
          onBack={() => setScreen("list")}
          onApproved={done}
        />
      </Modal>
    );
  }
  if (screen === "history") {
    return (
      <Modal open title={T.historyTitle} onClose={onClose} width="wide">
        <HistoryScreen onBack={() => setScreen("list")} />
      </Modal>
    );
  }

  async function magma() {
    const ok = await confirm({
      title: T.magma,
      message: T.magmaConfirm,
      confirmLabel: T.magmaConfirmLabel,
    });
    if (!ok) return;
    run(gateMagma, undefined, { onOk: done });
  }

  return (
    <Modal
      open
      title={T.processTitle}
      onClose={onClose}
      width="wide"
      // The doc's "small button in the corner".
      actions={
        <button
          type="button"
          className="btn-quiet"
          onClick={() => setScreen("history")}
        >
          {T.history}
        </button>
      }
    >
      <div className="gate-list">
        <RequestGroup
          title={T.groupIn}
          rows={state.into}
          picked={picked}
          onPick={setPicked}
        />
        <RequestGroup
          title={T.groupOut}
          rows={state.outOf}
          picked={picked}
          onPick={setPicked}
        />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions modal-actions--sticky">
        <button
          type="button"
          className="btn-danger mr-auto"
          disabled={pending}
          onClick={magma}
        >
          {T.magma}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending || !request}
          onClick={() =>
            run(gateDeny, { passageId: request?.id }, { onOk: done })
          }
        >
          {T.deny}
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending || !request}
          onClick={() => setScreen("approve")}
        >
          {T.approve}
        </button>
      </div>
    </Modal>
  );
}

// ─── Create Documents ─────────────────────────────────────────────────────

function SubmissionRow({ row, onDone }) {
  const [name, setName] = useState("");
  const [occupation, setOccupation] = useState("");
  const { run, pending, error } = useActionRunner();
  return (
    <div className="gate-request">
      <span className="gate-request-body">
        <span className="gate-request-who">{row.who}</span>
        <span className="gate-fields">
          <label className="field">
            <span className="field-label">{T.nameLabel}</span>
            <input
              value={name}
              maxLength={DOCUMENT_FIELD_MAX}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{T.occupationLabel}</span>
            <input
              value={occupation}
              maxLength={DOCUMENT_FIELD_MAX}
              onChange={(e) => setOccupation(e.target.value)}
            />
          </label>
        </span>
        <FormError>{error}</FormError>
        <span className="gate-row-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              run(gateDenyDocuments, { submissionId: row.id }, { onOk: onDone })
            }
          >
            {T.denyButton}
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || !name.trim() || !occupation.trim()}
            onClick={() =>
              run(
                gateApproveDocuments,
                { submissionId: row.id, name, occupation },
                { onOk: onDone },
              )
            }
          >
            {T.printButton}
          </button>
        </span>
      </span>
    </div>
  );
}

export function DocumentsDialog({ onClose, onDone }) {
  const [state, reload] = useView(gateDocumentsView, null);
  if (!state) return <Loading title={T.createTitle} onClose={onClose} />;
  if (!state.ok)
    return (
      <Refused title={T.createTitle} error={state.error} onClose={onClose} />
    );
  const done = (res) => {
    onDone(res);
    reload();
  };

  return (
    <Modal open title={T.createTitle} onClose={onClose} width="wide">
      <div className="gate-dialog">
        <section className="gate-group">
          <p className="group-label">{T.pendingTitle}</p>
          {state.pending.length === 0 ? (
            <p className="text-sm text-muted">{T.pendingEmpty}</p>
          ) : (
            <div className="gate-list">
              {state.pending.map((row) => (
                <SubmissionRow key={row.id} row={row} onDone={done} />
              ))}
            </div>
          )}
        </section>
        <section className="gate-group">
          <p className="group-label">{T.registerTitle}</p>
          {state.register.length === 0 ? (
            <p className="text-sm text-muted">{T.registerEmpty}</p>
          ) : (
            <TableScroll minWidth="30rem">
              <thead>
                <tr>
                  <th>{T.nameLabel}</th>
                  <th>{T.occupationLabel}</th>
                  <th>{T.registerAccountHeader}</th>
                  <th>{T.registerKindHeader}</th>
                </tr>
              </thead>
              <tbody>
                {state.register.map((row) => (
                  <tr key={row.key}>
                    <td>{row.name}</td>
                    <td className="text-muted">{row.occupation || "—"}</td>
                    <td className="mono text-muted">
                      {row.fingerprint || "—"}
                    </td>
                    <td className="text-muted">{row.kind}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          )}
        </section>
      </div>
    </Modal>
  );
}
