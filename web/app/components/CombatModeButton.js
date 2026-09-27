"use client";

import { useState } from "react";
import { AttackIcon } from "./icons";
import { useConfirm } from "./ConfirmProvider";
import FormError from "./FormError";
import { setCombatMode } from "@/app/(app)/chat/actions";
import { LOCKED_ON } from "@lifeweb/db/lib/combatMode";

// Combat mode (docs/systemdocs/COMBAT-MODE.md): the square toggle under the Turn block on /chat and
// in the sheet's This turn box. It glows red while on (Combat Mode.docx). A bevelled button with
// aria-pressed rather than the Switch every other boolean uses, on purpose: a Switch says "flip it
// back whenever you like", and this one can't come off on the turn it went on, so turning it on asks
// first. `state` is myMove()'s { on, locked, onBlock }, null with no turn open.
export default function CombatModeButton({ state, onChanged, size = "md" }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!state) return null;
  const { on, locked, onBlock } = state;

  async function press() {
    setError(null);
    const want = !on;
    if (want) {
      const ok = await confirm({
        title: "Enter combat mode?",
        message:
          "You can't turn it off until next turn. Each turn you end in combat mode makes you Tired, then Exhausted.",
        confirmLabel: "Enter combat mode",
        cancelLabel: "Not yet",
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

  // Printed, never a tooltip (SHEET.md §3): why it can't be pressed, or what it is for.
  const note = locked
    ? LOCKED_ON
    : onBlock
      ? onBlock
      : on
        ? "Each turn you end in it tires you."
        : "Needed to Attack or Intercept.";

  return (
    <div className="combat-mode" data-size={size}>
      <button
        type="button"
        className="btn-combat"
        aria-pressed={on}
        disabled={busy || locked || Boolean(onBlock)}
        onClick={press}
      >
        <AttackIcon size={size === "lg" ? 22 : 18} aria-hidden="true" />
        <span className="btn-combat-label">Combat mode</span>
        <span className="btn-combat-state">{on ? "On" : "Off"}</span>
      </button>
      <div className="combat-mode-note">
        <p className="text-xs text-muted">{note}</p>
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}
