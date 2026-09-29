"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import FormError from "@/app/components/FormError";
import { castMenuAbility } from "@/app/(app)/character/actions/bloodAbility";

// The Blood menu (docs/systemdocs/VAMPIRE.md §6) — mounts as the body of a
// Modal opened from TagRail.js, StorePanel.js's own shape: a list, one row
// per ability, each with its own "Use" button and (for the four abilities
// that need one) an inline input. `bloodMenu` is fully server-resolved —
// web/app/(app)/character/page.js computes each ability's current
// availability so this component only renders what the server already
// decided; the action itself re-checks everything regardless (a server
// action is a public endpoint, actions/bloodAbility.js's own header).
export default function BloodPanel({ bloodMenu, onDone }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [locationId, setLocationId] = useState("");
  const [message, setMessage] = useState("");
  const [enthralTarget, setEnthralTarget] = useState("");
  const [nourishTarget, setNourishTarget] = useState("");
  const [refresh] = useRefresh();

  const { bloodLevel, urgencyLabel, abilities, locations = [], incapacitatedHere = [], boundHere = [] } =
    bloodMenu;

  function use(ability, extra = {}) {
    setError("");
    startTransition(async () => {
      const result = await castMenuAbility({ abilityKey: ability.key, ...extra });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Blood: {bloodLevel} / 100 ({urgencyLabel})
      </p>
      <div className="flex flex-col gap-2">
        {abilities.map((ability) => (
          <div key={ability.key} className="panel">
            <div className="flex items-center justify-between gap-2">
              <div>
                <strong>{ability.name}</strong>
                <span className="text-sm text-muted"> — {ability.bloodCost} blood</span>
              </div>
              {ability.key !== "bat-form" && ability.key !== "solidarity" && ability.key !== "enthral" && ability.key !== "nourish" && (
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !ability.available}
                  onClick={() => use(ability)}
                >
                  Use
                </button>
              )}
            </div>
            <p className="text-sm text-muted">{ability.description}</p>
            {!ability.available && ability.reason && <p className="text-sm">{ability.reason}</p>}

            {ability.key === "bat-form" && (
              <div className="flex items-center gap-2">
                <select
                  className="field"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">Choose a location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !ability.available || !locationId}
                  onClick={() => use(ability, { locationId })}
                >
                  Fly
                </button>
              </div>
            )}

            {ability.key === "solidarity" && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="field"
                  placeholder={bloodMenu.copy?.messagePlaceholder ?? ""}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !ability.available || !message.trim()}
                  onClick={() => use(ability, { message })}
                >
                  Send
                </button>
              </div>
            )}

            {ability.key === "enthral" && (
              <div className="flex items-center gap-2">
                <select
                  className="field"
                  value={enthralTarget}
                  onChange={(e) => setEnthralTarget(e.target.value)}
                >
                  <option value="">Choose someone incapacitated here…</option>
                  {incapacitatedHere.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !ability.available || !enthralTarget}
                  onClick={() => use(ability, { targetCharacterId: enthralTarget })}
                >
                  Enthral
                </button>
              </div>
            )}

            {ability.key === "nourish" && (
              <div className="flex items-center gap-2">
                <select
                  className="field"
                  value={nourishTarget}
                  onChange={(e) => setNourishTarget(e.target.value)}
                >
                  <option value="">{bloodMenu.copy?.boundPlaceholder ?? ""}</option>
                  {boundHere.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !ability.available || !nourishTarget}
                  onClick={() => use(ability, { targetCharacterId: nourishTarget })}
                >
                  Nourish
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
