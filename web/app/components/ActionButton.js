"use client";

import IconButton from "./IconButton";
import Tooltip from "./Tooltip";

// The one player-action button, in the four frames the app draws it in:
//
//   icon  — a framed glyph (IconButton), the /character rack.
//   tile  — glyph and name as a full-width row, a labelled column of verbs.
//   menu  — a plain verb in a .chat-menu, the /chat person and thing menus.
//   strip — glyph and name, small, in the ledger band's one wrapping row.
//
// All four share the tooltip: the label, then the sentence explaining what
// the verb does, then — when the button is greyed — the reason. Tooltip wraps
// the button rather than sitting on it, so unlike a native title= it still
// fires on a disabled element, which is exactly the case that most needs an
// explanation. That used to live in ActionGrid.js; the menus had no tooltip
// at all and their greyed rows explained nothing.
//
// `busy` is for an instant verb in flight: the button disables and says so.
//
// `strip` used to be the one variant with no tooltip, on a rule that the sheet
// had none at all, and a greyed verb there printed its reason on a line under
// the strip instead. Nobody found the line, and an ungated verb like Attack
// explained itself nowhere: hovering it did nothing. It hovers like the rest
// now, and the line is gone.
function tooltipFor(label, help, reason) {
  if (!help && !reason) return label;
  return (
    <>
      <p>
        <strong>{label}</strong>
      </p>
      {typeof help === "string" ? <p>{help}</p> : help}
      {reason ? <p>{reason}</p> : null}
    </>
  );
}

export default function ActionButton({
  icon: Icon = null,
  label,
  help = null,
  reason = null,
  variant = "tile",
  disabled = false,
  busy = false,
  onClick,
}) {
  const off = disabled || busy;
  const tooltip = tooltipFor(label, help, disabled ? reason : null);

  if (variant === "icon") {
    return (
      <IconButton
        icon={Icon}
        label={label}
        tooltip={tooltip}
        onClick={onClick}
        disabled={off}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
      />
    );
  }

  if (variant === "strip") {
    return (
      <Tooltip text={tooltip} pinnable={false}>
        <button
          type="button"
          className="action-strip-item"
          aria-busy={busy || undefined}
          data-muted={disabled ? "true" : undefined}
          data-busy={busy ? "true" : undefined}
          disabled={off}
          onClick={onClick}
        >
          {Icon ? <Icon width="15" height="15" /> : null}
          <span>{busy ? "Working…" : label}</span>
        </button>
      </Tooltip>
    );
  }

  if (variant === "menu") {
    return (
      <Tooltip text={tooltip} pinnable={false}>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          aria-busy={busy || undefined}
          onClick={onClick}
          disabled={off}
        >
          {busy ? "Working…" : label}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip text={tooltip} pinnable={false}>
      <button
        type="button"
        className="action-tile"
        aria-label={label}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
        onClick={onClick}
        disabled={off}
      >
        {Icon ? <Icon width="18" height="18" /> : null}
        <span>{busy ? "Working…" : label}</span>
      </button>
    </Tooltip>
  );
}
