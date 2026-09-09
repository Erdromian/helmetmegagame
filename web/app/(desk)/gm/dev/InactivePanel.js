"use client";

// The inactivity report, with a way to act on it. It used to be a command-line
// script whose output a GM then had to carry to /gm/players by hand, one
// player at a time.
//
// Everything arrives flat from the page — the buckets are worked out by
// db/lib/inactivity.js on the server — so this file imports nothing from
// db/lib.
import { useMemo, useState, useTransition } from "react";

import CheckField from "@/app/components/CheckField";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { nudgeInactivePlayers } from "@/app/(app)/gm/dev/actions";

export default function InactivePanel({ rows, turn }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Confirm first, transition second (DESIGN-SYSTEM.md §8). Awaiting the
  // dialog inside the transition deadlocks: the prompt needs an immediate
  // render, the transition cannot commit until the promise settles, and the
  // promise cannot settle until somebody clicks a dialog that never mounted.
  async function send() {
    setError(null);
    setNote(null);
    const ok = await confirm({
      title: `Message ${picked.length} player${picked.length === 1 ? "" : "s"}?`,
      message: "It arrives as a DM and lands in their conversation on the player desk. ‡",
      confirmLabel: "Send it",
      cancelLabel: "Not yet",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await nudgeInactivePlayers({ characterIds: picked, text });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        if (!res?.sent) return;
      }
      setNote(`Sent to ${res.sent} player${res.sent === 1 ? "" : "s"}.`);
      setPicked([]);
      setText("");
    });
  }

  if (rows.length === 0) {
    return <EmptyState>Nobody has gone quiet. ‡</EmptyState>;
  }

  return (
    <div className="desk-card grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Pick" />
              <th scope="col">Character</th>
              <th scope="col">Why</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <CheckField
                    checked={pickedSet.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Pick ${r.name}`}
                  >
                    {""}
                  </CheckField>
                </td>
                <td>{r.name}</td>
                <td>
                  <span className="chip">{r.bucketLabel}</span>
                </td>
                <td className="mono text-sm text-muted">
                  {r.leftGuildAt ?? (r.lastActivityTurn == null ? "never" : `turn ${r.lastActivityTurn}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-quiet" onClick={() => setPicked(rows.map((r) => r.id))}>
            Select all
          </button>
          <button type="button" className="btn-quiet" onClick={() => setPicked([])}>
            Clear
          </button>
          <span className="mono text-sm text-muted">
            {picked.length} of {rows.length} selected
            {turn != null ? ` · turn ${turn}` : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Message</span>
          <textarea
            rows={7}
            value={text}
            placeholder="We have not seen you in a while — are you still playing? ‡"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn"
            disabled={pending || picked.length === 0 || !text.trim()}
            onClick={send}
          >
            {pending ? "Sending…" : "DM them"}
          </button>
          {note ? <span className="text-sm text-muted">{note}</span> : null}
          <FormError>{error}</FormError>
        </div>
      </div>
    </div>
  );
}
