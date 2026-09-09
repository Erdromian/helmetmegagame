"use client";

import { useState } from "react";
import { nameKey } from "@/lib/characterName";

// TYPED names, held as chips. The app's first real multi-select input.
//
// ChipPicker is a single choice from a list the server already knows; this is
// the opposite problem — a set of names, and no list to pick from. Intercept
// types its people rather than picking them for the reason Engrave and the
// Arrest Warrant do (web/app/components/actions/WarrantDialog.js): a dropdown
// here would be a roster of everybody alive in Ravenheart, handed to anyone
// who opened the dialog.
//
// The markup is the house form (DESIGN-SYSTEM.md §5): a `.field` wrapper, a
// `.chip-row` of tokens. Two deliberate departures from ChipPicker:
//
//   - A token carries `data-active` but NO `aria-pressed`. A chip there is a
//     TOGGLE; a token here is a REMOVE control, and saying "pressed" about it
//     would tell a screen reader the wrong thing.
//   - No `title=`. This mounts on the character sheet, and nothing on that
//     sheet is a tooltip (SHEET.md §3).
//
// Blur commits a half-typed name on purpose. Losing what you just typed
// because you reached for Save is the one thing a control like this must not
// do.
export default function NameChips({ label, names, onChange, max = 12, maxLength = 100, disabled = false }) {
  const [draft, setDraft] = useState("");

  function commit(raw) {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    setDraft("");
    if (!name || names.length >= max) return;
    // Dedupe the way the server matches — nameKey folds case and whitespace,
    // so "lord greeblus" cannot sit beside "Lord  Greeblus".
    if (names.some((n) => nameKey(n) === nameKey(name))) return;
    onChange([...names, name]);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && names.length > 0) {
      e.preventDefault();
      onChange(names.slice(0, -1));
    }
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {names.length > 0 ? (
        <div className="chip-row" role="group" aria-label={label}>
          {names.map((name) => (
            <button
              key={nameKey(name)}
              type="button"
              className="chip"
              data-active="true"
              disabled={disabled}
              aria-label={`Remove ${name}`}
              onClick={() => onChange(names.filter((n) => nameKey(n) !== nameKey(name)))}
            >
              {name}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="text"
        value={draft}
        disabled={disabled || names.length >= max}
        placeholder={names.length >= max ? "That's as many as you can watch for. ‡" : "Type a name, press Enter ‡"}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
