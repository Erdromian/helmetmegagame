"use client";

import { useState, useTransition } from "react";
import { playSfx } from "@/app/components/sfx";
import { actionThrowMessage } from "@/app/components/actionThrow";
import { usePreview } from "@/app/components/previewContext";

// The one shape a button that calls a { ok, error } server action needs: a
// pending flag, the last refusal, and a runner that turns a transport failure
// into a sentence instead of an unhandled rejection. Dozens of surfaces used
// to carry their own copy of these nine lines, and every copy was missing the
// catch — a dropped connection left the button spinning with nothing said.
//
// It is also one of the three doors sound comes through to the person who clicked (the
// others are ./actions/useSubmit.js and ./RequestActionsProvider.js). guarded() puts the
// refusal tone on the result itself, so every one of these surfaces answers a refusal with
// no call site knowing sound exists; a success plays whatever the action named, and stays
// silent when it named nothing. `refuseSfx` is the money surfaces' louder buzz.
export default function useActionRunner({ refuseSfx = "refuse" } = {}) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  // Inside a GM's preview of a dialog (./previewContext.js) nothing is sent:
  // the dialog greys its own buttons, and this is the catch for one it missed.
  const preview = usePreview();

  // `onFail` is for a caller that cleared something optimistically and has to
  // put it back — the chat composer empties its box the moment Enter lands, so
  // a refusal has to hand the words back rather than leave the player retyping
  // them. It fires for BOTH failure shapes: an { ok: false } answer and a
  // thrown one, which are the same thing from the caller's side.
  function exec(action, args, { onOk, onFail } = {}) {
    if (preview) return;
    setError(null);
    startTransition(async () => {
      let message = null;
      // Only the call itself is inside the try. A throw from onOk comes after the action has
      // already landed, and must not be reported as the action failing.
      let res;
      try {
        res = await action(...args);
      } catch (err) {
        playSfx(refuseSfx);
        message = actionThrowMessage(err);
      }
      if (message === null) {
        if (!res?.ok) {
          playSfx(res?.sfx === "refuse" ? refuseSfx : (res?.sfx ?? refuseSfx));
          message = res?.error ?? "Something went wrong.";
        } else {
          playSfx(res.sfx);
          if (onOk) onOk(res);
        }
      }
      if (message !== null) {
        setError(message);
        if (onFail) onFail(message);
      }
    });
  }

  // The common case: one argument, and somewhere to hang onOk/onFail.
  function run(action, arg, opts) {
    exec(action, [arg], opts);
  }

  // For actions that take several positional arguments — the place editor's
  // (zoneId, id, direction) writers. Six of those files each kept a
  // hand-rolled variadic copy of this whole hook rather than bend to `run`.
  function call(action, ...args) {
    exec(action, args);
  }

  return { run, call, pending, error, setError };
}
