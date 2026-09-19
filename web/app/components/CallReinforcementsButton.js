"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import { REINFORCEMENTS, MAX_REINFORCEMENTS_PER_CALL } from "@/lib/lateJoin";
import { callReinforcements } from "@/app/(app)/character/bastardActions";

// The Bastard's button, on the sheet's verb strip beside the horn. It does not
// summon anybody: it OPENS A SEAT (db/lib/lateJoin.js) that a real player then
// takes from the creation picker's Special section.
//
// The prices are ¢, paid in ¢ or ⬢ at par (DEPOT.md §0). The server re-derives
// every one of them from the same catalog — a posted price is never trusted.
export default function CallReinforcementsButton() {
  const [open, setOpen] = useState(false);
  const [roleSlug, setRoleSlug] = useState(REINFORCEMENTS[0].roleSlug);
  const [quantity, setQuantity] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const picked = REINFORCEMENTS.find((r) => r.roleSlug === roleSlug) ?? REINFORCEMENTS[0];
  const total = picked.price * quantity;

  function onSubmit() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await callReinforcements({ roleSlug, quantity });
      if (result?.ok) {
        setDone(result.message ?? "Called.");
        setOpen(false);
      } else {
        setError(result?.error ?? "Couldn't call them.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn action-strip-item"
        onClick={() => setOpen((v) => !v)}
        // The hover says what it costs, because the button itself cannot: the
        // price depends on who you call.
        title="Spend Resources or obols to call in reinforcements."
        aria-expanded={open}
      >
        Call reinforcements
      </button>

      {open && (
        <div className="panel flex flex-wrap items-end gap-2 p-3">
          <label className="field">
            <span>Who</span>
            <Select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)}>
              {REINFORCEMENTS.map((r) => (
                <option key={r.roleSlug} value={r.roleSlug}>
                  {r.name} — {r.price} ¢
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>How many</span>
            <input
              type="number"
              min="1"
              max={MAX_REINFORCEMENTS_PER_CALL}
              value={quantity}
              onChange={(e) => setQuantity(Math.trunc(Number(e.target.value)) || 1)}
              className="w-20"
            />
          </label>
          <span className="mono text-sm">{total} ¢</span>
          <button type="button" className="btn" onClick={onSubmit} disabled={pending}>
            {pending ? "Calling…" : "Call"}
          </button>
        </div>
      )}

      {done ? <span className="text-muted text-sm">{done}</span> : null}
      <FormError>{error}</FormError>
    </>
  );
}
