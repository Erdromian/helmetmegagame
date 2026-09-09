"use client";

// Antagonist objectives, one card per party (THREATS.md §6a). Everything here
// arrives as plain props from the page — rows already described and scored,
// the kinds a party may take, the pickable characters, the Locations already
// grouped by zone — so this file imports nothing from db/lib and the browser
// bundle stays clear of it.
//
// The status column is the game's answer in one word. The pin dropdown is the
// only sign a GM overrode it: a scripted kind offers "Game decides" as well as
// the two answers, a manual kind only the two.
import { useState, useTransition } from "react";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { addObjective, addStandardObjectives, pinObjective, removeObjective } from "../objectiveActions";

const PIN_VALUES = { auto: null, success: true, failed: false };

function pinKey(row) {
  if (row.source === "script") return "auto";
  return row.done ? "success" : "failed";
}

export default function ObjectivesPanel({ parties, characters, locations, weights, ended }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="section-title">Objectives</h3>
      {ended ? (
        <p className="text-sm text-muted">
          The game has ended and the reveal is already written. Changes here reach nobody unless the game is ended again.
        </p>
      ) : null}
      {/* A filling grid, not a stack. One card per party in a single column
          left three quarters of a wide desk empty, which is what made the
          section read as bubbles floating in the middle of the page. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {parties.map((party) => (
          <PartyCard key={party.key} party={party} characters={characters} locations={locations} weights={weights} />
        ))}
      </div>
    </section>
  );
}

function memberLine(party) {
  if (party.members.length === 0) return "nobody seated";
  return party.members.map((m) => (m.seat !== party.name ? `${m.name} (${m.seat})` : m.name)).join(", ");
}

function PartyCard({ party, characters, locations, weights }) {
  const [adding, setAdding] = useState(false);
  const complete = party.objectives.filter((o) => o.done).length;
  return (
    <section className="desk-card flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="section-title">
          {party.name} <span className="text-muted">· {memberLine(party)}</span>
        </h4>
        {party.objectives.length > 0 ? (
          <span className="mono text-sm text-muted">
            {complete} of {party.objectives.length} complete
          </span>
        ) : null}
      </div>

      {party.members.length === 0 ? (
        <p className="text-sm text-muted">Nothing here reaches the reveal until somebody holds the seat.</p>
      ) : null}

      {party.objectives.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">No objectives yet.</span>
          {party.hasStandardSet ? <StandardSetButton partyKey={party.key} /> : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {party.objectives.map((row) => (
            <ObjectiveRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {/* Folded away by default. Three parties each holding an open form was
          most of the section's height, and a GM adds an objective far less
          often than they read the ones already there. */}
      <div className="mt-auto">
        {adding ? (
          <AddRow
            party={party}
            characters={characters}
            locations={locations}
            weights={weights}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="btn-quiet" onClick={() => setAdding(true)}>
            + Add objective
          </button>
        )}
      </div>
    </section>
  );
}

function StandardSetButton({ partyKey }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await addStandardObjectives({ partyKey });
            if (!res?.ok) setError(res?.error ?? "Something went wrong.");
          });
        }}
      >
        Add the standard set
      </button>
      <FormError>{error}</FormError>
    </span>
  );
}

function ObjectiveRow({ row }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  function pin(key) {
    setError(null);
    startTransition(async () => {
      const res = await pinObjective({ id: row.id, pinned: PIN_VALUES[key] });
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  // Confirm first, transition second (DESIGN-SYSTEM.md §8): the row's controls
  // stay live while the GM reads the prompt.
  async function remove() {
    setError(null);
    const ok = await confirm({
      title: "Remove this objective?",
      message: `${row.description} — it leaves the reveal too.`,
      confirmLabel: "Remove",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeObjective({ id: row.id });
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded border p-3">
      <span className="chip chip-mono" style={{ minWidth: "4.5rem", justifyContent: "center" }}>
        {row.weight ?? "—"}
      </span>
      <span className="flex-1 min-w-48">
        {row.description}
        {row.placeholder ? <span className="ml-2 text-xs text-muted">waits on a rite</span> : null}
      </span>
      <span className={`mono text-sm ${row.done ? "" : "text-muted"}`}>{row.done ? "Success" : "Failed"}</span>
      <Select
        aria-label="Answer"
        value={pinKey(row)}
        disabled={pending}
        onChange={(e) => pin(e.target.value)}
        className="min-w-36"
      >
        {row.scripted ? <option value="auto">Game decides</option> : null}
        <option value="success">Success</option>
        <option value="failed">Failed</option>
      </Select>
      <button type="button" className="btn-quiet" disabled={pending} onClick={remove}>
        Remove
      </button>
      <FormError>{error}</FormError>
    </li>
  );
}

// Kind first; the second control follows the kind's target and is reset on
// every kind change, so a value picked for the last kind can never post
// under this one.
function AddRow({ party, characters, locations, weights, onClose }) {
  const [pending, startTransition] = useTransition();
  const [kindKey, setKindKey] = useState(party.kinds[0]?.key ?? "");
  const [characterId, setCharacterId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [value, setValue] = useState("");
  const [text, setText] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState(null);

  const kind = party.kinds.find((k) => k.key === kindKey) ?? null;

  function chooseKind(next) {
    setKindKey(next);
    setCharacterId("");
    setLocationId("");
    setValue("");
    setText("");
    setWeight("");
    setError(null);
  }

  const pool =
    kind?.target === "leader"
      ? characters.filter((c) => c.leader)
      : kind?.target === "inquisitor-or-baron"
        ? characters.filter((c) => c.inquisitorOrBaron)
        : characters;

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addObjective({
        partyKey: party.key,
        kind: kindKey,
        targetCharacterId: characterId || undefined,
        targetLocationId: locationId || undefined,
        value: value || kind?.defaultValue,
        text: text || undefined,
        weight: weight || undefined,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      chooseKind(kindKey);
    });
  }

  if (!kind) return null;

  return (
    <div className="flex flex-wrap items-end gap-3 border-t pt-3">
      <label className="field">
        <span className="field-label">Add</span>
        <Select value={kindKey} onChange={(e) => chooseKind(e.target.value)} className="min-w-64">
          {party.kinds.map((k) => (
            <option key={k.key} value={k.key}>
              {k.pick}
            </option>
          ))}
        </Select>
      </label>

      {kind.target === "character" || kind.target === "leader" || kind.target === "inquisitor-or-baron" ? (
        <label className="field">
          <span className="field-label">Character</span>
          <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} className="min-w-56">
            <option value="">Choose…</option>
            {pool.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.roleTitle ? ` — ${c.roleTitle}` : ""}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {kind.target === "location" ? (
        <label className="field">
          <span className="field-label">Location</span>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="min-w-56">
            <option value="">Choose…</option>
            {locations.map((g) => (
              <optgroup key={g.zoneName} label={g.zoneName}>
                {g.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
      ) : null}

      {kind.target === "number" ? (
        <label className="field">
          <span className="field-label">How many</span>
          <input
            type="number"
            min="1"
            className="w-24"
            value={value}
            placeholder={String(kind.defaultValue ?? "")}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      ) : null}

      {kind.target === "text" ? (
        <label className="field flex-1 min-w-64">
          <span className="field-label">{kind.key === "custom" ? "Objective" : "What"}</span>
          <input type="text" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      ) : null}

      {kind.key === "custom" ? (
        <label className="field">
          <span className="field-label">Weight</span>
          <Select value={weight} onChange={(e) => setWeight(e.target.value)} className="min-w-28">
            <option value="">None</option>
            {weights.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <button type="button" className="btn" disabled={pending} onClick={add}>
        Add
      </button>
      <button type="button" className="btn-quiet" disabled={pending} onClick={onClose}>
        Cancel
      </button>
      <FormError>{error}</FormError>
    </div>
  );
}
