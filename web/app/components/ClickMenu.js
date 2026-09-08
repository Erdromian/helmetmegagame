"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePanel } from "./portalPlacement";

// A small menu that opens on a CLICK, escaped to document.body. Same reasoning
// and math as HoverCard.js (portalPlacement.js): an in-tree menu is positioned
// relative to its trigger, and inside a scrolling Modal or a scrolling column
// it gets clipped or buried instead of shown. Fixed positioning computed from
// the trigger's own rect, escaped to the body, sidesteps that regardless of
// which scrolling or stacking ancestor the trigger sits under.
//
// Not HoverCard itself: the trigger here is already a plain button with its
// own click handler, which doesn't fit HoverCard's hover-preview-then-pin
// model — this only ever opens on click and only ever one at a time.
//
// Lived in play/ThingsDrawer.js as ThingMenuPortal until the sheet's equip
// board wanted the same thing for its empty cells.
export default function ClickMenu({ triggerRef, onClose, ariaLabel, children }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    setPos(placePanel(trigger, panel));
  }, [triggerRef]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    const onScrollOrResize = () => place();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    // Checked against the portal's own panel, not just the trigger, so a
    // click on a menu item still fires — a plain onBlur on an ancestor
    // wrapper closes the menu before that click lands, since the portaled
    // panel is no longer a DOM descendant of it.
    const onPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [place, onClose, triggerRef]);

  return createPortal(
    <div
      ref={panelRef}
      className="chat-menu chat-menu-portal"
      role="menu"
      aria-label={ariaLabel}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
