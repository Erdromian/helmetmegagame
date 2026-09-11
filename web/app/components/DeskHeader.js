// Shared `.desk-header` for the (desk) route group — /gm/turns, /gm/audit,
// /gm/players. Those three pages are one tool wearing three faces
// (ADJUDICATION.md / DESIGN-SYSTEM.md §6's "desk" exception to PageShell),
// and they used to hand-roll this header separately, which drifted: audit's
// <h1> was text-base, adjudication's was section-title, and the meta chips
// sat in different orders. This is the one place that layout lives now.
//
// Not "use client" — it renders whatever it's given, so it works from either
// a server or client parent.
export default function DeskHeader({ title, meta, actions }) {
  return (
    <header className="desk-header">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="section-title">{title}</h1>
        {meta}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

// The desks' turn chip, in one place so it cannot drift again.
//
// Four desks each drew their own: /gm/turns and /gm/players agreed on
// "Turn 8 · Dusk" but wrote it twice, /gm/dev said "DAY 4 · DUSK — OPEN"
// through describeTurn(), /gm/audit hid the chip entirely when no turn was
// open, and /gm/oracle had none at all. A GM moving between the five desks
// read four different answers to one question, and on two of them the absence
// of a chip was indistinguishable from a turn that had not loaded.
//
// It always renders, including with no turn open: "No turn open" is a fact a
// GM needs, and it is the reason the audit desk's conditional was wrong.
//
// Not the same shape as AppHeader's TurnMeta, on purpose. That one answers
// "where am I and when is it" for a player — a zone and a game DAY. A desk
// works in TURNS, which is what every row, filter and push on it is keyed to,
// so the desks say the turn number.
export function DeskTurnChip({ turn }) {
  return (
    <span className="chip">
      {turn ? `Turn ${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}` : "No turn open"}
    </span>
  );
}
