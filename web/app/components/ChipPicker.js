"use client";

// A single choice from a short list, drawn as chips rather than a <select>.
//
// "Who are you tying up?" over four names, "Whose body?" over two, "Which
// room?" over three — a dropdown hides the whole answer behind a click and
// then asks for a second one. Chips show every option at once and take one
// tap. Only for SHORT, LOCAL lists: the Bird's every-character roster and
// Engrave's typed name keep their own controls, because two hundred chips is
// worse than a dropdown.
//
// `options` is [{ id, label, note?, disabled?, reason? }]. `note` prints beside
// the label in the muted face — a corpse's yield, "✓ current", a price. The
// markup is the house .chip-row / data-active / aria-pressed form.

export default function ChipPicker({
  label = null,
  options,
  value,
  onChange,
  emptyLabel = "Nothing to choose from.",
  disabled = false,
}) {
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="chip-row" role="group" aria-label={typeof label === "string" ? label : undefined}>
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                className="chip"
                data-active={active ? "true" : undefined}
                aria-pressed={active}
                disabled={disabled || o.disabled}
                title={o.disabled && o.reason ? o.reason : undefined}
                onClick={() => onChange(active ? "" : o.id)}
              >
                {o.label}
                {o.note ? <span className="chip-note">{o.note}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
