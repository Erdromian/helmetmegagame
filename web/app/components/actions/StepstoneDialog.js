"use client";

import { useState } from "react";
import Select from "../Select";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { scoreMatch } from "@/lib/fuzzySearch";
import { stepstoneRequest } from "@/app/(app)/character/requestActions";

// The Stepstone: break it and stand somewhere else.
//
// The list is every SURFACE Location, built server-side in character/page.js
// and re-checked by stepstoneRequest, which refuses a posted id for anywhere
// underground. It is long on purpose, which is what the search box is for.
export default function StepstoneDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const places = pools.stepstoneTargets ?? [];
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("");
  const { submit, busy, error } = useSubmit();

  const q = query.trim();
  const choices = q
    ? places.filter(
        (l) =>
          l.id === locationId ||
          scoreMatch(q, { name: l.name }) ||
          scoreMatch(q, { name: l.zoneName ?? "" }),
      )
    : places;
  const target = places.find((l) => l.id === locationId) ?? null;

  return (
    <ActionDialog
      title="Stepstone"
      submitLabel="Step"
      busy={busy}
      error={error}
      empty={places.length === 0 ? "There is nowhere for the stone to take you. ‡" : null}
      canSubmit={Boolean(locationId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => stepstoneRequest({ locationId }),
          () => onDone(`You are standing in ${target?.name ?? "somewhere else"}.`),
        )
      }
    >
      <label className="field">
        <span className="field-label">Where do you go?</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by place"
          data-autofocus
        />
        <Select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          required
        >
          <option value="" disabled>
            Pick somewhere
          </option>
          {choices.map((l) => (
            <option key={l.id} value={l.id}>
              {l.zoneName ? `${l.name} — ${l.zoneName}` : l.name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted mono">
          {choices.length} / {places.length}
        </span>
      </label>
    </ActionDialog>
  );
}
