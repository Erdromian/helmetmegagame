"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import ChipLabel from "@/app/components/ChipLabel";
import { ChevronDownIcon } from "@/app/components/icons";
import { useTags } from "@/app/components/TagsProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { crossingConfirm, crossingLine, travelFoot, walkFoot, walkLine, openedByLabel, WALK_HINT } from "@/lib/travelCost";
import { loadMap } from "./actions";
import { renderPlate, glyphPath } from "./plateRender";
import useMapNarrow from "./useMapNarrow";
import { travelTo } from "../chat/actions";

// The map. Every Location this character knows, drawn on the plate it was
// measured against, with the ways between them.
//
// One component, two hosts: the /map route and the overlay on /chat. Neither
// passes it anything except an optional onClose, because everything it draws
// comes from loadMap() — which is also where the fog lives. Nothing is hidden
// here that the server sent: an unknown Location never arrives in the first
// place.
//
// Travel is not re-implemented. Picking a reachable node opens the same
// confirm strip the Travel panel uses, reading the same numbers through
// travelFoot(), and Go calls the same travelTo action. There is one mover.

// A place is a CROSSHAIR, not a rhombus, and it is made of the same 1-bit
// pixels as everything under it: the two marks come out of the charset's own
// reticle row, packed into the plate by `npm run map:build` (MAP.md §6g).
// `faint` — four hollow corner ticks — sits on every place you can see;
// `locked` goes only on the one you have picked and the one you stand in.
//
// They are drawn as SVG paths rather than onto the canvas, which is what lets
// data-zone, data-state and data-picked go on colouring them from CSS tokens
// the way everything else on the page is coloured.
//
// ONE SIZE for every mark, which is one CELL — the mark sits exactly on the
// art's own cell, so it can never drift off the sprite it is pointing at. They
// used to grow with what you knew, which made a board of fifty read as though
// the big ones mattered more, when all the size meant was that you had been
// there. State is carried by the fill and the glyph instead.

// The invisible square a finger aims at, half-width in plate pixels. 8, which
// is half a 16px cell: the two closest places on barony2 (the Den and its
// interior) are ONE cell apart, and a hit box wider than half that gap turns a
// tap into a lottery about which of the two you meant.
const HIT = 8;
// What a comfortable target is, in CSS pixels, half-width. 22 -> a 44px box,
// the floor DESIGN-SYSTEM.md §9 sets for everything else you tap.
const HIT_PX = 22;
// The floor is 1, and that is the whole "no blank space" rule: at k=1 the
// plate exactly covers the window, so zooming out past it is zooming out past
// the world. Paired with preserveAspectRatio="slice" below, which CROPS the
// plate to fill the board rather than letterboxing it. The ceiling is high
// because a plate pixel is a real pixel now — the art is 656x384, so reading
// a cell wants magnifying it, not shrinking it.
const ZOOM = { min: 1, max: 16 };
const FIT_MAX = 4;
// Padding in plate pixels around the known places when framing. Four cells.
const FIT_PAD = 64;

const POLL_MS = 10_000;

// Whether Go is on offer for a node. THE one predicate the card's confirm strip
// reads, so a place can never offer Go while its own card is showing a refusal.
// Two ways to qualify now: next door and open, or somewhere farther in your own
// zone you could walk to through places you already know (MAP.md §3c).
function canTravelTo(node, here) {
  if (!node) return false;
  if (here && node.id === here.id) return false;
  if (node.adjacent && node.passable) return true;
  return Boolean(node.walkable);
}

// What a GESTURE may do, and it is deliberately LESS than what Go may do.
//
// Double-click moved somebody across a zone they had not chosen once already,
// and that is why it was taken out (MAP.md §6c). It is back under two limits
// that answer exactly that: never across a zone — so nothing a gesture does
// costs a travel, the Move, or anybody else's afternoon — and never down a road
// that would take your horse off you several hops from here, which is the one
// thing a walk does that cannot be undone for free. Everything else still wants
// the strip, the confirm and a deliberate press.
function canGestureTo(node, here) {
  if (!canTravelTo(node, here)) return false;
  // A tunnel is never taken by a double-click or the Enter shortcut: its confirm is the whole warning.
  return !node.crossesZone && !node.walkDismounts && !node.railroad;
}

// A walk's numbers in the shape travelCost's walk helpers read.
function routeOf(node) {
  return {
    name: node.name,
    hops: node.walkHops ?? 0,
    through: node.walkThrough ?? [],
    dismounts: Boolean(node.walkDismounts),
    indoors: Boolean(node.indoors),
  };
}

// One parse of each plate per page, however many boards mount.
const PLATES = new Map();
function fetchPlate(id, url) {
  const held = PLATES.get(id);
  if (held) return held;
  const job = fetch(url, { cache: "force-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`plate ${id}`);
      return res.json();
    })
    .catch((err) => {
      // Don't cache a failure — a flaky network should not brick the map for
      // the rest of the session.
      PLATES.delete(id);
      throw err;
    });
  PLATES.set(id, job);
  return job;
}

// The plate's colours, off the live theme. The art names a CHANNEL per cell
// and never a colour, so this is where the two meet — and it is the reason a
// canvas does not break "zero hardcoded colours" (DESIGN-SYSTEM.md §2).
const CHANNELS = ["void", "stone", "filler", "lit", "heat"];
function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const out = {};
  for (const channel of CHANNELS) out[channel] = style.getPropertyValue(`--map-${channel}`).trim();
  return out;
}

// Where a mark's cell sits in plate pixels — its centre, since everything
// that frames or hit-tests wants a point rather than a box.
function centreOf(node, cell) {
  return { x: node.x * cell + cell / 2, y: node.y * cell + cell / 2 };
}

// The board for a place no plate draws (docs/systemdocs/CHARON.md). There is
// nothing under you, nothing next to you and nowhere to pan to, so this shows
// exactly that: a dithered grey field, the layer switch visibly turned off, and
// one locked reticle in the middle of it with your own card beside it.
//
// The dither is the same idea plateRender.js uses to thin rock under the
// vignette — an ordered 4x4 pattern rather than noise, so it reads as the map's
// own texture rather than as a broken image. Drawn as an SVG pattern here
// because there is no canvas to draw on when there is no plate to draw.
//
// The reticle is hand-drawn rather than the charset's glyph for the same
// reason: the glyph lives inside a plate's art document, and there isn't one.
// Four corner ticks, which is what that glyph is.
function OffMapBoard({ data }) {
  const node = data.nodes[0] ?? null;
  // A square viewBox: with one thing in the middle and no plate to match, any
  // aspect would do, and a square is the one that centres the same way at every
  // window shape.
  const SIZE = 100;
  const mid = SIZE / 2;
  // The reticle, in viewBox units: a tick this long and this thick, that far
  // out from centre. FILLED rectangles, not strokes — `.map-cross` colours a
  // reticle with `fill`, because on the drawn board it is a bitmap glyph, and a
  // stroked path there would come out invisible.
  const arm = 3;
  const off = 6;
  const thick = 0.7;
  const rect = (x0, y0, x1, y1) =>
    `M ${Math.min(x0, x1)} ${Math.min(y0, y1)} H ${Math.max(x0, x1)} V ${Math.max(y0, y1)} H ${Math.min(x0, x1)} Z`;
  const ticks = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
    .map(([sx, sy]) => {
      const x = mid + sx * off;
      const y = mid + sy * off;
      // The two arms of one corner, meeting at (x, y) and running inward.
      return [rect(x, y, x - sx * arm, y - sy * thick), rect(x, y, x - sx * thick, y - sy * arm)].join(" ");
    })
    .join(" ");

  return (
    <div className="map-board" data-offmap="true">
      <div className="map-stage">
        <svg
          className="map-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label={node ? `${node.name}. Nowhere the map reaches.` : "Nowhere the map reaches."}
        >
          <defs>
            {/* Ordered dither, 4 units to a tile. The four dots are the light
                half of a 4x4 Bayer matrix; at this density it greys the field
                without ever resolving into a grid. */}
            <pattern id="map-offmap-dither" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect className="map-offmap-dot" x="0" y="0" width="1" height="1" />
              <rect className="map-offmap-dot" x="2" y="2" width="1" height="1" />
              <rect className="map-offmap-dot" x="3" y="0" width="1" height="1" />
              <rect className="map-offmap-dot" x="1" y="3" width="1" height="1" />
            </pattern>
          </defs>
          <rect className="map-offmap-void" x="0" y="0" width={SIZE} height={SIZE} />
          <rect x="0" y="0" width={SIZE} height={SIZE} fill="url(#map-offmap-dither)" />
          {node && (
            <g className="map-node" data-zone={node.zoneKey} data-state="here" data-picked="true">
              {/* The same halo the drawn board gives a reticle, for the same
                  reason: a quiet mark on a busy field reads as nothing. */}
              <path className="map-cross-halo" transform="translate(0.6 0.6)" d={ticks} />
              <path className="map-cross" d={ticks} />
              <text className="map-node-label" x={mid} y={mid + off + 6} textAnchor="middle">
                {node.name}
              </text>
            </g>
          )}
        </svg>

        <div className="map-hud">
          {data.plates.length > 1 && (
            <div className="map-layers segmented">
              {data.plates.map((p) => (
                <button key={p.id} type="button" disabled aria-disabled="true" aria-pressed={false}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside className="map-card panel">
        {node ? (
          <MapCard node={node} here={node} travel={null} pending={false} error={null} note={null} />
        ) : (
          <EmptyState>You aren&apos;t on the map yet.</EmptyState>
        )}
      </aside>
    </div>
  );
}

export default function MapBoard({ onClose = null }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [sel, setSel] = useState(null);
  // The phone's sheet, and only the phone's — see the card block below. Closed
  // is the resting state, so the plate gets the screen it is the point of.
  const narrow = useMapNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Names OFF by default, which is the one thing the drawn plate changed about
  // the chrome. Fifty names over a 1-bit drawing is fifty captions competing
  // with the art they are captioning — and the art is the map now, so a place
  // is found by its crosshair. The one you pick and the one you stand in are
  // always named whatever this says.
  const [labels, setLabels] = useState(false);
  const [plateId, setPlateId] = useState(null);
  // The drawn plate: the fetched art document, and the picture made from it.
  // Both change twice in a session at most — a plate switch and nothing else —
  // so state is right here. Nothing about the PICTURE depends on fog, on what
  // is picked or on where the view is, which is exactly why it can be made
  // once and then panned over for free.
  const [art, setArt] = useState(null);
  const [picture, setPicture] = useState(null);
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();
  // What the last move said — "that spent your Move", the Push on die. The
  // Travel panel hands its line to the chat; the board has nowhere else to
  // put it, so it goes on the card of the place you now stand.
  const [note, setNote] = useState(null);

  // The plate the board is drawing, and the world it spans in plate pixels —
  // w*cell by h*cell. Every piece of pan/zoom maths below is written against
  // this and nothing else, which is why swapping a raster for a drawn plate
  // left the clamp, the pinch and the fit alone.
  const plateBox = useMemo(() => {
    const list = data?.ok ? (data.plates ?? []) : [];
    const found = list.find((p) => p.id === plateId) ?? list[0] ?? null;
    if (!found) return null;
    return { ...found, width: found.w * found.cell, height: found.h * found.cell };
  }, [data, plateId]);

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
  // Every pointer currently down on the board, by id, in client pixels. A Map
  // rather than two slots because a third finger landing mid-pinch must not
  // corrupt the two that started it.
  const pointers = useRef(new Map());
  // The live pinch: how far apart the two fingers were and where their midpoint
  // sat, in plate pixels. Null whenever fewer than two are down.
  const pinch = useRef(null);
  // What kind of pointer last touched the board — "mouse", "touch" or "pen".
  //
  // This, and NOT a media query, is what makes the double-click a desktop
  // affordance. `(pointer: fine)` is true on a tablet with a mouse paired to it
  // while a FINGER is on the glass, which is precisely the case that got the
  // gesture removed the first time (MAP.md §6c): a tap landing on a node moved
  // somebody with no sentence in front of it. Asking the pointer that produced
  // the event cannot get that wrong. Same idiom as LedgerBand.js.
  const pointerKind = useRef(null);

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
    // How big the touch target has to be drawn to come out 44px on the glass.
    // Written here rather than through state for the same reason the transform
    // is: it changes on every frame of a pan, and fifty nodes must not
    // re-render for it. HIT is already the widest a node may be without
    // reaching its neighbour, so this only ever shrinks it — which it does
    // once you are zoomed in far enough that a plate pixel is worth having.
    if (win) {
      const want = HIT_PX / (win.s * k * HIT);
      rootRef.current?.style.setProperty("--map-hit", String(Math.min(1, Math.max(0.5, want))));
    }
  }, [windowOf]);

  useEffect(() => {
    let cancelled = false;
    loadMap()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the map." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Somebody else's feet can move YOU — a leader dragging a party along a
  // crossing, an escort — and unlike travelTo() below, that write happens on
  // a different browser entirely. This board has no other way to hear about
  // it: it is not fed by page.js (it fetches its own data so the standalone
  // /map route and the /chat overlay can share one component), so it is
  // outside the reach of the live feed's SSE "places" push that already
  // fires for every moved character (db/lib/presenceNotify.js) and refreshes
  // everything else on /chat. Without this, a passenger's board kept
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

  // The art, fetched once per plate and drawn once per plate.
  //
  // A module-level cache outside the component, because /map and the /chat
  // overlay are two mounts of this file in one session and neither should
  // parse the same 20KB twice. It is a plain static file with an ordinary HTTP
  // cache behind it, which is exactly why it is NOT part of loadMap's payload:
  // that is a server action, per-character and no-store by nature.
  useEffect(() => {
    const id = plateBox?.id;
    const url = plateBox?.url;
    if (!id || !url) return undefined;
    let cancelled = false;
    fetchPlate(id, url)
      .then((doc) => {
        if (cancelled) return;
        setArt(doc);
        setPicture(renderPlate(doc, readPalette()));
      })
      .catch(() => {
        if (!cancelled) setArt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [plateBox?.id, plateBox?.url]);

  // Before the framing effect below, which calls fit() -> applyView() and needs
  // the clamp to already know how big the world is. Effects run in declaration
  // order, so this is load-bearing placement rather than tidiness.
  useEffect(() => {
    plateRef.current = plateBox;
  }, [plateBox]);

  // Open on whichever plate the character is standing on — walking down into
  // Undertown turns the page, which is the only "navigation" this thing has.
  // Set during render rather than in an effect: react-hooks/set-state-in-effect
  // is an error in this repo, and this is the pattern React documents for
  // following a prop (TravelNodes.js does the same with its /travel pick).
  const [tookPlate, setTookPlate] = useState(null);
  if (data?.ok && data.you.plate && tookPlate !== nonce) {
    setTookPlate(nonce);
    setPlateId(data.you.plate);
  }

  // ------------------------------------------------------------- pan / zoom

  // Plate pixels under the pointer, accounting for the letterboxing
  // preserveAspectRatio leaves around the viewBox.
  const toWorld = useCallback(
    (ev) => {
      const svg = svgRef.current;
      const plate = plateBox;
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
    [plateBox],
  );

  // `to` defaults to `at`, so the wheel and the +/- buttons behave exactly as
  // they did: the plate point under the anchor stays under the anchor. A pinch
  // passes the OLD midpoint as `at` and the NEW one as `to`, and that one
  // difference is what makes two fingers pan and zoom in a single write — the
  // spot they grabbed stays between them. Panning survives the clamp on `k`,
  // too: at the floor of 1 the factor is swallowed and the translation is not.
  const zoomBy = useCallback(
    (factor, at = null, to = null) => {
      const plate = plateBox;
      if (!plate?.width) return;
      const anchor = at ?? { vx: plate.width / 2, vy: plate.height / 2 };
      const land = to ?? anchor;
      const world = {
        x: (anchor.vx - view.current.x) / view.current.k,
        y: (anchor.vy - view.current.y) / view.current.k,
      };
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.current.k * factor));
      view.current = { k, x: land.vx - world.x * k, y: land.vy - world.y * k };
      applyView();
    },
    [applyView, plateBox],
  );

  // The two fingers, measured: how far apart, and the plate pixel between them.
  // toWorld reads nothing off an event but clientX/clientY, so a bare pair of
  // numbers is a legal argument and there is no second conversion to keep in
  // step with the first.
  const gauge = useCallback(() => {
    if (pointers.current.size < 2) return null;
    const [a, b] = [...pointers.current.values()];
    const mid = toWorld({ clientX: (a.cx + b.cx) / 2, clientY: (a.cy + b.cy) / 2 });
    if (!mid) return null;
    // Never zero: two contacts reported on the same pixel would make the ratio
    // in onMove infinite and throw the view to ZOOM.max in one frame.
    return { d: Math.max(1, Math.hypot(a.cx - b.cx, a.cy - b.cy)), vx: mid.vx, vy: mid.vy };
  }, [toWorld]);

  // Frame whatever is currently drawn, rather than the whole plate. Early on a
  // character knows four Locations in one corner, and fitting the art would
  // leave them squinting at an empty ocean of it.
  const fit = useCallback(() => {
    const plate = plateBox;
    const shown = (data?.nodes ?? []).filter((n) => onPlate(n, plateBox?.id));
    if (!plate?.width || shown.length === 0) {
      view.current = { x: 0, y: 0, k: 1 };
      applyView();
      return;
    }
    // Padding in plate pixels around the known nodes. Generous, because the
    // floor is 1:1 now — anything that would have fitted at less than full
    // size is clamped up to it, and the frame just centres instead.
    const pts = shown.map((n) => centreOf(n, plate.cell));
    const xs = pts.map((c) => c.x);
    const ys = pts.map((c) => c.y);
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs)) + FIT_PAD * 2;
    const h = Math.max(1, Math.max(...ys) - Math.min(...ys)) + FIT_PAD * 2;
    // Against the WINDOW, not the plate: with "slice" the board shows less of
    // the drawing than the drawing has, and fitting to the full plate would
    // frame a region partly off-screen.
    //
    // FIT_MAX, not ZOOM.max. Early on a character knows two Locations a couple
    // of cells apart, and framing those alone would blow the plate up to
    // sixteen times size and put two enormous crosshairs on an empty field.
    // The ceiling keeps the first look at the map looking like a map.
    const win = windowOf(svgRef.current?.getBoundingClientRect());
    const k = Math.min(
      FIT_MAX,
      Math.max(ZOOM.min, Math.min((win?.w ?? plate.width) / w, (win?.h ?? plate.height) / h)),
    );
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.current = { k, x: plate.width / 2 - cx * k, y: plate.height / 2 - cy * k };
    applyView();
  }, [applyView, data, plateBox, windowOf]);

  // Frame on arrival, and whenever the character's Location moves — the nonce
  // is that, and it is the only real navigation the board has.
  //
  // A PLATE press is that too, and this is the one thing the drawn plates
  // changed about framing. Surface and Underground used to be one drawing
  // shown twice, so { x, y, k } meant the same thing on both and keeping it
  // read as two faces of one place. The Barony and Undertown are two separate
  // 41x24 worlds that share no coordinate, so carrying the view across would
  // land you at the same numbers in a different country. A switch re-frames.
  const framed = useRef(null);
  const flipped = useRef(null);
  useEffect(() => {
    if (!data?.ok) return;
    const key = `${nonce}:${plateBox?.id ?? ""}`;
    if (framed.current !== nonce) {
      framed.current = nonce;
      flipped.current = key;
      fit();
      return;
    }
    if (flipped.current === key) return;
    flipped.current = key;
    fit();
  }, [data, plateBox, nonce, fit]);

  // The guard stays: a touch contact reports button 0, the second finger
  // included, so nothing here shuts pinch out — but a right-click must still
  // not start a pan.
  const onPointerDown = (ev) => {
    if (ev.button !== 0) return;
    const p = toWorld(ev);
    if (!p) return;
    pointers.current.set(ev.pointerId, { cx: ev.clientX, cy: ev.clientY });
    pointerKind.current = ev.pointerType;
    if (pointers.current.size === 1) {
      panned.current = false;
      drag.current = { vx: p.vx, vy: p.vy, x: view.current.x, y: view.current.y };
      return;
    }
    // A second finger ends the pan and starts a pinch. `panned` goes true and
    // stays true for the rest of the gesture: the click that fires when the
    // last finger lifts must never be read as picking a place.
    drag.current = null;
    panned.current = true;
    pinch.current = gauge();
  };

  // Tapping the plate itself puts the card away. Without this the only way to
  // unpick was a second tap on the very node you picked, which on a phone —
  // where the card is a sheet over the board — left the description sitting
  // over half the map with no obvious way to be rid of it.
  //
  // A node's own handler owns its clicks, so this stands aside for anything
  // inside one rather than racing it; the click bubbles up here afterwards and
  // would otherwise unpick whatever had just been picked. `panned` is the same
  // guard the nodes use: the end of a drag is not a tap.
  const onBoardClick = (ev) => {
    if (panned.current) return;
    if (ev.target?.closest?.(".map-node")) return;
    setSel(null);
    // And on a phone it puts the sheet back down to its one-line bar, since
    // the open lists cover the plate just as much as a card does.
    setSheetOpen(false);
  };

  // On the window rather than the SVG, and deliberately NOT via
  // setPointerCapture: capturing retargets the pointerup, and with it the
  // click, onto the <svg> — which would mean no node was ever clickable.
  // Listening on the window instead keeps a drag alive when the pointer
  // leaves the board and lets the click land where it was aimed.
  useEffect(() => {
    const onMove = (ev) => {
      // A fresh object rather than a mutated one: react-hooks/immutability is
      // an error in this repo, and one small allocation per move is nothing.
      if (pointers.current.has(ev.pointerId)) {
        pointers.current.set(ev.pointerId, { cx: ev.clientX, cy: ev.clientY });
      }
      if (pinch.current) {
        const g = gauge();
        if (!g) return;
        zoomBy(g.d / pinch.current.d, pinch.current, g);
        pinch.current = g;
        // Two fingers never fall through to the pan below, or the board would
        // be moved twice in one frame.
        return;
      }
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
    const onUp = (ev) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size >= 2) {
        // Three fingers down to two. Re-measure rather than keep the old
        // distance, which belonged to a different pair and would jump the view
        // by the ratio between them.
        pinch.current = gauge();
        return;
      }
      pinch.current = null;
      if (pointers.current.size === 1) {
        // One finger left of two. The pan has to be re-seated on where THAT
        // finger actually is; leaving it on the midpoint would leap the map by
        // half the gap between the fingers the moment one lifted. `panned`
        // stays true, because this is still one gesture.
        const [only] = [...pointers.current.values()];
        const p = toWorld({ clientX: only.cx, clientY: only.cy });
        drag.current = p ? { vx: p.vx, vy: p.vy, x: view.current.x, y: view.current.y } : null;
        return;
      }
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
  }, [applyView, gauge, toWorld, zoomBy]);

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

  // Travel, in one place. The card's Go is the only door onto it — travelTo,
  // which re-derives every gate server-side whatever the board thought
  // (MAP.md §6c). A zone crossing asks again on top of that, in the shared
  // confirm: it spends something, it carries whoever is with you, and it
  // cannot be walked back for free.
  //
  // Push on is the same door with a die in it (MAP.md §3): its own confirm,
  // then the same action with `exert` set.
  const go = async (node, { exert = false } = {}) => {
    if (node.crossesZone || node.railroad) {
      const asked = crossingConfirm(node, node.freeLeft ?? 0, data?.travel?.partySize ?? 0, { exert });
      if (!(await confirm(asked))) return;
    }
    setNote(null);
    run(travelTo, { locationId: node.id, exert }, {
      onOk: (res) => {
        setNote(res?.line ?? null);
        setSel(null);
        setNonce((n) => n + 1);
        router.refresh();
      },
    });
  };

  // Enter travels, once a place is picked — and only what a gesture may take
  // (canGestureTo), which is the same short list the double-click gets.
  //
  // A DOCUMENT listener rather than focusable rhombi, deliberately. Making
  // fifty SVG <g>s focusable would put fifty stops in the tab order in front of
  // Go, and role="button" on each would have a screen reader read the whole
  // plate as a toolbar — Tab-to-Go is better than both (MAP.md §6c). So the
  // shortcut only exists while something is picked, and it gets out of the way
  // of anything that legitimately wants the key: Go and Cancel, the plate
  // switch, and the confirm dialog this very handler can open.
  useEffect(() => {
    if (!sel || !data?.ok) return undefined;
    const onKey = (ev) => {
      if (ev.key !== "Enter" || ev.repeat) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      const el = document.activeElement;
      if (el && el !== document.body && el.closest("button, a, input, textarea, select, [role=dialog]")) return;
      // Same test the double-click makes: a board last touched by a finger has
      // no keyboard to press this with anyway, and asking keeps the two paths
      // honest about being one affordance.
      if (pointerKind.current !== "mouse") return;
      const nodes = data.nodes ?? [];
      const node = nodes.find((n) => n.id === sel);
      const standing = data.you?.locationId ? nodes.find((n) => n.id === data.you.locationId) : null;
      if (!canGestureTo(node, standing)) return;
      ev.preventDefault();
      go(node);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- render

  // `!picture` does not apply off the map: there is no plate to make one from,
  // so waiting for one would sit on "Unrolling the map…" for ever.
  if (!data || (data.ok && !data.offMap && !picture)) {
    return <div className="map-board map-board-quiet">Unrolling the map…</div>;
  }
  if (!data.ok) {
    return (
      <div className="map-board map-board-quiet">
        <FormError>{data.error}</FormError>
      </div>
    );
  }
  // Off the map (docs/systemdocs/CHARON.md): no plate, no edges, nowhere to
  // pan to. Its own board rather than the one below with everything switched
  // off — every line of the one below is about a plate, and threading a null
  // through all of it would make the ordinary map harder to read for the sake
  // of a place that has none.
  if (data.offMap) {
    return <OffMapBoard data={data} />;
  }

  const { nodes, edges, travel } = data;
  const plate = plateBox;
  const cell = plate.cell;
  // The two marks, as paths in cell units. Made once per plate and cached on
  // the art document.
  const marks = { faint: glyphPath(art, art.ui.faint), locked: glyphPath(art, art.ui.locked) };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drawn = nodes.filter((n) => onPlate(n, plate.id));
  const drawnIds = new Set(drawn.map((n) => n.id));
  const here = data.you.locationId ? byId.get(data.you.locationId) : null;
  const chosen = sel ? byId.get(sel) : null;
  // On a WIDE screen the card is a column beside the board, covering nothing,
  // so with nothing picked it shows where you stand rather than sitting empty.
  //
  // On a phone that fallback was the whole bug: the card is a sheet OVER the
  // plate there, and falling back to `here` meant it was never empty — so
  // tapping open ground (which only clears `sel`) changed nothing, and Cancel
  // is gated behind !isHere so it never drew either. A description over half
  // the board with no way out of it, which MAP.md §6c already calls a trap.
  // Narrow shows the card ONLY for a place actually picked.
  const card = chosen ?? (narrow ? null : here) ?? null;
  const exits = nodes.filter((n) => n.adjacent);
  // Farther in this zone, nearest first. Its own list under its own heading: a
  // three-hop walk is not a way OUT of this room, and folding it into the grid
  // above would make the card lie about what is next door. On a phone, where
  // the card is a sheet over the board, this is the comfortable way to reach
  // one without hunting for a rhombus.
  const walks = nodes
    .filter((n) => n.walkable && !n.adjacent)
    .sort((x, y) => (x.walkHops ?? 0) - (y.walkHops ?? 0) || x.name.localeCompare(y.name));

  return (
    <div className="map-board">
      <div className="map-stage">
        <svg
          ref={svgRef}
          className="map-svg"
          viewBox={`0 0 ${plate.width} ${plate.height}`}
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label={`${plate.name}. ${here ? `You are at ${here.name}.` : "You aren't on the map yet."} ${data.known} of ${data.total} places known.`}
          onPointerDown={onPointerDown}
          onClick={onBoardClick}
        >
          <g ref={rootRef}>
            {/* The plate, drawn from its channels by plateRender and handed
                over as one picture. It changes when the plate or the theme
                does, and never otherwise — so panning it costs a transform
                and nothing else. */}
            <image
              className="map-plate"
              href={picture}
              x="0"
              y="0"
              width={plate.width}
              height={plate.height}
            />

            <g className="map-edges">
              {edges.map((e) => {
                if (!drawnIds.has(e.a) || !drawnIds.has(e.b)) return null;
                const a = centreOf(byId.get(e.a), cell);
                const b = centreOf(byId.get(e.b), cell);
                return (
                  <line
                    key={`${e.a}-${e.b}`}
                    className="map-edge"
                    data-gate={e.gate ?? undefined}
                    data-opened={e.openedBy ? "true" : undefined}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                );
              })}
            </g>

            <g className="map-nodes">
              {drawn.map((n) => {
                // The loud mark goes on the place you have picked and the
                // place you stand, and on nothing else. Fifty locked reticles
                // would be fifty things shouting at once, which is the whole
                // reason the charset carries two.
                const strong = sel === n.id || n.state === "here";
                return (
                <g
                  key={n.id}
                  className="map-node"
                  data-zone={n.zoneKey}
                  data-state={n.state}
                  data-reach={n.adjacent && n.passable ? "true" : undefined}
                  data-picked={sel === n.id ? "true" : undefined}
                  transform={`translate(${n.x * cell} ${n.y * cell})`}
                  onClick={() => {
                    if (panned.current) return;
                    if (sel !== n.id) {
                      setSel(n.id);
                      return;
                    }
                    // The second click unpicks, whatever the pointer and
                    // whatever the node. It used to be the Go button on a
                    // mouse, which meant a double-click — or, on the Travel
                    // panel, a tap that landed on the place already chosen —
                    // moved somebody with nothing in front of it. Go on the
                    // card is the only door now, and it is on screen the moment
                    // you pick, since the sheet opens. So this is just the way
                    // back out of a card sitting over the board, and there is
                    // The gesture below is a separate onDoubleClick and does
                    // not read `sel`, so this unpick cannot eat it.
                    setSel(null);
                  }}
                  onDoubleClick={() => {
                    // The gesture is back, and narrower than Go — see
                    // canGestureTo for the two limits and why they are the ones
                    // (MAP.md §6c).
                    //
                    // ORDER MATTERS HERE and is easy to get wrong: a browser
                    // fires click, click, dblclick — so the second click above
                    // has ALREADY set `sel` to null by the time this runs. A
                    // handler written as `if (sel === n.id)` would never once
                    // fire and would read as the feature simply not working.
                    // This acts on its own node and asks `sel` nothing.
                    if (panned.current) return;
                    if (pointerKind.current !== "mouse") return;
                    if (!canGestureTo(n, here)) return;
                    // Put the card back the second click took away, so they can
                    // see where they went.
                    setSel(n.id);
                    go(n);
                  }}
                >
                  {/* The thing a finger aims at. First, so it paints under the
                      marker; invisible, so the board is unchanged; inert on a
                      mouse, which does not need it (.map-node-hit). */}
                  <rect
                    className="map-node-hit"
                    x={cell / 2 - HIT}
                    y={cell / 2 - HIT}
                    width={HIT * 2}
                    height={HIT * 2}
                  />
                  {/* The dark drop, a pixel down and right. Without it a faint
                      reticle vanishes: its corner ticks land exactly where a
                      building's own white outline already is, so quiet colour
                      over busy art reads as nothing at all (MAP.md §6g). */}
                  <path className="map-cross-halo" transform="translate(1 1)" d={strong ? marks.locked : marks.faint} />
                  <path className="map-cross" d={strong ? marks.locked : marks.faint} />
                  {(labels || strong) && (
                    <text className="map-node-label" x={cell / 2} y={cell + 7} textAnchor="middle">
                      {n.name}
                    </text>
                  )}
                </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* The two HUD blocks in one wrapper. It is display: contents on a
            desktop, so each keeps the corner it has always had; on a phone it
            becomes a column, which is the only way neither has to know how
            wide the other is — side by side they need 486px of a 390px
            screen and the plate switch ended up behind the zoom buttons. */}
        <div className="map-hud">
          {/* Only the plates holding somewhere the character knows — the
              server already dropped the rest. Offering Undertown before that
              would tell them it exists, which is the kind of thing the fog is
              for. */}
          {data.plates.length > 1 && (
            <div className="map-layers segmented">
              {data.plates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={plate.id === p.id}
                  onClick={() => {
                    setPlateId(p.id);
                    setSel(null);
                  }}
                >
                  {p.name}
                </button>
              ))}
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
      </div>

      {/* data-picked and data-open are the whole phone layout: under 640px the
          card is a sheet over the board, and these decide how far it is up.
          Three states, and the resting one is closed —

            nothing picked, shut   a one-line bar saying where you stand;
            nothing picked, open   that bar plus Ways out and Further in;
            something picked       that place's card, far enough for Go.

          It used to have two, and the resting one was a full location card
          plus both lists under a 32dvh cap — over the plate, on a screen with
          no room to spare, and with neither of its two documented ways out
          working (see `card` above). The bar is what keeps MAP.md §6e's "a
          caption and its Ways out list" true: the caption is always there and
          the list is one tap into it. */}
      <aside
        className="map-card panel"
        data-picked={chosen ? "true" : undefined}
        data-open={narrow && !chosen && sheetOpen ? "true" : undefined}
      >
        {/* Cancel lives inside the card and is gated behind !isHere, so a
            picked place you are ALREADY STANDING IN has no button to shut it
            with. On a phone that is the sheet covering the board again. */}
        {narrow && chosen && (
          <button
            type="button"
            className="map-card-close"
            aria-label="Close"
            onClick={() => setSel(null)}
          >
            ✕
          </button>
        )}

        {narrow && !chosen && (
          <button
            type="button"
            className="map-peek"
            aria-expanded={sheetOpen}
            disabled={!here}
            onClick={() => setSheetOpen((wasOpen) => !wasOpen)}
          >
            <span className="map-peek-name">
              {here ? here.name : "You aren't on the map yet."}
            </span>
            {here && <ChevronDownIcon width="14" height="14" />}
          </button>
        )}

        {card ? (
          <MapCard
            node={card}
            here={here}
            travel={travel}
            pending={pending}
            error={error}
            note={note}
            onCancel={() => setSel(null)}
            onGo={() => go(card)}
            onExert={() => go(card, { exert: true })}
          />
        ) : narrow ? null : (
          <EmptyState>You aren&apos;t on the map yet.</EmptyState>
        )}

        {!chosen && (!narrow || sheetOpen) && exits.length > 0 && (
          <div className="map-exits">
            <p className="group-label chat-section-title">Ways out</p>
            {exits.map((n) => (
              <button key={n.id} type="button" className="map-exit" onClick={() => setSel(n.id)}>
                <span>{n.name}</span>
                {/* The tag of theirs that opens it, where one does — the same
                    chip the Travel panel and the card below draw. */}
                <ViaChip slug={n.openedBy} />
                <span className="mono">{travelFoot(n, n.freeLeft ?? 0, travel?.mounted, travel?.moved)}</span>
              </button>
            ))}
          </div>
        )}

        {!chosen && (!narrow || sheetOpen) && walks.length > 0 && (
          <div className="map-exits">
            <p className="group-label chat-section-title">Further in {here?.zoneName ?? "this zone"}</p>
            {walks.map((n) => (
              <button key={n.id} type="button" className="map-exit" onClick={() => setSel(n.id)}>
                <span>{n.name}</span>
                <span className="mono">{walkFoot(routeOf(n), travel?.mounted)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Not on a shut phone sheet: the bar is one line, and a second row
            under it is the sheet growing back. */}
        {onClose && (!narrow || sheetOpen || chosen) && (
          <button type="button" className="btn-quiet map-return" onClick={onClose}>
            Return to game
          </button>
        )}
      </aside>
    </div>
  );
}

// A place is drawn on the one plate that has a cell for it, and a place no
// plate has a cell for is drawn nowhere at all. The Caves and the Depths are
// in that state today: they are real, walkable Locations that simply have no
// art yet, so they arrive in the payload, appear in Ways out and get a card —
// they just have no crosshair to click (MAP.md §6h).
function onPlate(node, plateId) {
  return Boolean(node.plate) && node.plate === plateId;
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
          <p className="group-label chat-section-title">{group.label}</p>
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

// The trait chip, resolved from a slug. Both places on this page that draw one
// want the identical thing, and neither has anywhere to put the sentence, so
// the name is on the chip and the sentence is on its title. `tagsBySlug` is the
// root layout's streamed catalog plus everything this character holds — and
// openedBy is only ever a tag they hold, so the lookup cannot come up empty.
// ChipLabel, not TagChip: both call sites are inside a <button>.
function ViaChip({ slug }) {
  const { tagsBySlug } = useTags();
  const tag = slug ? (tagsBySlug.get(slug) ?? null) : null;
  if (!tag) return null;
  return (
    <span className="map-via" title={openedByLabel(tag.name)}>
      <ChipLabel tag={tag} />
    </span>
  );
}

function MapCard({ node, here, travel, pending, error, note, onCancel, onGo, onExert }) {
  const isHere = here && node.id === here.id;
  const reachable = canTravelTo(node, here);
  // Farther in this zone rather than next door — a walk of several hops. Note
  // this is on the CARD, so it reaches every device: clicking a place you are
  // not beside and pressing Go is the ordinary way to do this on a phone. The
  // double-click is only a shortcut for a mouse on top of it.
  const walking = !isHere && Boolean(node.walkable) && !node.adjacent;
  // Whether the double-click / Enter shortcut applies to this node at all.
  const gestural = canGestureTo(node, here);
  // node's OWN count, not the header's ambient one — a boat's bonus is
  // earned per crossing, so a water-eligible destination can still be free
  // even when the header's pre-selection number already reads 0.
  const nextTurn = Boolean(node.crossesZone && (node.freeLeft ?? 0) <= 0);

  return (
    <div className="map-card-body">
      <p className="map-card-name">{node.name}</p>
      <div className="chip-row">
        <span className="chip zone-chip" data-zone={node.zoneKey}>
          {node.zoneName}
        </span>
        {/* Beside the zone rather than under it: both answer "what is this
            place to me", and the shared .chip-row is what a line of chips is
            already spelled as everywhere else. */}
        <ViaChip slug={node.openedBy} />
      </div>

      {node.description && <p className="text-sm">{node.description}</p>}

      {isHere && <p className="chat-quiet-line">You are standing here.</p>}
      {isHere && note && <p className="text-sm">{note}</p>}
      {!isHere && node.state === "seen" && (
        <p className="chat-quiet-line">You have not been here.</p>
      )}

      {/* What is inside, for a place they have actually stood in. Three lists
          rather than one: a public room is somewhere anyone may walk, a
          private one is a door they hold the key to, and a conversation is
          people rather than architecture. The server sends only the private
          rooms this character may enter, so there is nothing to filter here —
          and nothing to leak by forgetting to. */}
      {node.inside && <Inside inside={node.inside} />}

      {/* Held where they stand (INTERCEPT.md). It deliberately does not swallow
          the block below: the server shuts every way and writes the reason
          onto each row, so a node falls into the refusal branch on its own and
          the board stays readable while somebody has hold of you. */}
      {travel?.held ? <p className="text-sm">{travel.held}</p> : null}

      {!isHere && (node.adjacent || node.walkable) && (
        <div className="map-confirm">
          {reachable ? (
            <>
              {/* A walk says how far and names the stops; a single hop says what
                  the crossing costs. Both sentences come from travelCost.js, so
                  this card and the Travel panel cannot word them differently. */}
              <p className="text-sm">
                {walking ? walkLine(routeOf(node)) : crossingLine(node, nextTurn, travel?.moved)}
              </p>
              {travel?.partySize > 0 && (
                <p className="chat-quiet-line">
                  {travel.partySize === 1 ? "One person" : `${travel.partySize} people`} with you.
                </p>
              )}
              <FormError>{error}</FormError>
              <div className="chat-buttons">
                {/* Same rule as the Travel panel: Go is the Move, and once
                    that is spent a crossing with no travel left has none to
                    offer, so the button leaves (MAP.md §3). */}
                {!(nextTurn && travel?.moved) && (
                  <button type="button" className="btn" disabled={pending} onClick={onGo}>
                    Go
                  </button>
                )}
                {/* Same button the Travel panel draws, for the same reason. */}
                {nextTurn && node.canExert && (
                  <button
                    type="button"
                    className="btn"
                    disabled={pending}
                    title="Exert yourself for another free travel."
                    onClick={onExert}
                  >
                    Push on
                  </button>
                )}
                <button type="button" className="btn-quiet" disabled={pending} onClick={onCancel}>
                  Cancel
                </button>
              </div>
              {/* Only where a gesture would actually be taken, and only for a
                  mouse — .map-hint is hidden outright on a coarse pointer, so a
                  phone is never told about a shortcut it does not have. */}
              {gestural && <p className="chat-quiet-line map-hint">{WALK_HINT}</p>}
            </>
          ) : (
            // Straight off crossingCheck, which already carries its own mark.
            <p className="text-sm">{node.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
