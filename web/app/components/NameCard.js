"use client";

import { useEffect, useState } from "react";
import HoverCard from "./HoverCard";
import { lookAtRow } from "@/app/(app)/chat/actions";
import { actionThrowMessage } from "./actionThrow";

// A NAME YOU CAN HOVER: what you can see on somebody and what you remember of
// them, over their name in the feed and the Here list. It is the Look's own
// readout (db/lib/examineRow.js, via lookAtRow), cut down to the two halves a
// glance wants — no new rule lives here. So everything the eye withholds, this
// withholds too: a hood draws nothing from your memories, a stranger reads under
// their alias, and a blindfold answers with the blindness line.
//
// Keyed by the LINE (`seq`), never by a character id, for the same reason the
// eye is: a stranger's or a hood's row carries no id to send. It shows them as
// they were when that line was said, which is what the eye shows.
//
// A look is a server round trip, so the card waits a beat before asking —
// sweeping the pointer down the feed crosses a dozen names and should cost
// nothing — and keeps each answer for a minute, long enough that hovering the
// same person twice is free, short enough that a note you just wrote on
// /memories turns up.

const ASK_AFTER_MS = 250;
const KEEP_MS = 60_000;

const cache = new Map(); // seq → { at, promise }

function lookUp(seq) {
  const key = String(seq);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = lookAtRow(key).then(
    (res) => {
      // A refusal is not kept: the blindfold comes off, the lights come on.
      if (!res?.ok) cache.delete(key);
      return res;
    },
    (err) => {
      cache.delete(key);
      return { ok: false, error: actionThrowMessage(err) };
    },
  );
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export default function NameCard({ seq, children, pinnable = true }) {
  if (seq == null) return children;
  return (
    <HoverCard className="hover-bare name-card-trigger" pinnable={pinnable} panel={<NameCardBody seq={seq} />}>
      {children}
    </HoverCard>
  );
}

// Mounted only while the card is open, so closing it before the beat is up asks nothing.
function NameCardBody({ seq }) {
  const [state, setState] = useState({ readout: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await lookUp(seq);
      if (cancelled) return;
      if (res?.ok) setState({ readout: res.readout, error: null });
      else setState({ readout: null, error: res?.error ?? "You can't see them." });
    }, ASK_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [seq]);

  if (state.error) return <span className="name-card name-card-quiet">{state.error}</span>;
  if (!state.readout) return <span className="name-card name-card-quiet">Looking…</span>;

  const r = state.readout;
  const knownAs = r.memory?.name && r.memory.name !== r.name ? r.memory.name : null;
  const notes = r.memory?.notes?.trim() || null;
  const seen = [...(r.ailments ?? []), ...(r.equipment ?? []), ...(r.tags ?? []).map((t) => t.name)];

  // `memory` is null for a stranger and a hood (db/lib/examine.js), and a
  // hood's readout carries its own line saying so.
  let recall = null;
  if (!r.memory) recall = r.concealed && r.line ? r.line : "You don't know them.";
  else if (!knownAs && !notes) recall = r.roleTitle ? "No notes." : "You know their name, nothing more.";

  return (
    <span className="name-card">
      <span className="name-card-name">{r.name}</span>
      {r.roleTitle && (
        <span className="name-card-role" data-role-group={r.roleGroup ?? undefined}>
          {r.roleTitle}
        </span>
      )}

      <span className="name-card-label">What you remember</span>
      {knownAs && <span className="name-card-text">You know them as {knownAs}.</span>}
      {notes && <span className="name-card-text name-card-notes">{notes}</span>}
      {recall && <span className="name-card-quiet">{recall}</span>}

      <span className="name-card-label">What you can see</span>
      {seen.length > 0 ? (
        <span className="name-card-chips">
          {seen.map((name, i) => (
            <span key={`${name}-${i}`} className="chip">
              {name}
            </span>
          ))}
        </span>
      ) : (
        <span className="name-card-quiet">Nothing stands out.</span>
      )}
    </span>
  );
}
