"use client";

import TagChip from "./TagChip";
import { parseQuantity } from "./QuantityField";

// A stack you are choosing some of: name · how many there are · − n + · All.
//
// The name is a TagChip when the caller hands over the tag, so the row says
// what the thing IS on hover — where it is worn, what it stops, what it does in
// a fight — exactly as the Depot, the Tag Catalog and the sheet's own rail
// already do. This dialog was the one list in the app showing a bare name, and
// a player reported the consequence: the only way to find out which slot a
// helmet took was to carry it home and try it on. A caller with no tag to give
// (a helpless person's pockets, which are deliberately named and not described
// — REQUESTS.md §5b) still passes a plain name and gets the old row.
//
// The weight rides UNDER the name rather than on the hover, because it is the
// one fact that decides the answer while the dialog is open: the carry cap is
// right there in the projection line. Everything else is a hover away.
//
// This replaces the checkbox-then-"How many?" pair that Transfer, Loot,
// Package and Purchase Gear each drew their own way: tick a box, and a second
// control appeared to say how many. One row does both — the count IS the
// choice, and 0 is "none of that".
//
// `picks` is { [id]: "3" } — string drafts, the way QuantityField keeps its
// value, so a half-typed box is not snapped mid-edit. Every change hands back
// a NEW object (react-hooks/immutability is an error here); a 0 removes the
// key, so Object.keys(picks) is still "what was chosen".

function stackLabel(name, quantity) {
  return quantity > 1 ? `${name} ×${quantity}` : name;
}

export function StackRow({
  id,
  name,
  tag = null,
  note = null,
  held = 1,
  max = held,
  value,
  onChange,
  disabled = false,
}) {
  const current = parseQuantity(value, { min: 0, max }) ?? 0;
  const draft = value ?? "";

  function set(next) {
    const n = Math.max(0, Math.min(max, next));
    onChange(id, n === 0 ? "" : String(n));
  }

  return (
    <div className="stack-row" data-picked={current > 0 ? "true" : undefined}>
      <div className="stack-row-name">
        {tag ? <TagChip tag={tag} quantity={held} /> : <span>{stackLabel(name, held)}</span>}
        {note ? <span className="stack-row-note">{note}</span> : null}
      </div>
      <span className="qty">
        <button
          type="button"
          className="qty-btn"
          onClick={() => set(current - 1)}
          disabled={disabled || current <= 0}
          aria-label={`One fewer ${name}`}
          tabIndex={-1}
        >
          −
        </button>
        <input
          type="number"
          className="qty-input"
          min={0}
          max={max}
          value={draft}
          placeholder="0"
          disabled={disabled}
          onChange={(e) => onChange(id, e.target.value)}
          onBlur={(e) => {
            const n = parseQuantity(e.target.value, { min: 0, max });
            onChange(id, !n ? "" : String(n));
          }}
          aria-label={`How many ${name}`}
        />
        <button
          type="button"
          className="qty-btn"
          onClick={() => set(current + 1)}
          disabled={disabled || current >= max}
          aria-label={`One more ${name}`}
          tabIndex={-1}
        >
          +
        </button>
      </span>
      {max > 1 && (
        <button
          type="button"
          className="btn-quiet stack-row-all"
          onClick={() => set(current >= max ? 0 : max)}
          disabled={disabled}
        >
          {current >= max ? "None" : "All"}
        </button>
      )}
    </div>
  );
}

// A list of them. `rows` is [{ id, name, tag?, note?, held, max? }]; `picks` and
// `onChange(nextPicks)` are the whole selection, replaced wholesale.
export default function StackPicker({ rows, picks, onChange, emptyLabel = "Nothing here.", disabled = false }) {
  if (!rows.length) return <p className="text-sm text-muted">{emptyLabel}</p>;

  function change(id, value) {
    const next = { ...picks };
    if (value === "" || value == null) delete next[id];
    else next[id] = value;
    onChange(next);
  }

  return (
    <div className="stack-list">
      {rows.map((row) => (
        <StackRow
          key={row.id}
          id={row.id}
          name={row.name}
          tag={row.tag ?? null}
          note={row.note ?? null}
          held={row.held ?? 1}
          max={row.max ?? row.held ?? 1}
          value={picks[row.id]}
          onChange={change}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// The selection as the server takes it: [{ tagId, quantity }], blanks dropped.
export function pickedLines(picks) {
  return Object.entries(picks)
    .map(([tagId, q]) => ({ tagId, quantity: parseQuantity(q, { min: 0 }) ?? 0 }))
    .filter((l) => l.quantity > 0);
}
