"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
import FormError from "./FormError";
import { DESCRIPTION_LIMIT, CAVING_SURPRISED } from "@lifeweb/db/lib/combatMode";
import { loadMyCavingResponse, respondToCavingRequest } from "@/app/(app)/character/cavingActions";

// Where an alert caver writes how they respond to a failed Caving roll (docs/systemdocs/COMBAT-MODE.md §6) — the
// web's half of the trouble DM's "Write your response" modal. Opened from the line under the turn card
// (CavingLine.js) and from the DM itself (DmThread.js). `rollId` is the DM's roll, null from the line; the server
// works out the result either way. What they wrote so far is read when it opens, so the two faces never disagree.
export default function CavingResponseDialog({ rollId = null, onClose, onSaved }) {
  const [state, setState] = useState({ loaded: false, canWrite: false, saved: "", error: null });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    loadMyCavingResponse()
      .then((res) => {
        if (!live) return;
        if (!res?.ok) return setState({ loaded: true, canWrite: false, saved: "", error: res?.error ?? "Couldn't load it." });
        setState({ loaded: true, canWrite: res.canWrite, saved: res.response ?? "", error: null, locationName: res.locationName });
        setText(res.response ?? "");
      })
      .catch(() => live && setState({ loaded: true, canWrite: false, saved: "", error: "Couldn't load it." }));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setLine(null);
    try {
      const res = await respondToCavingRequest({ rollId, text });
      if (!res?.ok) return setError(res?.error ?? "That didn't work.");
      setLine(res.line);
      setState((s) => ({ ...s, saved: text.trim() }));
      onSaved?.(text.trim());
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = text.trim() !== (state.saved ?? "").trim();

  return (
    <Modal title="Your response" onClose={() => !busy && onClose?.()}>
      <div className="flex flex-col gap-3">
        {!state.loaded ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : state.error ? (
          <FormError>{state.error}</FormError>
        ) : !state.canWrite ? (
          <p className="text-sm">{CAVING_SURPRISED}</p>
        ) : (
          <label className="field">
            <span className="field-label">
              Something is wrong down here{state.locationName ? ` in ${state.locationName}` : ""}. How do you respond?
            </span>
            <textarea
              rows={5}
              value={text}
              disabled={busy}
              data-autofocus
              maxLength={DESCRIPTION_LIMIT}
              placeholder="Describe what you do."
              onChange={(e) => setText(e.target.value)}
            />
            <span className="text-xs text-muted">
              It covers everything that goes wrong down here this turn. You can change it until Moves lock.{" "}
              {text.length}/{DESCRIPTION_LIMIT}
            </span>
          </label>
        )}
        <FormError>{error}</FormError>
        {line ? <p className="text-sm">{line}</p> : null}
        <div className="chat-buttons">
          <button type="button" className="btn-quiet" onClick={() => onClose?.()} disabled={busy}>
            Close
          </button>
          {state.canWrite && !state.error ? (
            <button type="button" className="btn" onClick={save} disabled={busy || !dirty || !text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
