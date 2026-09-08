import AppHeader from "@/app/components/AppHeader";
import MapBoard from "./MapBoard";

// The map as its own page. The overlay on /play mounts the identical board —
// this route exists so the map has a link of its own, and because a phone
// should not be opening a full-bleed board inside the "Here" sheet.
//
// It owns its whole screen the way Chat and the (desk) workspaces do: no
// PageShell, no centred max-width, a 100dvh column that does not scroll. A map
// in a card was a picture OF a map; the point of this one is that it is the
// window you look through, and a plate 2144px wide has no business being
// letterboxed into 46rem.
//
// The sign-in gate is the (app) layout's, which redirects before any of this
// renders. The FOG is loadMap()'s, and is per character rather than per route:
// there is nothing to gate here beyond being somebody.

export const metadata = { title: "Map" };

export default function MapPage() {
  return (
    <div className="map-shell">
      <AppHeader title="Map" />
      <MapBoard />
    </div>
  );
}
