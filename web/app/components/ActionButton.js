"use client";

import IconButton from "./IconButton";
import Tooltip from "./Tooltip";

// The one player-action button, in the three frames the app draws it in:
//
//   icon — a framed glyph (IconButton), the /character rack.
//   tile — glyph and name as a full-width row, the /ledger Actions panel.
//   menu — a plain verb in a .chat-menu, the /play person and thing menus.
//
// All three share the tooltip: the label, then the sentence explaining what
// the verb does, then — when the button is greyed — the reason. Tooltip wraps
// the button rather than sitting on it, so unlike a native title= it still
// fires on a disabled element, which is exactly the case that most needs an
// explanation. That used to live in ActionGrid.js; the menus had no tooltip
// at all and their greyed rows explained nothing.
//
// `busy` is for an instant verb in flight: the button disables and says so.
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
