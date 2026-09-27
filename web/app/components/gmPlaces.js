"use client";

import { useEffect, useSyncExternalStore } from "react";

// What a GM hears is the place they are LOOKING at in Chat, not a place they stand in — a GM
// has no character (SOUND.md §4). Chat's place keys are ids (`loc:<id>`, `room:<id>`,
// `zone:<id>`), and placeAmbience.js speaks slugs, so this is the id → slug map for every
// place in the game, fetched once from /api/music-places the first time a GM needs it.
//
// Module scope with useSyncExternalStore, the heardPlace.js shape: one fetch per page load,
// shared by every caller, and no setState in an effect.

let places = null;
let loading = false;
const listeners = new Set();

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => places;
const getServerSnapshot = () => null;

function load() {
  if (places || loading) return;
  loading = true;
  fetch("/api/music-places", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (!json) return;
      places = json;
      for (const cb of listeners) cb();
    })
    .catch(() => {
      // No places, no GM ambience this page load. Nothing else depends on it.
    })
    .finally(() => {
      loading = false;
    });
}

/** The place map, or null until it lands. Fetches only while `enabled`. */
export function useGmPlaces(enabled) {
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * A standing for placeAmbience.js#resolveAmbience, out of a Chat place key: the Location a
 * `loc:` or `room:` key is at, or just the zone for a zone summary. Null for a key that names
 * no place (a DM, a net, Deadchat) — the caller then keeps the last place it had.
 */
export function standingForKey(map, key) {
  if (!map || !key) return null;
  const at = key.indexOf(":");
  if (at === -1) return null;
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (kind === "zone") {
    const zoneSlug = map.zones?.[id];
    return zoneSlug ? { zoneSlug, attributes: [] } : null;
  }
  const locationId = kind === "loc" ? id : kind === "room" ? map.roomLocation?.[id] : null;
  const loc = locationId ? map.locations?.[locationId] : null;
  if (!loc) return null;
  return {
    locationSlug: loc.slug,
    zoneSlug: loc.zoneSlug,
    attributes: loc.attributes ?? [],
    rooms: loc.rooms ?? {},
  };
}
