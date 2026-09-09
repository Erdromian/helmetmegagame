"use client";

// The verbs a pocket row offers, as small labelled buttons: Use, Equip or
// Unequip, Give, Destroy — and Heal on a wound. Every one opens the SAME
// dialog the Actions strip opens, through RequestActionsProvider with the tag
// already picked, or flips the same equip toggle; nothing here has a rule of
// its own, and each is re-checked server-side when pressed.
//
// Visible text, no tooltips: this surface has none (SHEET.md). Drawn on hover
// or focus on a pointer device and always on a touch one (globals.css).
export default function RowVerbs({ verbs, pending = false, onUse, onEquip, onGive, onDestroy, onHeal }) {
  const items = [];
  if (verbs.consumable && onUse) items.push(["use", "Use", onUse]);
  if (verbs.equippable && onEquip) items.push(["equip", verbs.equipped ? "Unequip" : "Equip", onEquip]);
  if (verbs.tradeable && onGive) items.push(["give", "Give", onGive]);
  if (verbs.removable && onDestroy) items.push(["destroy", "Destroy", onDestroy]);
  if (verbs.healable && onHeal) items.push(["heal", "Heal", onHeal]);
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
