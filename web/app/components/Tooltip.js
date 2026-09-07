import HoverCard from "./HoverCard";

// Thin wrapper for a flat-text tooltip (InfoIcon's "?" glyph). Shares
// HoverCard with TagChip so both escape their scrolling ancestors — they used
// to share only a CSS class, which meant fixing one would have half-broken
// the other.
//
// `pinnable` passes through to HoverCard. IconButton turns it off: a button
// is already a control, and pinning its own label on click left a "Here ×"
// panel sitting on the screen after every tap of the ⋯ on a phone.
export default function Tooltip({ text, children, className = "", pinnable = true }) {
  return (
    <HoverCard panel={text} className={className} pinnable={pinnable}>
      {children}
    </HoverCard>
  );
}
