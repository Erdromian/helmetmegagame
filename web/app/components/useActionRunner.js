"use client";

import { useState, useTransition } from "react";

// The one shape a button that calls a { ok, error } server action needs: a
// pending flag, the last refusal, and a runner that turns a transport failure
// into a sentence instead of an unhandled rejection. Three surfaces on the
// lobby side used to carry their own copy of these nine lines.
export default function useActionRunner() {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function run(action, arg, { onOk } = {}) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action(arg);
        if (!res?.ok) setError(res?.error ?? "Something went wrong.");
        else if (onOk) onOk(res);
      } catch {
        setError("Could not reach the server. Nothing was changed. ‡");
      }
    });
  }

  return { run, pending, error, setError };
}
