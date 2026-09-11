"use client";

import { useEffect } from "react";

// Discord's two swipes: drag the scene right and the places drawer comes
// over it, drag it left and the people do. Inside a drawer the same gesture
// the other way closes it.
//
// Touch only, passive, no follow-the-finger — the drawer slides in on its own
// once the gesture is recognised. A gesture counts when it has moved at least
// SWIPE_PX and is clearly sideways (twice as far across as down), so a scroll
// through the feed with a bit of drift never opens anything. Any touch that
// starts inside a horizontally scrollable thing (a chip row, the tab strip) is
// left to that thing.
const SWIPE_PX = 70;

export default function useSwipeOpen(ref, { onLeft = null, onRight = null, enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || (!onLeft && !onRight)) return undefined;
    let start = null;

    const onStart = (event) => {
      if (event.touches.length !== 1) {
        start = null;
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("[data-swipe-ignore], .tab-bar, .chip-row, textarea, input")) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
    };
    const onEnd = (event) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0) onRight?.();
      else onLeft?.();
    };
    const onCancel = () => {
      start = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [ref, onLeft, onRight, enabled]);
}
