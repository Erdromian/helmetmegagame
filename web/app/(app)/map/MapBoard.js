"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { travelFoot } from "@/lib/travelCost";
import { loadMap } from "./actions";
import { travelTo } from "../play/actions";

// The map. Every Location this character knows, drawn on the plate it was
// measured against, with the ways between them.
//
// One component, two hosts: the /map route and the overlay on /play. Neither
// passes it anything except an optional onClose, because everything it draws
// comes from loadMap() — which is also where the fog lives. Nothing is hidden
// here that the server sent: an unknown Location never arrives in the first
// place.
//
// Travel is not re-implemented. Picking a reachable node opens the same
// confirm strip the Travel panel uses, reading the same numbers through
// travelFoot(), and Go calls the same travelTo action. There is one mover.

// Rhombus half-widths, in plate pixels. The plate is 2144 wide, so these are
// small on screen until you zoom — which is the point: the shape reads as a
// marker on a map rather than a button on a page.
// A place you have only seen is drawn SMALLER as well as hollow. Town packs
// seven Locations into a couple of hundred plate pixels, so at a fit that
// frames the whole of what you know they collide — and the ones worth the
// room are the ones you have actually been to.
const RIM = { here: 27, stood: 21, seen: 16 };
const CORE = { here: 19, stood: 14, seen: 11 };
// The floor is 1, not something smaller, and that is the whole "no blank
// space" rule: at k=1 the plate exactly covers the window, so zooming out past
// it is zooming out past the world. Paired with preserveAspectRatio="slice"
// below, which CROPS the plate to fill the board rather than letterboxing it
// inside — "meet" left bars down the sides on any screen whose shape did not
// happen to match a 2144x1792 drawing.
const ZOOM = { min: 1, max: 7 };
const FIT_MAX = 2.1;

// How often the board checks whether somebody else moved you. The same
// interval CharacterPoller.js uses, for the same reason: a move is rare
// enough that this never competes with anything, and frequent enough that
// being dragged along does not read as the map having lost you.
const POLL_MS = 10_000;

export default function MapBoard({ onClose = null }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [sel, setSel] = useState(null);
  const [labels, setLabels] = useState(true);
  const [layer, setLayer] = useState(null);
  const { run, pending, error } = useActionRunner();
  // useId() returns a string with punctuation React reserves (":r0:"), which
  // is legal in an id but not in a url(#…) reference. Stripped to word
  // characters so the mask resolves.
  const maskId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const svgRef = useRef(null);
  const rootRef = useRef(null);
  // The plate's dimensions, read by applyView's clamp. A ref rather than a
  // dependency so applyView keeps a stable identity — it is in the deps of the
  // window pointer listeners, and re-subscribing those mid-drag drops the pan.
  const plateRef = useRef(null);
  // The pan/zoom transform lives in a ref and is written straight onto the
  // <g>, never through state: a pointermove that re-rendered fifty nodes and
  // eighty lines would drop frames on a phone, and nothing else on the page
  // needs to know where the view is.
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  // Whether the gesture that just ended was a pan. `drag` is cleared on
  // pointerup and `click` fires after it, so a node's handler reading `drag`
  // would always see null and treat the end of a pan as a selection.
  const panned = useRef(false);

  // How much of the plate the board can actually show, in plate pixels. With
  // "slice" the viewBox is scaled to COVER the element, so the visible window
  // is smaller than the plate in one axis and centred — which is what both the
  // pointer maths and the clamp have to agree about.
  const windowOf = useCallback((rect) => {
    const plate = plateRef.current;
    if (!plate?.width || !rect?.width) return null;
    const s = Math.max(rect.width / plate.width, rect.height / plate.height);
    return { s, w: rect.width / s, h: rect.height / s, W: plate.width, H: plate.height };
  }, []);

  // Everything that moves the view goes through here, which is why the clamp
  // lives here and not in the three callers: pan, zoom and fit cannot drift
  // apart about where the edge of the world is.
  //
  // The plate occupies [x, x + W*k] in viewBox units. Zoomed IN it must always
  // cover the box, so x is pinned between W - W*k and 0; zoomed OUT it is
  // smaller than the box and must stay inside it, so the interval is the same
  // two numbers the other way round. Taking the min and the max of the pair
  // handles both without a branch. Without this you could drag the whole map
  // off the edge and be left looking at an empty field with no way back but
  // Reset.
  const applyView = useCallback(() => {
    const win = windowOf(svgRef.current?.getBoundingClientRect());
    if (win) {
      const { k } = view.current;
      // The plate spans [x, x + W*k]; the window spans [(W-w)/2, (W+w)/2].
      // Covering it means x is at most the window's left edge and x + W*k at
      // least its right. At k >= 1 that interval always exists.
      const clamp = (v, seen, whole) => {
        const hi = (whole - seen) / 2;
        const lo = (whole + seen) / 2 - whole * k;
        return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
      };
      view.current.x = clamp(view.current.x, win.w, win.W);
      view.current.y = clamp(view.current.y, win.h, win.H);
    }
    const { x, y, k } = view.current;
    rootRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }, [windowOf]);

  useEffect(() => {
    let cancelled = false;
    loadMap()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the map. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Somebody else's feet can move YOU — a leader dragging a party along a
  // crossing, an escort — and unlike travelTo() below, that write happens on
  // a different browser entirely. This board has no other way to hear about
  // it: it is not fed by page.js (it fetches its own data so the standalone
  // /map route and the /play overlay can share one component), so it is
  // outside the reach of the live feed's SSE "places" push that already
  // fires for every moved character (db/lib/presenceNotify.js) and refreshes
  // everything else on /play. Without this, a passenger's board kept
  // describing the place they left until they closed and reopened it.
  //
  // /api/character-version, the same endpoint CharacterPoller.js polls for
  // the same reason, so this is a second reader rather than a new one.
  // Watches `locationId` alone, not the whole fingerprint: comparing the
  // opaque `fp` would also bump `nonce` — and with it re-frame the board via
  // the effect above — over something the map has nothing to do with, like a
  // resource spent or the turn advancing.
  const locationRef = useRef(undefined);
  useEffect(() => {
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/character-version", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const { locationId } = await res.json();
        if (locationRef.current === undefined) {
          locationRef.current = locationId;
          return;
        }
        if (locationId !== locationRef.current) {
          locationRef.current = locationId;
          setNonce((n) => n + 1);
        }
      } catch {
        // A timeout or a flaky network is a skipped tick, not an error.
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Before the framing effect below, which calls fit() -> applyView() and needs
  // the clamp to already know how big the world is. Effects run in declaration
  // order, so this is load-bearing placement rather than tidiness.
  useEffect(() => {
    plateRef.current = data?.plate ?? null;
  }, [data]);

  // Open on whichever layer the character is standing on — walking into the
  // caves switches you down, which is the only "navigation" this thing has.
  // Set during render rather than in an effect: react-hooks/set-state-in-effect
  // is an error in this repo, and this is the pattern React documents for
  // following a prop (TravelNodes.js does the same with its /travel pick).
  const [tookLayer, setTookLayer] = useState(null);
  if (data?.ok && data.you.layer && tookLayer !== nonce) {
    setTookLayer(nonce);
    setLayer(data.you.layer);
  }

  // ------------------------------------------------------------- pan / zoom

  // Plate pixels under the pointer, accounting for the letterboxing
  // preserveAspectRatio leaves around the viewBox.
  const toWorld = useCallback(
    (ev) => {
      const svg = svgRef.current;
      const plate = data?.plate;
      if (!svg || !plate?.width) return null;
      const b = svg.getBoundingClientRect();
      // max, not min: "slice" covers the box, so the plate overflows it rather
      // than sitting inside it, and the two offsets below go negative.
      const s = Math.max(b.width / plate.width, b.height / plate.height);
      const vx = (ev.clientX - b.left - (b.width - plate.width * s) / 2) / s;
      const vy = (ev.clientY - b.top - (b.height - plate.height * s) / 2) / s;
      const { x, y, k } = view.current;
      return { x: (vx - x) / k, y: (vy - y) / k, vx, vy };
    },
    [data?.plate],
  );

  const zoomBy = useCallback(
    (factor, at = null) => {
      const plate = data?.plate;
      if (!plate?.width) return;
      const anchor = at ?? { vx: plate.width / 2, vy: plate.height / 2 };
      const world = {
        x: (anchor.vx - view.current.x) / view.current.k,
        y: (anchor.vy - view.current.y) / view.current.k,
      };
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.current.k * factor));
      view.current = { k, x: anchor.vx - world.x * k, y: anchor.vy - world.y * k };
      applyView();
    },
    [applyView, data?.plate],
  );

  // Frame whatever is currently drawn, rather than the whole plate. Early on a
  // character knows four Locations in one corner, and fitting the art would
  // leave them squinting at an empty ocean of it.
  const fit = useCallback(() => {
    const plate = data?.plate;
    const shown = (data?.nodes ?? []).filter((n) => onLayer(n, layer));
    if (!plate?.width || shown.length === 0) {
      view.current = { x: 0, y: 0, k: 1 };
      applyView();
      return;
    }
    // Padding in plate pixels around the known nodes. Generous, because the
    // floor is 1:1 now — anything that would have fitted at less than full
    // size is clamped up to it, and the frame just centres instead.
    const pad = 220;
    const xs = shown.map((n) => n.x);
    const ys = shown.map((n) => n.y);
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs)) + pad * 2;
    const h = Math.max(1, Math.max(...ys) - Math.min(...ys)) + pad * 2;
    // Against the WINDOW, not the plate: with "slice" the board shows less of
    // the drawing than the drawing has, and fitting to the full plate would
    // frame a region partly off-screen.
    //
    // FIT_MAX, not ZOOM.max. Early on a character knows two Locations forty
    // pixels apart, and framing those alone would blow the plate up to seven
    // times size and put two enormous rhombi on an empty field. The ceiling
    // keeps the first look at the map looking like a map.
    const win = windowOf(svgRef.current?.getBoundingClientRect());
    const k = Math.min(
      FIT_MAX,
      Math.max(ZOOM.min, Math.min((win?.w ?? plate.width) / w, (win?.h ?? plate.height) / h)),
    );
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.current = { k, x: plate.width / 2 - cx * k, y: plate.height / 2 - cy * k };
    applyView();
  }, [applyView, data, layer, windowOf]);

  // Re-frame when the layer changes or the map first arrives. Depending on
  // `fit` alone would re-run this on every render that changes `data`.
  const framed = useRef(null);
  useEffect(() => {
    const key = `${nonce}:${layer}`;
    if (!data?.ok || framed.current === key) return;
    framed.current = key;
    fit();
  }, [data, layer, nonce, fit]);

  const onPointerDown = (ev) => {
    if (ev.button !== 0) return;
    const p = toWorld(ev);
    if (!p) return;
    panned.current = false;
    drag.current = { vx: p.vx, vy: p.vy, x: view.current.x, y: view.current.y };
  };

  // On the window rather than the SVG, and deliberately NOT via
  // setPointerCapture: capturing retargets the pointerup, and with it the
  // click, onto the <svg> — which would mean no node was ever clickable.
  // Listening on the window instead keeps a drag alive when the pointer
  // leaves the board and lets the click land where it was aimed.
  useEffect(() => {
    const onMove = (ev) => {
      if (!drag.current) return;
      const p = toWorld(ev);
      if (!p) return;
      const dx = p.vx - drag.current.vx;
      const dy = p.vy - drag.current.vy;
      // A few pixels of slop, so a click with a shaky hand still selects a
      // node instead of being swallowed as a pan.
      if (Math.abs(dx) + Math.abs(dy) > 6) panned.current = true;
      view.current = { ...view.current, x: drag.current.x + dx, y: drag.current.y + dy };
      applyView();
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyView, toWorld]);

  // Non-passive, because the page behind must not scroll while the map zooms.
  // React's onWheel is passive by default, so this is attached by hand.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    // Proportional to how far the wheel actually turned, not one fixed step per
    // event: a trackpad fires a stream of small deltas and a notched mouse
    // fires a few large ones, and a flat 1.15 per event made the first shoot
    // across the whole zoom range in a single flick. deltaMode is normalised
    // first (0 = pixels, 1 = lines, 2 = pages) because browsers disagree, and
    // the per-event factor is capped so one violent scroll cannot teleport.
    const onWheel = (ev) => {
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
      const factor = Math.exp(-ev.deltaY * unit * 0.0012);
      zoomBy(Math.min(1.2, Math.max(1 / 1.2, factor)), toWorld(ev));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toWorld, zoomBy]);

  // ---------------------------------------------------------------- render

  if (!data) {
    return <div className="map-board map-board-quiet">Unrolling the map… ‡</div>;
  }
  if (!data.ok) {
    return (
      <div className="map-board map-board-quiet">
        <FormError>{data.error}</FormError>
      </div>
    );
  }

  const { plate, nodes, edges, travel } = data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drawn = nodes.filter((n) => onLayer(n, layer));
  const drawnIds = new Set(drawn.map((n) => n.id));
  const here = data.you.locationId ? byId.get(data.you.locationId) : null;
  const chosen = sel ? byId.get(sel) : null;
  const card = chosen ?? here ?? null;
  const exits = nodes.filter((n) => n.adjacent);

  return (
    <div className="map-board">
      <div className="map-stage" data-layer={layer ?? "surface"}>
        <svg
          ref={svgRef}
          className="map-svg"
          data-layer={layer ?? "surface"}
          viewBox={`0 0 ${plate.width} ${plate.height}`}
          preserveAspectRatio="xMidYMid slice"
          role="presentation"
          onPointerDown={onPointerDown}
        >
          <defs>
            {/* The water, cut out of the plate as an alpha mask so it can be
                painted with a token instead of the blue that was drawn into
                the art. See docs/assets/make-map-river.py. */}
            <mask id={`river-${maskId}`}>
              <image href="/assets/map-river.png" x="0" y="0" width={plate.width} height={plate.height} />
            </mask>
          </defs>

          <g ref={rootRef}>
            <image
              className="map-plate"
              href={plate.src}
              x="0"
              y="0"
              width={plate.width}
              height={plate.height}
            />
            <rect
              className="map-river"
              x="0"
              y="0"
              width={plate.width}
              height={plate.height}
              mask={`url(#river-${maskId})`}
            />

            <g className="map-edges">
              {edges.map((e) => {
                if (!drawnIds.has(e.a) || !drawnIds.has(e.b)) return null;
                const a = byId.get(e.a);
                const b = byId.get(e.b);
                return (
                  <line
                    key={`${e.a}-${e.b}`}
                    className="map-edge"
                    data-gate={e.gate ?? undefined}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                );
              })}
            </g>

            <g className="map-nodes">
              {drawn.map((n) => (
                <g
                  key={n.id}
                  className="map-node"
                  data-zone={n.zoneKey}
                  data-state={n.state}
                  data-reach={n.adjacent && n.passable ? "true" : undefined}
                  data-picked={sel === n.id ? "true" : undefined}
                  transform={`translate(${n.x} ${n.y})`}
                  onClick={() => {
                    if (panned.current) return;
                    setSel(sel === n.id ? null : n.id);
                  }}
                >
                  <rect
                    className="map-node-rim"
                    x={-RIM[n.state]}
                    y={-RIM[n.state]}
                    width={RIM[n.state] * 2}
                    height={RIM[n.state] * 2}
                    transform="rotate(45)"
                  />
                  <rect
                    className="map-node-core"
                    x={-CORE[n.state]}
                    y={-CORE[n.state]}
                    width={CORE[n.state] * 2}
                    height={CORE[n.state] * 2}
                    transform="rotate(45)"
                  />
                  {labels && (
                    <text className="map-node-label" y={RIM[n.state] + 34} textAnchor="middle">
                      {n.name}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </g>
        </svg>

        {/* Only once the character knows somewhere underground. Offering the
            switch before that would tell them a second layer exists, which is
            exactly the kind of thing the fog is for. */}
        {data.layers.length > 1 && (
          <div className="map-layers segmented">
            <button
              type="button"
              aria-pressed={layer === "surface"}
              onClick={() => {
                setLayer("surface");
                setSel(null);
              }}
            >
              Surface
            </button>
            <button
              type="button"
              aria-pressed={layer === "under"}
              onClick={() => {
                setLayer("under");
                setSel(null);
              }}
            >
              Underground
            </button>
          </div>
        )}

        <div className="map-controls">
          <button type="button" className="btn-quiet" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="btn-quiet" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn-quiet" onClick={fit}>
            Reset
          </button>
          <button
            type="button"
            className="chip"
            data-active={labels ? "true" : undefined}
            aria-pressed={labels}
            onClick={() => setLabels((on) => !on)}
          >
            Names
          </button>
          <span className="map-count mono">
            {data.known} of {data.total}
          </span>
        </div>
      </div>

      <aside className="map-card panel">
        {card ? (
          <MapCard
            node={card}
            here={here}
            travel={travel}
            pending={pending}
            error={error}
            onCancel={() => setSel(null)}
            onGo={() =>
              run(travelTo, { locationId: card.id }, {
                onOk: () => {
                  setSel(null);
                  setNonce((n) => n + 1);
                  router.refresh();
                },
              })
            }
          />
        ) : (
          <EmptyState>You are nowhere on this map yet. ‡</EmptyState>
        )}

        {!chosen && exits.length > 0 && (
          <div className="map-exits">
            <p className="chat-section-title">Ways out</p>
            {exits.map((n) => (
              <button key={n.id} type="button" className="map-exit" onClick={() => setSel(n.id)}>
                <span>{n.name}</span>
                <span className="mono">{travelFoot(n, travel?.freeLeft ?? 0, travel?.mounted)}</span>
              </button>
            ))}
          </div>
        )}

        {onClose && (
          <button type="button" className="btn-quiet map-return" onClick={onClose}>
            Return to game
          </button>
        )}
      </aside>
    </div>
  );
}

// Customs is a Caves Location whose building is drawn on the surface plate, so
// it stands on both layers — it is the threshold, and hiding it from the
// surface would make the way underground start nowhere.
function onLayer(node, layer) {
  if (!layer) return node.layer === "surface" || node.both;
  return node.both || node.layer === layer;
}

function Inside({ inside }) {
  const groups = [
    { key: "public", label: "Rooms", items: inside.public },
    { key: "private", label: "Private rooms", items: inside.private },
    { key: "conversations", label: "Conversations", items: inside.conversations },
  ].filter((group) => group.items?.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="map-inside">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="chat-section-title">{group.label}</p>
          <ul className="map-inside-list">
            {group.items.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MapCard({ node, here, travel, pending, error, onCancel, onGo }) {
  const isHere = here && node.id === here.id;
  const reachable = node.adjacent && node.passable;
  const nextTurn = Boolean(node.crossesZone && (travel?.freeLeft ?? 0) <= 0);

  return (
    <div className="map-card-body">
      <p className="map-card-name">{node.name}</p>
      <span className="chip zone-chip" data-zone={node.zoneKey}>
        {node.zoneName}
      </span>

      {node.description && <p className="text-sm">{node.description}</p>}

      {isHere && <p className="chat-quiet-line">You are standing here. ‡</p>}
      {!isHere && node.state === "seen" && (
        <p className="chat-quiet-line">You have not been here. ‡</p>
      )}

      {/* What is inside, for a place they have actually stood in. Three lists
          rather than one: a public room is somewhere anyone may walk, a
          private one is a door they hold the key to, and a conversation is
          people rather than architecture. The server sends only the private
          rooms this character may enter, so there is nothing to filter here —
          and nothing to leak by forgetting to. */}
      {node.inside && <Inside inside={node.inside} />}

      {travel?.heading ? (
        <p className="text-sm">Leaving for {travel.heading} at the turn. ‡</p>
      ) : (
        !isHere &&
        node.adjacent && (
          <div className="map-confirm">
            {reachable ? (
              <>
                <p className="text-sm">{nextTurn ? `To ${node.name}, next turn.` : `To ${node.name}.`}</p>
                {travel?.partySize > 0 && (
                  <p className="chat-quiet-line">
                    {travel.partySize === 1 ? "One person" : `${travel.partySize} people`} with you. ‡
                  </p>
                )}
                <FormError>{error}</FormError>
                <div className="chat-buttons">
                  <button type="button" className="btn" disabled={pending} onClick={onGo}>
                    Go
                  </button>
                  <button type="button" className="btn-quiet" disabled={pending} onClick={onCancel}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              // Straight off crossingCheck, which already carries its own mark.
              <p className="text-sm">{node.reason}</p>
            )}
          </div>
        )
      )}
    </div>
  );
}
