"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "./ConfirmProvider";

// Guards a panel that holds unsaved edits. Exiting by ANY route other than an
// explicit save has to be confirmed, and confirming discards the edits — the
// rule the adjudication panels are held to.
//
// Two layers: guardedClose() covers in-app exits (overlay click, Cancel,
// Escape), and a beforeunload listener covers the browser-level ones (reload,
// tab close, back). The browser dialog's wording is fixed by the user agent;
// only whether it appears is ours to control.
// Module-level counter, incremented/decremented alongside each instance's own
// dirty flag. It's the only cross-component way to ask "is ANYTHING dirty
// right now" (the live-refresh poll on /gm/turns needs exactly that, without
// prop-drilling every panel's guard up to Workspace). Backward compatible:
// nothing else has to change to keep working.
let dirtyInstances = 0;
export function isAnyDirty() {
  return dirtyInstances > 0;
}

// `initialDirty` is for a panel that opens ALREADY holding unsaved content —
// the composer behind "Stage as message" arrives prefilled with the GM's whole
// outcome. Without it that composer is born clean, so Escape, a backdrop click
// or Cancel discarded the message with no confirm, no beforeunload and no
// trace. That is how a staged message came to never be staged.
// `alsoDirty` is for a panel whose unsaved content lives OUTSIDE this hook —
// the desk drafts (deskDraft.js), which survive a reload and so are already
// there on the first render, before anybody has typed anything this mount.
// It is a plain boolean the caller derives, ORed into `dirty`; its
// contribution to the counter is owned by its own effect below rather than by
// markDirty/markClean, so the two can never fight over one instance's 1.
//
// `alsoDirtyHoldsPoll` is the one place those two audiences come apart. A
// draft restored from storage is unsaved work for as long as it exists — it is
// guarded on close and on unload, no argument. But it is only SOMEBODY WRITING
// RIGHT NOW for as long as somebody is writing, and isAnyDirty() is what
// stands the 120s backstop poll down. A draft left on a row last week held
// that poll down for ever, so a caller whose outside content has gone cold
// passes false and keeps the close guard without keeping the desk frozen.
// Typing calls markDirty(), which gates the poll again for this sitting.
export default function useDirtyGuard({
  enabled = true,
  initialDirty = false,
  alsoDirty = false,
  alsoDirtyHoldsPoll = true,
} = {}) {
  const confirm = useConfirm();
  const [selfDirty, setDirty] = useState(initialDirty);
  const dirty = selfDirty || alsoDirty;
  const dirtyRef = useRef(initialDirty);
  // Whether this instance currently contributes its 1 to dirtyInstances. The
  // single source of truth for the counter, so registering, marking and
  // unmounting can never double-count in either direction.
  const counted = useRef(false);

  // Counter mutations stay OUT of the setState updaters: React may call an
  // updater twice (StrictMode, or a rebase in a concurrent transition), and
  // `dirtyInstances` is a side effect — a replayed markClean used to be able
  // to drive it below this instance's real contribution, which silently
  // un-gated the 45s poll and the switch-rows confirm. Same discipline as
  // QueueRail.js's scroll handling.
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (!counted.current) {
      counted.current = true;
      dirtyInstances += 1;
    }
    setDirty(true);
  }, []);
  const markClean = useCallback(() => {
    dirtyRef.current = false;
    if (counted.current) {
      counted.current = false;
      dirtyInstances = Math.max(0, dirtyInstances - 1);
    }
    setDirty(false);
  }, []);

  // Register an initially-dirty panel's contribution, and drop whatever this
  // instance still holds on unmount — unsaved edits in flight (e.g. a hard
  // navigation past beforeunload) must not leave the counter stuck positive.
  useEffect(() => {
    if (dirtyRef.current && !counted.current) {
      counted.current = true;
      dirtyInstances += 1;
    }
    return () => {
      if (counted.current) {
        counted.current = false;
        dirtyInstances = Math.max(0, dirtyInstances - 1);
      }
    };
  }, []);

  useEffect(() => {
    if (!alsoDirty || !alsoDirtyHoldsPoll) return undefined;
    dirtyInstances += 1;
    return () => {
      dirtyInstances = Math.max(0, dirtyInstances - 1);
    };
  }, [alsoDirty, alsoDirtyHoldsPoll]);

  useEffect(() => {
    if (!enabled || !dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set for the prompt to show.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, dirty]);

  const guardedClose = useCallback(
    async (onClose) => {
      if (dirty) {
        const ok = await confirm({
          title: "Discard your changes?",
          message: "This panel has unsaved edits. Closing reverts every change you've made.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
        });
        if (!ok) return false;
      }
      markClean();
      onClose?.();
      return true;
    },
    [confirm, dirty, markClean],
  );

  return { dirty, markDirty, markClean, guardedClose };
}
