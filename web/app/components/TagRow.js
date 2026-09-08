"use client";

import TagDetails from "./TagDetails";

// One tag as a line in the rail: the group's colour rule on the left, the
// name, a stack count, and a right-aligned value the card chose — turns left,
// pounds, the armour word, a carry bonus (web/lib/sheetCards.js#rowValue).
// A note under the name is the card's second line (Health's "→ Festering ·
// cure …"). Clicking the row opens the tag's full details inline beneath it,
// the same block TagChip shows on hover elsewhere. No hover, no tooltip.
//
// `verbs` renders beside the value: RowVerbs, or nothing.
export default function TagRow({
  ct,
  value = null,
  note = null,
  verbs = null,
  open = false,
  onToggle,
  currentTurn = null,
  armedTurn = null,
  muted = false,
  worn = false,
}) {
  const tag = ct.tag;
  const stack = (ct.quantity ?? 1) > 1 ? ct.quantity : null;
  const groupColor = tag.group?.color ?? null;

  return (
    <li className="sheet-row" data-open={open ? "true" : undefined} data-muted={muted ? "true" : undefined}>
      <div className="sheet-row-line">
        <button
          type="button"
          className="sheet-row-face"
          aria-expanded={open}
          onClick={onToggle}
          style={groupColor ? { borderLeftColor: groupColor } : undefined}
        >
          <span className="sheet-row-name">
            {tag.name}
            {stack && <span className="text-muted"> ×{stack}</span>}
            {worn && <span className="text-muted"> · worn</span>}
          </span>
          {note && <span className="sheet-row-note">{note}</span>}
        </button>
        {verbs}
        {value && (
          <span className="sheet-row-value mono" data-tone={value.tone ?? undefined}>
            {value.text}
          </span>
        )}
      </div>
      {open && (
        <div className="sheet-row-details">
          <TagDetails
            tag={tag}
            quantity={ct.quantity ?? 1}
            expiresTurn={ct.expiresTurn}
            currentTurn={currentTurn}
            armedTurn={armedTurn}
            showName={false}
          />
        </div>
      )}
    </li>
  );
}
