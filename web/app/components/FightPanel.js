"use client";

import { useState } from "react";
import FormError from "./FormError";
import useSubmit from "./actions/useSubmit";
import { SURPRISED, INVITE_SURPRISED, DESCRIPTION_LIMIT } from "@lifeweb/db/lib/combatMode";
import {
  answerFightInviteRequest,
  describeFightRequest,
  callOffFightRequest,
} from "@/app/(app)/character/attackActions";

// The fight you are in (docs/systemdocs/ATTACK.md §4). Who is on which side, by the face you know them
// by; your invitation if you have one; what you are doing in it, written and rewritten until Moves lock,
// or the plain fact that you were caught by surprise; and Call off for the attacking side.
//
// `view` is db/lib/combat.js#combatViewFor's shape and never carries a roll. Every button names the
// viewer's own participant row, so nothing here holds anybody else's id.
//
// Nothing is a tooltip (SHEET.md §3): what each button does is said on the page.
export default function FightPanel({ view, onChanged }) {
  const [text, setText] = useState(view.description ?? "");
  const { submit, busy, error } = useSubmit();
  const dirty = text.trim() !== (view.description ?? "").trim();

  function run(action, input) {
    submit(
      () => action({ participantId: view.participantId, ...input }),
      (res) => onChanged?.(res.line),
    );
  }

  const joined = view.status === "JOINED";
  return (
    <div className="fight-panel">
      <p className="text-sm">
        {view.fromAmbush ? "An ambush" : "A fight"}
        {view.locationName ? ` at ${view.locationName}` : ""}. Nobody in it can leave until it&apos;s over.
      </p>
      <Side label="Attacking" people={view.attackers} />
      <Side label="Defending" people={view.defenders} />

      {view.status === "INVITED" ? (
        <div className="field">
          <p className="text-sm">You&apos;ve been asked to join the attack. You can&apos;t leave until you answer.</p>
          {view.alert ? null : <p className="text-sm text-muted">{INVITE_SURPRISED}</p>}
          <div className="chat-buttons">
            <button type="button" className="btn" disabled={busy || !view.canAnswer} onClick={() => run(answerFightInviteRequest, { join: true })}>
              Join
            </button>
            <button type="button" className="btn-quiet" disabled={busy || !view.canAnswer} onClick={() => run(answerFightInviteRequest, { join: false })}>
              Decline
            </button>
          </div>
          <p className="text-xs text-muted">If you decline you can go, but you can&apos;t attack anyone here until next turn.</p>
        </div>
      ) : null}

      {joined && view.alert ? (
        <label className="field">
          <span className="field-label">What do you do?</span>
          <textarea
            rows={4}
            value={text}
            disabled={!view.canDescribe || busy}
            placeholder="Describe how you fight."
            onChange={(e) => setText(e.target.value)}
          />
          <span className="text-xs text-muted">
            {view.locked
              ? "Moves are locked, so this can't be changed now."
              : `You can change this until Moves lock. ${text.length}/${DESCRIPTION_LIMIT}`}
          </span>
          {view.canDescribe ? (
            <div className="chat-buttons">
              <button
                type="button"
                className="btn"
                disabled={busy || !dirty || !text.trim() || text.length > DESCRIPTION_LIMIT}
                onClick={() => run(describeFightRequest, { text })}
              >
                Save
              </button>
            </div>
          ) : null}
        </label>
      ) : null}
      {joined && !view.alert ? <p className="text-sm text-muted">{SURPRISED}</p> : null}

      {joined && view.side === "ATTACKER" ? (
        <div className="field">
          {view.calledOff ? (
            <p className="text-sm text-muted">
              You want to call it off. Waiting on {view.waitingOn === 1 ? "1 more person" : `${view.waitingOn} more people`} on your side.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                A fight is only called off once everyone attacking agrees. Then you stay here another 30 minutes in case they answer it.
              </p>
              <div className="chat-buttons">
                <button type="button" className="btn-quiet" disabled={busy || !view.canCallOff} onClick={() => run(callOffFightRequest, {})}>
                  Call off
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <FormError>{error}</FormError>
    </div>
  );
}

function Side({ label, people }) {
  if (!people?.length) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <p className="text-sm">
        {people.map((p, i) => (
          <span key={`${label}-${i}`}>
            {i > 0 ? ", " : ""}
            {p.me ? <strong>you</strong> : p.name}
            {p.status === "INVITED" ? <span className="text-muted"> (asked to join)</span> : null}
          </span>
        ))}
      </p>
    </div>
  );
}
