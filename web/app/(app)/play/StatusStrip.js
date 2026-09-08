"use client";

// What is true of this body right now, in one wrapping row: what you are
// carrying, and every Status or Health tag you are wearing.
//
// The category test is the SHEET's own (web/lib/sheetCards.js groups on the
// same field), so a new affliction shows up here the day it is added to
// docs/tags.yaml without anybody listing it twice.
const SHOWN_CATEGORIES = new Set(["Status", "Health"]);

// The three that are not news but a problem. Their slugs are literals rather
// than an import, because db/lib/constants.js is a server module and this is
// the browser's copy of three strings.
const BAD = new Set(["overburdened", "dying", "catatonic-afk"]);

// `onPick` turns each tag chip into a button: the sheet's band passes it and
// opens the tag's details inline underneath (LedgerBand.js), so nothing here
// has to be hovered to be read. Chat passes nothing and keeps plain chips.
export default function StatusStrip({ resources = 0, carry = null, tags = [], onPick = null, pickedId = null }) {
  const worn = tags.filter((ct) => SHOWN_CATEGORIES.has(ct.tag?.category));

  return (
    <div className="chat-chips">
      <span className="chip chip-mono">{resources} ⬢</span>
      {carry && (
        <span className="chip chip-mono" data-tone={carry.over ? "danger" : undefined}>
          {Math.round(carry.weightUsed)}/{carry.weightCap} lb
        </span>
      )}
      {worn.map((ct) => {
        const id = ct.tag.id ?? ct.tagId;
        const face = (
          <>
            {ct.tag.name}
            {(ct.quantity ?? 1) > 1 ? ` ×${ct.quantity}` : ""}
          </>
        );
        return onPick ? (
          <button
            key={id}
            type="button"
            className="chip"
            data-tone={BAD.has(ct.tag.slug) ? "danger" : undefined}
            data-active={pickedId === id ? "true" : undefined}
            aria-expanded={pickedId === id}
            onClick={() => onPick(ct)}
          >
            {face}
          </button>
        ) : (
          <span
            key={id}
            className="chip"
            data-tone={BAD.has(ct.tag.slug) ? "danger" : undefined}
            // The tag's own catalog text, not an explainer written for here.
            title={ct.tag.description ?? undefined}
          >
            {face}
          </span>
        );
      })}
    </div>
  );
}
