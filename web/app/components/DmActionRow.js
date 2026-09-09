"use client";

import { useState } from "react";
import { DM_CHOICE, dmActionLabels } from "@lifeweb/db/lib/dmActions";
import { answerDmAction } from "@/app/(app)/chat/dmActions";

// The buttons under a DM that asks something — an offer's Accept/Decline, a
// seat's Decline, the keyed way's Yes/No. On Discord these are message
// components; here they are derived from the row the DM names
// (db/lib/dmActions.js).
//
// The buttons disable on click, before the answer lands. Discord's guard
// against a double-submit is interaction.update() taking the components off the
// message; the web has no such primitive, and the server action's re-check is a
// correctness guard, not a UX one.
//
// Once answered, the outcome replaces the buttons — the same shape the bot
// leaves behind, so the thread reads as a record afterwards.
export default function DmActionRow({ action }) {
  const labels = dmActionLabels(action);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  if (!labels) return null;

  async function answer(choice) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await answerDmAction(action.kind, action.id, choice);
      setOutcome(result?.line ?? "That didn't go through. Try again.");
    } catch {
      setOutcome("That didn't go through. Try again.");
      setBusy(false);
    }
  }

  if (outcome !== null) return <p className="dm-action-outcome">{outcome}</p>;

  return (
    <div className="dm-action-row">
      {labels.accept && (
        <button type="button" className="btn" disabled={busy} onClick={() => answer(DM_CHOICE.ACCEPT)}>
          {labels.accept}
        </button>
      )}
      {labels.decline && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => answer(DM_CHOICE.DECLINE)}>
          {labels.decline}
        </button>
      )}
    </div>
  );
}
