"use client";

import { useState, useTransition } from "react";

// The submit half every dialog file has: pending, the last refusal, and a
// runner that turns a transport failure into a sentence. `onOk(res)` runs
// only on { ok: true }. Confirm before calling this — never inside it.
export default function useSubmit() {
  const [error, setError] = useState(null);
  const [busy, startTransition] = useTransition();

  function submit(action, onOk) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        onOk?.(res);
      } catch {
        setError("Could not reach the server. Nothing was changed. ‡");
      }
    });
  }

  return { submit, busy, error, setError };
}
