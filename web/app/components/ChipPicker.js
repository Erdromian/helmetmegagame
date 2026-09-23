"use client";

import { useState } from "react";

// A single choice from a short list, drawn as chips rather than a <select>. Only for SHORT,
// LOCAL lists — two hundred chips is worse than a dropdown. `options` is [{ id, label,
// note?, disabled?, reason?, active? }]. `active` overrides the usual "is this THE value"
// test, letting a caller with more than one live answer borrow this row (IngredientSlots.js).
//
// A greyed option that carries a `reason` is aria-disabled rather than disabled, the same
// way ActionButton.js does it: a disabled button dispatches no click, and the reason used
// to live only in a `title` tooltip, which a touch screen never shows. Tapping it now says
// the reason under the row instead of choosing it. A greyed option with no reason stays
// truly disabled — there is nothing to say (IngredientSlots.js's slotted chips).

export default function ChipPicker({
  label = null,
  options,
  value,
  onChange,
  emptyLabel = "Nothing to choose from.",
  disabled = false,
}) {
  // Which greyed option was last tapped. Stored by id, so an option whose reason has
  // since gone away simply stops being explained.
  const [asked, setAsked] = useState(null);
  const explained = options.find((o) => o.id === asked && o.disabled && o.reason) ?? null;
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="chip-row" role="group" aria-label={typeof label === "string" ? label : undefined}>
          {options.map((o) => {
            const active = o.active ?? o.id === value;
            const explains = Boolean(o.disabled && o.reason);
            return (
              <button
                key={o.id}
                type="button"
                className="chip"
                data-active={active ? "true" : undefined}
                data-off={o.disabled ? "true" : undefined}
                aria-pressed={active}
                disabled={disabled || (o.disabled && !explains)}
                aria-disabled={explains || undefined}
                title={explains ? o.reason : undefined}
                onClick={() => {
                  if (explains) setAsked((was) => (was === o.id ? null : o.id));
                  else {
                    setAsked(null);
                    onChange(active ? "" : o.id);
                  }
                }}
              >
                {o.label}
                {o.note ? <span className="chip-note">{o.note}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      {explained ? (
        <p className="text-sm text-muted" role="status">
          {explained.label}: {explained.reason}
        </p>
      ) : null}
    </div>
  );
}
