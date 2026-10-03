"use client";

import { useEffect, useState } from "react";
import HoverCard from "@/app/components/HoverCard";
import { actionThrowMessage } from "@/app/components/actionThrow";
import { ALERT_LINE } from "@lifeweb/db/lib/combatMode";
import { gmCardOf } from "./actions";
import GmLook from "@/app/components/GmLook";

// A NAME A GM CAN HOVER — the GM seat's twin of NameCard.js, drawn in the
// same card. A player's card is what they remember of somebody and what they
// can see; a GM remembers nobody, so the first half is the truth instead —
// the real name, the real role in its estate colour, and the name the room
// had for them when it was not their own. The second half is what the room
// could see, frozen at the line for a feed name (./actions.js#gmCardOf).
//
// Keyed by the LINE (`seq`) in the feed, like the player's, so a hooded line
// works without the page being told who was under the hood; keyed by
// `characterId` in the GM's own lists, which already carry ids.
//
// GM-only, so it reaches the page through ./gmTools.js and never ships in a
// player's bundle. Same beat and same minute's cache as NameCard.

const ASK_AFTER_MS = 250;
const KEEP_MS = 60_000;

const cache = new Map(); // "seq:…" | "id:…" → { at, promise }

function lookUp(seq, characterId) {
  const key = seq != null ? `seq:${seq}` : `id:${characterId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = gmCardOf(seq != null ? { seq: String(seq) } : { characterId }).then(
    (res) => {
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

export default function GmNameCard({ seq = null, characterId = null, children, pinnable = true }) {
  if (seq == null && !characterId) return children;
  return (
    <HoverCard
      className="hover-bare name-card-trigger"
      pinnable={pinnable}
      panel={<GmNameCardBody seq={seq} characterId={characterId} />}
    >
      {children}
    </HoverCard>
  );
}

// Mounted only while the card is open, so closing it before the beat is up asks nothing.
function GmNameCardBody({ seq, characterId }) {
  const [state, setState] = useState({ card: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await lookUp(seq, characterId);
      if (cancelled) return;
      if (res?.ok) setState({ card: res, error: null });
      else setState({ card: null, error: res?.error ?? "Nobody said that." });
    }, ASK_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [seq, characterId]);

  if (state.error) return <span className="name-card name-card-quiet">{state.error}</span>;
  if (!state.card) return <span className="name-card name-card-quiet">Looking…</span>;

  const c = state.card;
  return (
    <span className="name-card">
      <span className="name-card-name">{c.name}</span>
      {c.roleTitle && (
        <span className="name-card-role" data-role-group={c.roleGroup ?? undefined}>
          {c.roleTitle}
        </span>
      )}
      {/* On a line: how they looked saying it, and now if that changed. On a person: how they look now. */}
      <GmLook then={c.look?.then ?? null} now={c.look?.now ?? null} frozen={c.look?.then !== undefined} />

      <span className="name-card-label">What the room could see</span>
      {c.alert && <span className="name-card-text">{ALERT_LINE}</span>}
      {c.seen.length > 0 && (
        <span className="name-card-chips">
          {c.seen.map((name, i) => (
            <span key={`${name}-${i}`} className="chip">
              {name}
            </span>
          ))}
        </span>
      )}
      {c.seen.length === 0 && !c.alert && <span className="name-card-quiet">Nothing stands out.</span>}
    </span>
  );
}
