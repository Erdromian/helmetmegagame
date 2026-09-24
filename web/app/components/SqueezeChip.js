// The "Tight squeeze" chip on a way out, on /chat's Travel panel and on /map's
// ways-out list and card alike (MAP.md §2a). Drawn for everybody: the Giant it
// refuses already reads the refusal, and this is for the rest of the party, so
// they know where their Giant friend cannot follow before they set off.
//
// A plain .chip rather than a ChipLabel: it names a property of the WAY, not a
// tag anybody holds, so there is no category rule or group icon to draw. Quiet,
// because it is a note on the road and not a warning — nobody here is refused
// by it. Both call sites are inside a <button>, hence a span and not a button.
import { TIGHT_SQUEEZE_LABEL, tightSqueezeNote } from "@/lib/travelCost";

export default function SqueezeChip({ show, onWalk = false, className = "" }) {
  if (!show) return null;
  return (
    <span className={className ? `chip chip-quiet ${className}` : "chip chip-quiet"} title={tightSqueezeNote(onWalk)}>
      {TIGHT_SQUEEZE_LABEL}
    </span>
  );
}
