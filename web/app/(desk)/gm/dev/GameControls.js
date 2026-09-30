"use client";

import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useState } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  openLobby,
  closeLobby,
  startGame,
  endGame,
  resumeGame,
  repostGameEnded,
  startSessionNow,
} from "@/app/(app)/gm/dev/gameActions";

// How many of Start's problems are listed before the rest are counted.
const PROBLEMS_SHOWN = 10;

// The phase buttons on the Game section. A client component for the same
// reasons EndTurnButton.js is one: the actions return { ok, error } instead of
// throwing, a pending transition needs a visible label, and Start and End
// deserve a confirm in front of them.
//
// Which buttons render is decided here from `phase`, and every action
// re-checks the phase server-side, so a stale tab gets a refusal rather than
// a second transition.
//
// `outOfSession` is the Sessions game type with no session open
// (docs/systemdocs/SESSIONS.md): a game started then is frozen until one opens,
// and the Sessions panel that opens it sits on another section.
export default function GameControls({ phase, readyCount, hasDraft, outOfSession, sessionNextLabel }) {
  const confirm = useConfirm();
  const { run, pending, error } = useActionRunner();
  // Whether the reveal reached #turns. null until an End or a repost has
  // answered, so a page opened on an already-ended game says nothing rather
  // than guessing.
  const [revealPosted, setRevealPosted] = useState(null);
  // What Start could not do around the commit (db/lib/lobby.js#startProblems).
  // Only this tab sees it; the audit log keeps it as game_start_problems.
  const [startProblems, setStartProblems] = useState([]);

  async function onStart() {
    const seats =
      readyCount > 0
        ? `${readyCount} readied player${readyCount === 1 ? "" : "s"} will be assigned and DMed.`
        : "Nobody has readied up.";
    const ok = await confirm({
      title: "Start the game?",
      message: outOfSession
        ? `${seats} The game type is Sessions and no session is open, so nobody can act until one does. ${sessionNextLabel}`
        : seats,
      confirmLabel: "Start game",
      cancelLabel: "Not yet",
    });
    if (ok) run(startGame, undefined, { onOk: (res) => setStartProblems(res?.problems ?? []) });
  }

  async function onEnd(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const ok = await confirm({
      title: "End the game?",
      message: "The clock stops.",
      confirmLabel: "End game",
      cancelLabel: "Keep playing",
    });
    if (ok) run(endGame, formData, { onOk: (res) => setRevealPosted(res?.posted !== false) });
  }

  function onRepost() {
    run(repostGameEnded, undefined, { onOk: (res) => setRevealPosted(res?.posted !== false) });
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

      {startProblems.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-accent">The game started, but not everything around it did:</p>
          <ul className="text-sm text-muted">
            {startProblems.slice(0, PROBLEMS_SHOWN).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          {startProblems.length > PROBLEMS_SHOWN ? (
            <p className="text-xs text-muted">
              …and {startProblems.length - PROBLEMS_SHOWN} more, in the audit log as game_start_problems.
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "RUNNING" && outOfSession ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-accent">Not in session: nobody can act until a session opens. {sessionNextLabel}</p>
          <div className="ops-actions">
            <button type="button" className="btn" onClick={() => run(startSessionNow)} disabled={pending}>
              {pending ? "Starting…" : "Start a session now"}
            </button>
          </div>
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
        <div className="flex flex-col gap-2">
          {revealPosted === false ? (
            <p className="text-sm text-accent">The game ended, but the reveal did not reach #turns.</p>
          ) : null}
          {revealPosted === true ? (
            <p className="text-sm text-muted">The reveal is up in #turns.</p>
          ) : null}
          <div className="ops-actions">
            <button type="button" className="btn-secondary" onClick={() => run(resumeGame)} disabled={pending}>
              {pending ? "Resuming…" : "Resume game"}
            </button>
            <button type="button" className="btn-secondary" onClick={onRepost} disabled={pending}>
              {pending ? "Posting…" : "Post the reveal again"}
            </button>
          </div>
        </div>
      ) : null}

      <FormError>{error}</FormError>
    </div>
  );
}
