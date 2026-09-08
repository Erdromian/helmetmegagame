"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import { loadTravel, travelTo } from "./actions";

// TRAVEL: every way out of here as a node you can see, instead of a dropdown
// inside a modal.
//
// The list is loaded when the column mounts and again after a move, never
// with the page: an exit's state moves under a player standing still, and a
// stale list would offer a shut gate. The cost line under each name is the
// same rule the old dialog computed — a local hop is free, a zone crossing is
// free while you have one left and costs your Move and a day on the road when
// you do not (MAP.md §3).
//
// Nothing that refuses is hidden. A shut gate and a locked door are drawn
// dimmed with the reason on the foot, because knowing the way is there and
// shut is what tells you to go find the winch.

// Short enough to sit in a square. The full sentence is on the node's title.
function footFor(option, freeLeft) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  if (!option.crossesZone) return "free";
  return freeLeft > 0 ? "free" : "the turn";
}

// The whole of it, for the hover — the node itself clamps both the name and
// the description, and a refusal replaces the description entirely.
function titleFor(option) {
  if (!option.passable) return option.reason ?? option.name;
  return option.description ? `${option.name} — ${option.description}` : option.name;
}

// `pick` is `/travel` reaching in from the composer: { locationId, at }, where
// `at` is a timestamp so picking the same node twice re-opens the strip. It
// only ever SELECTS — the confirm strip and its Go button are still the thing
// that moves anybody's feet, which is the whole reason the command does not
// call travelTo itself.
export default function TravelNodes({ onDone, pick = null }) {
  // Moving changes everything the rest of the column is: the place card, who
  // is here, the Examine lines, the rooms a Transfer can reach. All of those
  // are server props off page.js, so a move that only reloaded this list left
  // the column describing the street it just left.
  const router = useRouter();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [target, setTarget] = useState(null);
  const [dragged, setDragged] = useState([]);
  // Following a prop by setting state DURING a render, which is the pattern
  // React documents for exactly this and the one
  // react-hooks/set-state-in-effect leaves open. Keyed on `at` rather than on
  // the id, so choosing the same node again after cancelling still opens the
  // strip.
  const [tookPick, setTookPick] = useState(null);
  if (pick?.at && pick.at !== tookPick) {
    setTookPick(pick.at);
    setTarget(pick.locationId ?? null);
    setDragged([]);
  }
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    loadTravel()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the road." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const toggleDrag = useCallback(
    (id) => setDragged((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [],
  );

  if (!data) {
    return (
      <div className="chat-travel">
        <p className="chat-section-title">Travel</p>
        <p className="chat-quiet-line">Reading the road…</p>
      </div>
    );
  }
  if (!data.ok) {
    return (
      <div className="chat-travel">
        <p className="chat-section-title">Travel</p>
        <FormError>{data.error}</FormError>
      </div>
    );
  }

  // Already walking: a paid crossing is a day on the road, and there is no
  // way off it — the arrival pass walks them over at the next advance.
  if (data.heading) {
    return (
      <div className="chat-travel">
        <p className="chat-section-title">Travel</p>
        <p className="text-sm">Leaving for {data.heading} at the turn. ‡</p>
      </div>
    );
  }

  const chosen = target ? (data.options.find((o) => o.id === target) ?? null) : null;
  const nextTurn = Boolean(chosen?.crossesZone && data.freeLeft <= 0);

  return (
    <div className="chat-travel">
      <p className="chat-section-title" title={data.freeReason ?? undefined}>
        Travel · {data.freeLeft} free
      </p>

      {data.options.length === 0 ? (
        <EmptyState>There is no way out of here. ‡</EmptyState>
      ) : (
        <div className="chat-nodes">
          {data.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="chat-node"
              data-crossing={option.crossesZone ? "true" : undefined}
              data-dim={option.passable ? undefined : "true"}
              data-active={target === option.id ? "true" : undefined}
              title={titleFor(option)}
              disabled={!option.passable || pending}
              onClick={() => {
                setTarget(target === option.id ? null : option.id);
                setDragged([]);
              }}
            >
              <span className="chat-node-name">{option.name}</span>
              <span className="chat-node-zone">{option.zoneName}</span>
              {/* What the place IS, so a way out is more than a name. Clamped
                  in CSS rather than truncated here: the whole line is on the
                  node's title either way, and cutting the string would cut it
                  at a character count instead of at the box. */}
              {option.description && (
                <span className="chat-node-desc">{option.description}</span>
              )}
              <span className="chat-node-foot mono">{footFor(option, data.freeLeft)}</span>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <div className="chat-travel-confirm">
          <p className="text-sm">
            {nextTurn ? `To ${chosen.name}, next turn.` : `To ${chosen.name}.`}
          </p>

          {data.drag.length > 0 && (
            <div className="chip-row" role="group" aria-label="Bring somebody">
              {data.drag.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="chip"
                  // `reason` is why they CAN be brought along — a corpse, a
                  // body that can't stop you, your own faction — not a
                  // refusal (db/lib/locationTravel.js#dragReason). Every
                  // candidate on this list is already draggable.
                  title={person.reason ?? undefined}
                  data-active={dragged.includes(person.id) ? "true" : undefined}
                  aria-pressed={dragged.includes(person.id)}
                  onClick={() => toggleDrag(person.id)}
                >
                  {person.name}
                </button>
              ))}
            </div>
          )}

          <FormError>{error}</FormError>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() =>
                run(travelTo, { locationId: chosen.id, draggedIds: dragged }, {
                  onOk: (res) => {
                    setTarget(null);
                    setDragged([]);
                    onDone?.(res);
                    reload();
                    router.refresh();
                  },
                })
              }
            >
              Go
            </button>
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
