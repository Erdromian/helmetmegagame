"use client";

import { useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import FormError from "./FormError";
import { setCombatMode } from "@/app/(app)/chat/actions";
import { LOCKED_ON } from "@lifeweb/db/lib/combatMode";

// Combat mode (docs/systemdocs/COMBAT-MODE.md): the "Combat" button beside Move…, on /chat's Turn
// block and in the sheet's This turn box, the same size as Move…. It glows red while on (Combat
// Mode.docx). A bevelled button with aria-pressed rather than the Switch every other boolean uses, on
// purpose: a Switch says "flip it back whenever you like", and this one can't come off on the turn it
// went on, so turning it on asks first. `state` is myMove()'s { on, locked, onBlock }, null with no
// turn open.
//
// `children` is a function handed the button (or null), so the caller can put it in the turn card's
// own button row (TurnCard's `extra`) while anything this has to say still lands under the card.
export default function CombatModeButton({ state, onChanged, children }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  if (!state) return children(null);
  const { on, locked, onBlock, lockedNote } = state;
  const stuck = locked ? (lockedNote ?? LOCKED_ON) : onBlock;

  async function press() {
    setError(null);
    // Nothing to do, but the reason is printed rather than hidden in a tooltip (SHEET.md §3) — and
    // only now, so the box keeps its height the rest of the time.
    if (stuck) {
      setNote(stuck);
      return;
    }
    setNote(null);
    const want = !on;
    if (want) {
      const ok = await confirm({
        title: "Enter combat mode?",
        message:
          "A prerequisite for attacking or intercepting someone and properly defending yourself. It cannot be turned off until next turn, and will tire you out when the turn passes. Effects only apply for combat joined or initiated AFTER you have enabled it.",
        confirmLabel: "Peace was never an option",
        cancelLabel: "Never mind",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await setCombatMode({ on: want });
      if (!res?.ok) setError(res?.error ?? "That didn't work.");
      onChanged?.();
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <button
      type="button"
      className="btn-combat"
      aria-pressed={on}
      aria-disabled={stuck ? "true" : undefined}
      aria-label={`Combat mode: ${on ? "on" : "off"}`}
      disabled={busy}
      onClick={press}
    >
      Combat
    </button>
  );

  return (
    <>
      {children(button)}
      {/* Only while it is still true: the next turn unlocks it without anyone pressing. */}
      {note && note === stuck && <p className="combat-mode-note text-xs text-muted">{note}</p>}
      <FormError>{error}</FormError>
    </>
  );
}
