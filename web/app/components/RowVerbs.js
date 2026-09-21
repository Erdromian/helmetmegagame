"use client";

// The verbs a pocket row offers, as small labelled buttons: Consume, Equip or
// Unequip, Give, Destroy — and Heal on a wound. Every one opens the SAME
// dialog the Actions strip opens, through RequestActionsProvider with the tag
// already picked, or flips the same equip toggle; nothing here has a rule of
// its own, and each is re-checked server-side when pressed.
//
// Visible text, no tooltips: this surface has none (SHEET.md). Drawn on hover
// or focus on a pointer device (globals.css). On a touch one it is not on the
// line at all — TagRow.js renders it inside the row's opened details, and says
// why.
//
// `itemVerbs` is the item's own verbs (db/lib/itemVerbs.js) — Play Instrument
// on a lute, Detonate on a remote — already filtered by TagRail.js to the ones
// that are lit, each { mode, label, onClick }. They come first.
export default function RowVerbs({
  verbs,
  itemVerbs = [],
  pending = false,
  onUse,
  onEquip,
  onGive,
  onDestroy,
  onHeal,
}) {
  const items = itemVerbs.map(({ mode, label, onClick }) => [`verb-${mode}`, label, onClick]);
  // A poison opens its own dialog (TagRail.js), and says so — the same word TagChip.js uses.
  if (verbs.consumable && onUse) items.push(["use", verbs.poison ? "Poison" : "Consume", onUse]);
  if (verbs.equippable && onEquip) items.push(["equip", verbs.equipped ? "Unequip" : "Equip", onEquip]);
  if (verbs.tradeable && onGive) items.push(["give", "Give", onGive]);
  if (verbs.removable && onDestroy) items.push(["destroy", "Destroy", onDestroy]);
  if (verbs.healable && onHeal) items.push(["heal", "Heal", onHeal]);
  // Only when every gate is already open — the row's own note carries the
  // reason when one is shut, rather than a dead button (TagRail.js).
  if (items.length === 0) return null;
  return (
    <span className="sheet-row-verbs">
      {items.map(([key, label, onClick]) => (
        <button key={key} type="button" className="menu-item" disabled={pending} onClick={onClick}>
          {label}
        </button>
      ))}
    </span>
  );
}
