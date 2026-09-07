"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import { loadTravel, travelTo, turnBackTravel } from "./actions";

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
    if (/locked/i.test(reason)) return "locked ‡";
    if (/shut/i.test(reason)) return "shut ‡";
    return reason || "no way ‡";
  }
  if (!option.crossesZone) return "free ‡";
  return freeLeft > 0 ? "free ‡" : "the turn ‡";
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
        if (!cancelled) setData({ ok: false, error: "Couldn't read the road. ‡" });
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
      <div className="hall-travel">
        <p className="hall-section-title">Travel ‡</p>
        <p className="hall-quiet-line">Reading the road… ‡</p>
      </div>
    );
  }
  if (!data.ok) {
    return (
      <div className="hall-travel">
        <p className="hall-section-title">Travel ‡</p>
        <FormError>{data.error}</FormError>
      </div>
    );
  }

  // Already walking: a paid crossing is a day on the road, and the only thing
  // on offer is turning round.
  if (data.heading) {
    return (
      <div className="hall-travel">
        <p className="hall-section-title">Travel ‡</p>
        <p className="text-sm">Leaving for {data.heading} at the turn. ‡</p>
        <FormError>{error}</FormError>
        <div className="hall-buttons">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              run(turnBackTravel, undefined, {
                onOk: (res) => {
                  onDone?.(res);
                  reload();
                  router.refresh();
                },
              })
            }
          >
            Turn back ‡
          </button>
        </div>
      </div>
    );
  }

  const chosen = target ? (data.options.find((o) => o.id === target) ?? null) : null;
  const nextTurn = Boolean(chosen?.crossesZone && data.freeLeft <= 0);

  return (
    <div className="hall-travel">
      <p className="hall-section-title" title={data.freeReason ?? undefined}>
        Travel · {data.freeLeft} free ‡
      </p>

      {data.options.length === 0 ? (
        <EmptyState>There is no way out of here. ‡</EmptyState>
      ) : (
        <div className="hall-nodes">
          {data.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="hall-node"
              data-crossing={option.crossesZone ? "true" : undefined}
              data-dim={option.passable ? undefined : "true"}
              data-active={target === option.id ? "true" : undefined}
              title={option.passable ? option.name : (option.reason ?? option.name)}
              disabled={!option.passable || pending}
              onClick={() => {
                setTarget(target === option.id ? null : option.id);
                setDragged([]);
              }}
            >
              <span className="hall-node-name">{option.name}</span>
              <span className="hall-node-zone">{option.zoneName}</span>
              <span className="hall-node-foot mono">{footFor(option, data.freeLeft)}</span>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <div className="hall-travel-confirm">
          <p className="text-sm">
            {nextTurn ? `To ${chosen.name}, next turn. ‡` : `To ${chosen.name}. ‡`}
          </p>

          {data.drag.length > 0 && (
            <div className="chip-row" role="group" aria-label="Bring somebody ‡">
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
          <div className="hall-buttons">
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
              Go ‡
            </button>
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => setTarget(null)}>
              Cancel ‡
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
