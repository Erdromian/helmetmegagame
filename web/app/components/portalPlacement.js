// Shared "where does a fixed-position, portaled panel go" math. Pulled out of
// HoverCard.js so a second portaled popover (ThingsDrawer.js's action menu)
// doesn't reimplement the viewport-clamping by hand — this is the fiddly part
// worth keeping in one place, not the event wiring around it, which stays
// local to whichever component owns its own open/close state.
const GAP = 6;
const MARGIN = 8;

// trigger/panel are DOM nodes (refs already unwrapped). Returns
// { top, left, maxHeight } in viewport (fixed-position) coordinates.
export function placePanel(trigger, panel) {
  const t = trigger.getBoundingClientRect();
  const { width, height } = panel.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Prefer above (where a tag tooltip has always opened); flip below when
  // the space isn't there.
  const roomAbove = t.top - GAP - MARGIN;
  const roomBelow = vh - t.bottom - GAP - MARGIN;
  const below = height > roomAbove && roomBelow > roomAbove;
  const preferred = below ? t.bottom + GAP : t.top - GAP - height;

  // Clamp the whole panel into the viewport rather than squeezing it into
  // whichever side it was placed on — a squeezed panel with its own internal
  // scrollbar is one the reader can't use if the panel is pointer-events:none,
  // and reaching for it would close it anyway if it isn't. Better to slide it
  // and overlap the trigger a little than to hide half of it.
  const top = Math.min(Math.max(MARGIN, preferred), Math.max(MARGIN, vh - height - MARGIN));

  // Left-align with the trigger, then clamp so one near the right edge
  // doesn't push the panel off-screen.
  const left = Math.min(Math.max(MARGIN, t.left), Math.max(MARGIN, vw - width - MARGIN));

  return { top, left, maxHeight: vh - MARGIN * 2 };
}
