"use client";

import { useState, useTransition } from "react";
import { playSfx } from "@/app/components/sfx";

// The submit half every dialog file has: pending, the last refusal, and a
// runner that turns a transport failure into a sentence. `onOk(res)` runs
// only on { ok: true }. Confirm before calling this — never inside it.
//
// It is also one of the three places sound reaches a player's own tab (the others are
// ./useActionRunner.js and ../RequestActionsProvider.js). A refusal carries its tone on
// the result from guarded() itself, so every dialog in the game answers a refusal without
// knowing sound exists; a success plays whatever the action named and nothing otherwise.
// `refuseSfx` is for the money surfaces, which buzz rather than click.
export default function useSubmit({ refuseSfx = "refuse" } = {}) {
  const [error, setError] = useState(null);
  const [busy, startTransition] = useTransition();

  function submit(action, onOk) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res?.ok) {
          playSfx(res?.sfx === "refuse" ? refuseSfx : (res?.sfx ?? refuseSfx));
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        playSfx(res.sfx);
        onOk?.(res);
      } catch {
        playSfx(refuseSfx);
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  return { submit, busy, error, setError };
}
