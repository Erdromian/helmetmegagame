"use client";

import { useCallback, useState, useTransition } from "react";
import { useConfirm } from "./ConfirmProvider";
import { soundTrumpet } from "@/app/(app)/character/trumpetActions";
import { soundDeepBeastHorn } from "@/app/(app)/character/bastardActions";

// The Trumpet and the Deep Beast Horn: each commits on the click, after a
// confirm, rather than opening a dialog through RequestActionsProvider. Shared
// by their own sheet buttons (SoundTrumpetButton.js, SoundHornButton.js) and
// the Things drawer's item menu, so the question, the action and the refusal
// are one thing wherever it is pressed. The server keeps every cooldown.
const SOUNDS = {
  trumpet: {
    label: "Trumpet",
    ask: {
      title: "Sound the trumpet?",
      message: "It will be heard for a long way around, and everyone will know something is happening here.",
      confirmLabel: "Sound it",
    },
    run: soundTrumpet,
  },
  horn: {
    label: "Sound horn",
    // It asks harder than the trumpet does: one click is a line in every
    // surface Location in the game.
    ask: {
      title: "Sound the horn?",
      message: "It will be heard everywhere above ground. Nobody will be able to tell where from.",
      confirmLabel: "Sound it",
    },
    run: soundDeepBeastHorn,
  },
};

export function soundLabel(kind) {
  return SOUNDS[kind]?.label ?? null;
}

export default function useSoundItem() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [sounded, setSounded] = useState(false);
  const confirm = useConfirm();

  const sound = useCallback(
    async (kind) => {
      const entry = SOUNDS[kind];
      if (!entry) return;
      setError(null);
      setSounded(false);
      // Awaited OUTSIDE startTransition, or the dialog never renders — the rule
      // RequestActionsProvider.js documents.
      if (!(await confirm(entry.ask))) return;
      startTransition(async () => {
        const result = await entry.run();
        if (result?.ok) setSounded(true);
        else setError(result?.error ?? "Couldn't sound it.");
      });
    },
    [confirm],
  );

  return { sound, pending, error, sounded };
}
