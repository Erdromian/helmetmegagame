// The two pieces of a character's turn readout that more than one sheet
// layout needs: the "this turn" block and the carry cap's hover breakdown.
// They lived inside StatusPanel.js until /ledger wanted the same words in a
// different frame — a second copy would have been two places to fix the day
// the Move wording changes.

import { moveKindLabel, rollLabel } from "@/lib/moves";
import ExpandableText from "./ExpandableText";

// Rendered on the server, so a viewer-local time isn't available — and the
// game's clock is Chicago anyway (turns roll at 00:00/12:00 CT), which is what
// the handbook and the Discord announcement both quote. Labelled CT so nobody
// reads it as their own wall clock.
const CT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

// The Move cutoff (db/lib/turnClock.js), attached to the turn by
// app/(app)/character/page.js. Absent when there is no lock this turn — a
// manually advanced short turn, or auto-advance switched off.
export function MoveCutoff({ window: moveWindow }) {
  if (!moveWindow?.hasLock) return null;
  return moveWindow.locked ? (
    <span className="text-muted">
      Moves are locked for this turn — the next turn opens at {CT_TIME.format(new Date(moveWindow.endsAt))} CT.
    </span>
  ) : (
    <span className="text-muted">Moves lock at {CT_TIME.format(new Date(moveWindow.cutoffAt))} CT.</span>
  );
}

// The player's own read of the Move they filed this turn — the same row the
// bot's DM confirms, just left standing where they can check it later
// instead of scrolling Discord. Player-facing wording, not the GM workflow
// enums (moveReviewStatus's "Passed"/"Open" mean nothing to a player).
export function ThisTurn({ currentAction, openTurn, pendingOffers = [] }) {
  if (!openTurn) return <span className="text-muted">No turn is open.</span>;
  const cutoff = <MoveCutoff window={openTurn.moveWindow} />;
  // A handshake still waiting on the other side (docs/systemdocs/LESSONS.md).
  // Shown above the Move line either way: an offer you made is why your Move
  // isn't filed yet, and one made to you is waiting in your DMs.
  const waiting = pendingOffers.map((o) => (
    <span key={o.id} className="text-muted">
      {o.mine
        ? o.kind === "BIND"
          ? `Waiting for ${o.otherName} to agree to be bound.`
          : `Waiting for ${o.otherName} to accept the lesson${o.tagName ? ` in ${o.tagName}` : ""}.`
        : o.kind === "BIND"
          ? `${o.otherName} wants to bind you. Answer in your DMs.`
          : `${o.otherName} offered a lesson${o.tagName ? ` in ${o.tagName}` : ""}. Answer in your DMs.`}
    </span>
  ));
  if (!currentAction)
    return (
      <>
        {waiting}
        <span className="text-muted">Not filed yet.</span>
        {cutoff}
      </>
    );

  const { status, moveReviewStatus, resourceRollValue, resourceRollExpression } = currentAction;

  let stateLine;
  if (status === "PENDING_TYPE" || status === "PENDING" || status === "PENDING_OPPOSED") {
    stateLine = <span className="text-muted">Not locked in yet — check your Discord DMs.</span>;
  } else if (moveReviewStatus === "SOLVED") {
    stateLine = <span className="text-positive">Solved.</span>;
  } else {
    // Always empty for a Gambit now: app/(app)/character/page.js strips the
    // die server-side, and this panel's only mount is that page. Kept rather
    // than deleted so the panel stays honest about whatever it is handed —
    // a Routine has never had a die either, and this is the same branch.
    const roll = rollLabel(currentAction);
    // The range, not just the number. A bare "+7 ⬢" is unreadable: the roll's
    // floor moves with GameConfig.productionCoefficient, with the Location's
    // own yield coefficient, and with whatever tools folded into it
    // (LABORING.md), so a player who knows their tier's written rate can't
    // tell a low roll from a missing bonus — which is exactly how "Butcher
    // isn't applying" got reported. The stored expression
    // is already a plain "min-max" string; en-dash it here rather than import
    // formatRangeExpression, which would drag @lifeweb/db into this bundle.
    const range = /^\d+-\d+$/.test(resourceRollExpression ?? "")
      ? resourceRollExpression.replace("-", "–")
      : null;
    const amount = resourceRollValue != null ? `${resourceRollValue > 0 ? "+" : ""}${resourceRollValue} ⬢` : null;
    const payout = amount && range ? `${range} → ${amount}` : amount;
    // Without this the line just loses its middle and reads as if nothing was
    // rolled. Same words the confirm DM uses (bot/src/lib/moveConfirm.js), so
    // the two surfaces promise the same moment.
    const pending = !roll && currentAction.moveKind === "GAMBIT";
    stateLine = (
      <span className="text-muted">
        Locked in{roll ? ` — ${roll}` : ""}
        {payout ? ` (${payout})` : ""}.{" "}
        {pending ? "🎲 The die is cast — you'll see how it fell when the turn ends." : "Results land when the turn ends."}
      </span>
    );
  }

  return (
    <>
      {waiting}
      <span className="field-label">{moveKindLabel(currentAction.moveKind, currentAction.gmNotes)}</span>
      <ExpandableText text={currentAction.description} lines={3} />
      {stateLine}
      {cutoff}
    </>
  );
}

// What holds a carry cap up, as one hover string. Assets are absent on
// purpose: they raise the cap without ever weighing on it (CARRY.md §1).
export function carryCapTitle(carry) {
  const lines = [`Base ${carry.baseWeightCap} lb`];
  // Signed, because a body can now push the cap down as well as up: a Cart
  // reads "+4", Frail reads "−0.1" (CARRY.md §1).
  for (const m of carry.breakdown ?? []) {
    lines.push(`${m.name} ${m.bonus > 0 ? "+" : "−"}${Math.abs(m.bonus)}`);
  }
  lines.push(`= ${carry.weightCap} lb, and ${carry.weightHardCap} lb is the most you could ever hold.`);
  return lines.join("\n");
}
