"use client";

import { useRequestActions } from "./RequestActionsProvider";

// One line under the turn card, on /chat and the sheet, while you are in a fight — the doc's "prompted in
// the webpage". It opens the Attack dialog, which is where the fight lives. `fight` is chat/actions.js#myMove's
// summary: where, and whether you have something to do in it.
export default function FightLine({ fight }) {
  const actions = useRequestActions();
  if (!fight) return null;
  const where = fight.locationName ? ` at ${fight.locationName}` : "";
  const line =
    fight.status === "INVITED"
      ? "You've been asked to join a fight."
      : fight.needsWriting
        ? `You're in a fight${where}. Write what you do.`
        : `You're in a fight${where}.`;
  return (
    <div className="chat-waiting-row">
      <p className="quote">{line}</p>
      {actions?.open ? (
        <div className="chat-buttons">
          <button type="button" className="btn" onClick={() => actions.open("attack")}>
            Open
          </button>
        </div>
      ) : null}
    </div>
  );
}
