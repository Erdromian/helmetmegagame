"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "./ConfirmProvider";
import { soundDeepBeastHorn } from "@/app/(app)/character/bastardActions";

// The Deep Beast Horn, beside the Trumpet in the verb strip and built the same
// way (SoundTrumpetButton.js): its own control rather than an ActionGrid entry,
// because everything in that grid opens a dialog and this commits straight
// away.
//
// It asks first, and it asks harder than the trumpet does: one click is a line
// in every surface Location in the game.
export default function SoundHornButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [sounded, setSounded] = useState(false);
  const confirm = useConfirm();

  async function onClick() {
    setError(null);
    // Awaited OUTSIDE startTransition, or the dialog never renders — the rule
    // RequestActionsProvider.js documents.
    const ok = await confirm({
      title: "Sound the horn?",
      message: "It will be heard everywhere above ground. Nobody will be able to tell where from.",
      confirmLabel: "Sound it",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await soundDeepBeastHorn();
      if (result?.ok) setSounded(true);
      else setError(result?.error ?? "Couldn't sound it.");
    });
  }

  return (
    <>
      <button type="button" className="btn action-strip-item" onClick={onClick} disabled={pending}>
        {pending ? "Sounding…" : "Sound horn"}
      </button>
      {sounded && !error ? <span className="text-muted text-sm">You sound it.</span> : null}
      <FormError>{error}</FormError>
    </>
  );
}
