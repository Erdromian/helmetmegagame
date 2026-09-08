import PageShell, { PageHeader } from "@/app/components/PageShell";
import MapBoard from "./MapBoard";

// The map as its own page. The overlay on /play mounts the identical board —
// this route exists so the map has a link of its own, and because a phone
// should not be opening a full-bleed board inside the "Here" sheet.
//
// The sign-in gate is the (app) layout's, which redirects before any of this
// renders. The FOG is loadMap()'s, and is per character rather than per route:
// there is nothing to gate here beyond being somebody.

export const metadata = { title: "Map" };

export default function MapPage() {
  return (
    <PageShell width="wide">
      <PageHeader title="Map" />
      <div className="panel map-page">
        <MapBoard />
      </div>
    </PageShell>
  );
}
