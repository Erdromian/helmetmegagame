"use client";

import { useRef, useState } from "react";
import ClickMenu from "./ClickMenu";

// The "⋯" overflow on a desk panel's header.
//
// A Move's header carried four quiet buttons of equal weight — Message, Past
// moves, Dev panel, Close — so nothing in it read as the way out and nothing
// read as the thing you came for. The exit stays a real button at the call
// site; everything that is a side trip goes in here.
//
// `items` is [{ label, onClick, disabled?, title? }]. Nothing renders when
// the list is empty, so a caller can filter items out without guarding.
// `onOpen` fires when the menu is opened — a caller can warm whatever its
// items are about to need (the dev panel's DTO), the way the icon button this
// replaced prefetched on pointerdown.
export default function DeskRowMenu({ items, ariaLabel = "More actions", onOpen = null }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const live = items.filter(Boolean);
  if (!live.length) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="btn-quiet"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <ClickMenu triggerRef={triggerRef} ariaLabel={ariaLabel} onClose={() => setOpen(false)}>
          {live.map((item) => (
            <button
              key={item.label}
              type="button"
              className="menu-item"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </ClickMenu>
      )}
    </>
  );
}
