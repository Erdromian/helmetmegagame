"use client";

import { useCallback, useState } from "react";
import Modal from "@/app/components/Modal";
import { PreviewContext, PreviewNote } from "@/app/components/previewContext";
import { FixtureDialog, fixtureConfirm } from "./PlacePanel";
import { searchConfirm } from "./RoomPanel";
import { gmFixtureSnapshot } from "./actions";

// A GM OPENING A FIXTURE. Every button a place has is drawn in the GM column
// (next/GmAside.js), whatever key its door asks for, and pressing one opens
// the dialog a player standing there would get — the phone's keypad, the
// vending machine's shelf, the Meister's books — as a PREVIEW:
//
//   - ONE read, when it opens (gmFixtureSnapshot), for the dialogs that show
//     something off the game. It carries which button was pressed and
//     nothing else; a dialog that is only a form (the bell, the intercom, a
//     quest's Interact) reads nothing at all.
//   - After that, NOTHING reaches the server. Typing, picking, keying a
//     number and moving between screens all stay in the browser, and every
//     button that would change the game is greyed out
//     (@/app/components/previewContext.js says how that is held shut).
//
// A fixture that is only a question — a gate, the Gate's finger-prick, the
// Charon, Search — previews as that question with its answer greyed out.
//
// GM bundle only: imported by next/GmAside.js, which a player's page never
// names (./gmTools.js).

// Fixtures whose answer is a confirm rather than a dialog.
const QUESTIONS = new Set(["gate", "gateLever", "keyed", "submitDocumentation", "charonEnter", "charonLeave", "charonLaunch", "charonSleep", "search"]);

// Dialogs that are a form with nothing read behind it, so open with no read.
const NO_READ = new Set(["bell", "pray", "slots", "jukebox", "intercom", "questInteract", "infoterminal"]);

const keyOf = (entry) => `${entry.id}:${entry.roomId ?? entry.linkId ?? ""}`;

function questionFor(entry) {
  if (entry.id === "search") return searchConfirm(entry.roomName, entry.hiddenLine);
  if (entry.kind === "keyed" && entry.held) {
    return { title: entry.label, message: `The way to ${entry.farName} is already being held open.` };
  }
  return fixtureConfirm(entry) ?? { title: entry.label, confirmLabel: entry.label };
}

// The shared confirm's shape (@/app/components/ConfirmProvider.js), with its
// answer greyed out.
function PreviewQuestion({ ask, onClose }) {
  return (
    <Modal open title={ask.title ?? "Are you sure?"} onClose={onClose}>
      <PreviewNote />
      {ask.message && <p className="text-sm">{ask.message}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {ask.confirmLabel && (
          <button type="button" className="btn" disabled>
            {ask.confirmLabel}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * `open(entry)` previews one fixture at `placeKey`; `node` draws whatever is
 * open, and belongs once at the column's root. `opening` is the key of the
 * button whose read is in flight, so it can say so; `error` is a refused read.
 */
export function useGmFixturePreview(placeKey) {
  // Stamped with the place it was opened at, so walking the column to another
  // place closes it rather than leaving the last place's machine on screen.
  const [shown, setShown] = useState(null);
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState(null);

  const close = useCallback(() => setShown(null), []);

  const open = useCallback(
    async (entry) => {
      if (!entry || !placeKey) return;
      setError(null);
      if (QUESTIONS.has(entry.id) || entry.kind === "gate" || entry.kind === "keyed") {
        setShown({ placeKey, question: questionFor(entry), value: { snapshot: null } });
        return;
      }
      if (NO_READ.has(entry.id)) {
        setShown({ placeKey, entry, value: { snapshot: null } });
        return;
      }
      const key = keyOf(entry);
      setOpening(key);
      try {
        const snapshot = await gmFixtureSnapshot(placeKey, {
          id: entry.id,
          roomId: entry.roomId ?? null,
          linkId: entry.linkId ?? null,
        });
        if (snapshot?.ok) setShown({ placeKey, entry, value: { snapshot } });
        else setError(snapshot?.error ?? "Couldn't see it.");
      } catch {
        setError("Couldn't see it.");
      } finally {
        setOpening((now) => (now === key ? null : now));
      }
    },
    [placeKey],
  );

  const live = shown?.placeKey === placeKey ? shown : null;
  let node = null;
  if (live?.question) {
    node = (
      <PreviewContext.Provider value={live.value}>
        <PreviewQuestion ask={live.question} onClose={close} />
      </PreviewContext.Provider>
    );
  } else if (live?.entry) {
    node = (
      <PreviewContext.Provider value={live.value}>
        <FixtureDialog kind={live.entry.id} entry={live.entry} onClose={close} onDone={() => {}} />
      </PreviewContext.Provider>
    );
  }

  return { open, opening, error, node, keyOf };
}
