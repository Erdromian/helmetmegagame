"use client";

import { useCallback, useEffect, useState } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import ChipLabel from "@/app/components/ChipLabel";
import { useTags } from "@/app/components/TagsProvider";
import { travelFoot, openedByLabel } from "@/lib/travelCost";
import { loadTravel, travelTo } from "./actions";

// TRAVEL: every way out of here as a node you can see, instead of a dropdown
// inside a modal.
//
// The list is loaded when the column mounts and again after a move, never
// with the page: an exit's state moves under a player standing still, and a
// stale list would offer a shut gate. The cost line under each name is the
// same rule the old dialog computed — a local hop is free full stop, a zone
// crossing spends one of the header's count while you have one left ("1
// travel") and costs your Move and a day on the road when you do not (MAP.md
// §3). A trailing "· on foot" or "· indoors" says the crossing (or arrival)
// will dismount whatever you're currently riding or pushing — see travelFoot()
// in web/lib/travelCost.js, which /map draws its own nodes from too.
//
// Nothing that refuses is hidden. A shut gate and a locked door are drawn
// dimmed with the reason on the foot, because knowing the way is there and
// shut is what tells you to go find the winch. A way too narrow for a mount
// no longer refuses at all — see db/lib/indoors.js#dismountForNarrowWay.

// The whole of it, for the hover — the node itself clamps both the name and
// the description, and a refusal replaces the description entirely. `via` is
// the tag of theirs that opens the way, when one does: the chip on the node can
// only carry the name, so the sentence lives here.
function titleFor(option, via) {
  if (!option.passable) return option.reason ?? option.name;
  const head = option.description ? `${option.name} — ${option.description}` : option.name;
  return via ? `${head}\n${openedByLabel(via.name)}` : head;
}

// `pick` is `/travel` reaching in from the composer: { locationId, at }, where
// `at` is a timestamp so picking the same node twice re-opens the strip. It
// only ever SELECTS — the confirm strip and its Go button are still the thing
// that moves anybody's feet, which is the whole reason the command does not
// call travelTo itself.
export default function TravelNodes({ onDone, pick = null }) {
  // The whole catalog plus everything this character holds, streamed from the
  // root layout (web/lib/referenceData.js) — so a way's openedBy slug resolves
  // to a real tag, with its group colour, without a second round trip. It can
  // never miss: openedBy is only set for a tag they are holding.
  const { tagsBySlug } = useTags();
  // Moving changes everything the rest of the column is: the place card, who
  // is here, the Examine lines, the rooms a Transfer can reach. All of those
  // are server props off page.js, so a move that only reloaded this list left
  // the column describing the street it just left.
  const [refresh] = useRefresh();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [target, setTarget] = useState(null);
  // Following a prop by setting state DURING a render, which is the pattern
  // React documents for exactly this and the one
  // react-hooks/set-state-in-effect leaves open. Keyed on `at` rather than on
  // the id, so choosing the same node again after cancelling still opens the
  // strip.
  const [tookPick, setTookPick] = useState(null);
  if (pick?.at && pick.at !== tookPick) {
    setTookPick(pick.at);
    setTarget(pick.locationId ?? null);
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

  const chosen = target ? (data.options.find((o) => o.id === target) ?? null) : null;
  // chosen's OWN count, not the header's ambient one — a boat's bonus is
  // earned per crossing, so a water-eligible destination can still be free
  // even when the header's pre-selection number already reads 0.
  const nextTurn = Boolean(chosen?.crossesZone && chosen.freeLeft <= 0);

  // Travel, in one place: the Go button and a second click on a node are two
  // doors onto the same call, the way the map's are (MAP.md §6c).
  const go = (locationId) =>
    run(travelTo, { locationId }, {
      onOk: (res) => {
        setTarget(null);
        onDone?.(res);
        reload();
        refresh();
      },
    });

  return (
    <div className="chat-travel">
      <p className="chat-section-title" title={data.freeReason ?? undefined}>
        Travel · {data.freeLeft} available
      </p>

      {/* Held where they stand (INTERCEPT.md). The list stays up rather than
          vanishing, with every way drawn shut and the reason on it — the same
          shape a locked gate uses. This says it once, over the top. */}
      {data.held ? <p className="text-sm">{data.held}</p> : null}

      {data.options.length === 0 ? (
        <EmptyState>There is no way out of here. ‡</EmptyState>
      ) : (
        <div className="chat-nodes">
          {data.options.map((option) => {
            const via = option.openedBy ? (tagsBySlug.get(option.openedBy) ?? null) : null;
            return (
            <button
              key={option.id}
              type="button"
              className="chat-node"
              data-crossing={option.crossesZone ? "true" : undefined}
              data-dim={option.passable ? undefined : "true"}
              data-active={target === option.id ? "true" : undefined}
              title={titleFor(option, via)}
              disabled={!option.passable || pending}
              // Picking the same node twice goes there, so a hop need not
              // reach for Go — and because this is a real <button>, Enter on a
              // focused node is the same second pick, with no key handler to
              // maintain. Every node here is already passable; the button is
              // disabled otherwise.
              //
              // The focus() is not redundant. Safari and Firefox on macOS do
              // NOT focus a button on a mouse click, so without it "click one,
              // then press Enter" would work in Chrome and quietly do nothing
              // in half the browsers players actually use.
              onClick={(e) => {
                e.currentTarget.focus();
                if (target !== option.id) {
                  setTarget(option.id);
                  return;
                }
                if (!pending) go(option.id);
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
              {/* A way you can only walk because of something you own. The same
                  ChipLabel the character sheet draws, so it arrives already
                  wearing the tag's group colour — and the flat one rather than
                  TagChip, because an interactive chip cannot live inside this
                  button. */}
              {via && <ChipLabel tag={via} />}
              <span className="chat-node-foot mono">{travelFoot(option, option.freeLeft, data.mounted)}</span>
            </button>
            );
          })}
        </div>
      )}

      {chosen && (
        <div className="chat-travel-confirm">
          <p className="text-sm">
            {nextTurn ? `To ${chosen.name}. This one spends your Move.` : `To ${chosen.name}.`}
          </p>

          {/* Who comes along is the party rack's business now, not this
              strip's — an escort is attached once and persists, so re-ticking
              the same three chips before every hop is gone. All that is owed
              here is the count. */}
          {data.partySize > 0 && (
            <p className="chat-quiet-line">
              {data.partySize === 1 ? "One person" : `${data.partySize} people`} with you. ‡
            </p>
          )}

          <FormError>{error}</FormError>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => go(chosen.id)}
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
