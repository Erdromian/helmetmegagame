"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import Select from "@/app/components/Select";
import CheckField from "@/app/components/CheckField";
import FormError from "@/app/components/FormError";
import { playSfx } from "@/app/components/sfx";
import { RING_TEXT, fillRingText } from "@lifeweb/db/lib/ringText";
import { registerRingAtTerminal } from "./actions";

// The Meister's terminal, second job (docs/systemdocs/RINGS.md): a smithed ring
// is registered here — given the doors of one or more seats and linked to an
// account. Only a ring the person at the desk is holding can be registered, and
// the server re-checks every part of it (db/lib/ringRegistry.js).
export default function RegisterRing({ rings = [], seats = [], accounts = [] }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [ringId, setRingId] = useState(rings[0]?.tagId ?? "");
  const [picked, setPicked] = useState(() => new Set());
  const [accountChoice, setAccountChoice] = useState("new");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const ring = rings.find((r) => r.tagId === ringId) ?? rings[0] ?? null;

  if (!ring) {
    return (
      <section className="panel p-5">
        <h2 className="panel-header">{RING_TEXT.registerTitle}</h2>
        <p className="mt-3 text-sm text-muted">{RING_TEXT.registerIntro}</p>
        <p className="mt-2 text-sm text-muted">{done ?? RING_TEXT.registerNone}</p>
      </section>
    );
  }

  // Nobody left to open an account for, so the first existing one is the default.
  const choice = ring.ownerGone && accountChoice === "new" ? (accounts[0]?.id ?? "") : accountChoice;
  // The engraved person already has an account (one each), so "new" links it.
  const ownerLabel = ring.ownerAccountId
    ? `${ring.ownerName}'s account`
    : fillRingText("registerAccountNew", { name: ring.ownerName ?? ring.initials });

  function toggle(slug) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await registerRingAtTerminal({
        ringTagId: ring.tagId,
        roleSlugs: [...picked],
        newAccount: choice === "new",
        accountId: choice === "new" ? null : choice,
      });
      if (!result.ok) {
        playSfx("refuse-money");
        setError(result.error);
        return;
      }
      setError(null);
      setDone(result.line);
      setPicked(new Set());
      refresh();
    });
  }

  return (
    <section className="panel p-5">
      <h2 className="panel-header">{RING_TEXT.registerTitle}</h2>
      <p className="mt-3 text-sm text-muted">{RING_TEXT.registerIntro}</p>
      {done && <p className="mt-2 text-sm">{done}</p>}

      <div className="mt-4 flex flex-col gap-4">
        {rings.length > 1 && (
          <div className="field">
            <label className="field-label" htmlFor="register-ring-pick">
              Ring
            </label>
            <Select id="register-ring-pick" value={ring.tagId} onChange={(e) => setRingId(e.target.value)}>
              {rings.map((r) => (
                <option key={r.tagId} value={r.tagId}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {rings.length === 1 && <p className="text-sm">{ring.name}</p>}

        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <legend className="field-label mb-1">{RING_TEXT.registerRoles}</legend>
          {seats.map((seat) => (
            <CheckField
              key={seat.slug}
              id={`register-seat-${seat.slug}`}
              checked={picked.has(seat.slug)}
              disabled={!seat.allowed}
              title={seat.allowed ? undefined : fillRingText("registerNeedsAuth", { role: seat.name, item: seat.needs })}
              onChange={() => toggle(seat.slug)}
            >
              {seat.name}
              {seat.needs && <span className="text-xs text-muted"> · {seat.needs}</span>}
            </CheckField>
          ))}
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="register-account">
            Account
          </label>
          <Select id="register-account" value={choice} onChange={(e) => setAccountChoice(e.target.value)}>
            {!ring.ownerGone && <option value="new">{ownerLabel}</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {RING_TEXT.registerAccountExisting}: {a.holderName} · {a.fingerprint}
              </option>
            ))}
          </Select>
        </div>

        <FormError>{error}</FormError>
        <div>
          <button
            type="button"
            className="btn"
            disabled={pending || !choice}
            onClick={submit}
          >
            {RING_TEXT.registerConfirm}
          </button>
        </div>
      </div>
    </section>
  );
}
