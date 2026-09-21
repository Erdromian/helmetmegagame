import MapBoard from "./MapBoard";
import { loadMap } from "./actions";

// The map as its own page — a link of its own, and a phone shouldn't open a full-bleed board inside the "Here"
// sheet. Owns its whole screen like Chat and the (desk) workspaces: no PageShell, no centred max-width, a column
// that doesn't scroll. Sign-in gate is the (app) layout's; the FOG is loadMap()'s, per character not per route. No
// AppHeader any more — the universal top bar ((app)/layout.js) already says "Map" via the active link.
//
// The board's data is read HERE rather than left to the board's own mount
// effect. loadMap is a server action, but there is nothing stopping a server
// component awaiting it, and the board still fetches for itself on every
// refresh after this one — so the /chat overlay, which has no page of its own,
// is untouched. What this saves is the whole read sitting behind hydration:
// the page used to ship, hydrate, and only then start asking.

export const metadata = { title: "Map" };

export default async function MapPage() {
  const initial = await loadMap();

  return (
    <div className="map-shell">
      <MapBoard initial={initial} />
    </div>
  );
}
