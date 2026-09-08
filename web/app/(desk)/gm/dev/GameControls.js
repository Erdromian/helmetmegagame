"use client";

import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { openLobby, closeLobby, startGame, endGame, resumeGame } from "@/app/(app)/gm/dev/gameActions";

// The phase buttons on the Game section. A client component for the same
// reasons EndTurnButton.js is one: the actions return { ok, error } instead of
// throwing, a pending transition needs a visible label, and Start and End
// deserve a confirm in front of them.
//
// Which buttons render is decided here from `phase`, and every action
// re-checks the phase server-side, so a stale tab gets a refusal rather than
// a second transition.
export default function GameControls({ phase, readyCount, hasDraft }) {
  const confirm = useConfirm();
  const { run, pending, error } = useActionRunner();

  async function onStart() {
    const ok = await confirm({
      title: "Start the game?",
      message:
        readyCount > 0
          ? `${readyCount} readied player${readyCount === 1 ? "" : "s"} will be assigned and DMed.`
          : "Nobody has readied up.",
      confirmLabel: "Start game",
      cancelLabel: "Not yet",
    });
    if (ok) run(startGame);
  }

  async function onEnd(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const ok = await confirm({
      title: "End the game?",
      message:
        "The clock stops and the archive opens to every player. ‡",
      confirmLabel: "End game",
      cancelLabel: "Keep playing",
    });
    if (ok) run(endGame, formData);
  }

  return (
    <div className="flex flex-col gap-3">
      {phase === "CLOSED" ? (
        <div className="ops-actions">
          <button type="button" className="btn" onClick={() => run(openLobby)} disabled={pending}>
            {pending ? "Opening…" : "Open lobby"}
          </button>
          {readyCount > 0 ? (
            <button type="button" className="btn" onClick={onStart} disabled={pending || !hasDraft}>
              {pending ? "Starting…" : "Start game"}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === "LOBBY" ? (
        <div className="ops-actions">
          <button type="button" className="btn-secondary" onClick={() => run(closeLobby)} disabled={pending}>
            Close lobby
          </button>
          <button type="button" className="btn" onClick={onStart} disabled={pending || (readyCount > 0 && !hasDraft)}>
            {pending ? "Starting…" : "Start game"}
          </button>
        </div>
      ) : null}

      {phase === "RUNNING" ? (
        <form onSubmit={onEnd} className="flex flex-col gap-2">
          <label className="field">
            <span className="field-label">Closing note (optional)</span>
            <textarea
              name="closingNote"
              rows={3}
              maxLength={4000}
            />
          </label>
          <div className="ops-actions">
            <button type="submit" className="btn-danger" disabled={pending}>
              {pending ? "Ending…" : "End game"}
            </button>
          </div>
        </form>
      ) : null}

      {phase === "ENDED" ? (
        <div className="ops-actions">
          <button type="button" className="btn-secondary" onClick={() => run(resumeGame)} disabled={pending}>
            {pending ? "Resuming…" : "Resume game"}
          </button>
        </div>
      ) : null}

      <FormError>{error}</FormError>
    </div>
  );
}
