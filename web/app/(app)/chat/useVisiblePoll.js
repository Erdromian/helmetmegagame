"use client";

import { useEffect } from "react";

// A poll that stands down while nobody is looking. The column's slow
// re-reads — who is here, the party, the Move card, the pockets, the members
// strip — all ran on a bare setInterval, which kept firing in a tab parked
// behind another one and in a phone whose screen was off but not yet
// suspended. A hundred players is a hundred tabs, and most of them are not
// in front of anybody most of the time.
//
// Same gate CharacterPoller.js reads: document.visibilityState, read at fire
// time rather than tracked as a dependency, so the interval never has to be
// torn down and rebuilt. A tick that was skipped because the tab was hidden
// is owed, and paid the moment the tab comes back — otherwise a list that
// went stale in the background stays stale for up to a whole period after
// the reader returns to it.
//
// `fn` is called with nothing and its result is ignored; it owns its own
// errors. Pass `enabled: false` to hold the poll without unmounting it.
export default function useVisiblePoll(fn, intervalMs, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    let owed = false;
    const tick = () => {
      if (document.visibilityState !== "visible") {
        owed = true;
        return;
      }
      owed = false;
      fn();
    };
    const back = () => {
      if (owed && document.visibilityState === "visible") tick();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [fn, intervalMs, enabled]);
}
