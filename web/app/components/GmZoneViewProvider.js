"use client";

import { createContext, useContext, useMemo, useState } from "react";

// Which zones the viewing GM has chosen, held in the CLIENT so that toggling
// one re-filters the desk immediately.
//
// The server is still the source of truth: every fresh load seeds this from
// web/lib/gmZoneView.js#getVisibleZones. What the provider buys is the round
// trip. Before it, setVisibleZonesAction ended in revalidatePath(…, "layout")
// on both desks, so a click could not paint until the whole desk payload — the
// loaded 500 moves, the roster, the lot — had been fetched again. The rail
// already knows the answer at the moment of the click; this is what lets it
// say so.
//
// NULL MEANS EVERY ZONE, never an empty list, matching inVisibleZones in
// web/lib/zones.js. Callers branch on null rather than on length, so "chose
// nothing" and "chose everything" cannot drift apart as zones are added.
const GmZoneViewContext = createContext(null);

export function GmZoneViewProvider({ initialZoneNames, children }) {
  const [zoneNames, setZoneNames] = useState(initialZoneNames ?? null);
  const value = useMemo(() => ({ zoneNames, setZoneNames }), [zoneNames]);
  return <GmZoneViewContext.Provider value={value}>{children}</GmZoneViewContext.Provider>;
}

// The names of the zones in view, or null for all of them.
//
// `fallback` is the server prop the caller was already given: a table rendered
// outside a provider keeps working on it rather than throwing, which is what
// keeps these components usable from anywhere.
export function useVisibleZoneNames(fallback = null) {
  const ctx = useContext(GmZoneViewContext);
  return ctx ? ctx.zoneNames : (fallback ?? null);
}

// The rail's half: how the picker publishes a new selection.
export function useSetVisibleZoneNames() {
  const ctx = useContext(GmZoneViewContext);
  return ctx?.setZoneNames ?? null;
}
