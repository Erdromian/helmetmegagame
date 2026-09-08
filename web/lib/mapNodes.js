import "server-only";
import fs from "node:fs";
import { cache } from "react";
import { docsPath } from "@lifeweb/db/lib/repoPaths";

// docs/assets/map-nodes.json, read at runtime — where each Location sits on
// the drawn plate, in image pixels.
//
// Authored in docs/ rather than copied into web/ so there is one coordinate
// table, next to the plate it was measured against. The image itself has to be
// served, so a copy of it lives at web/public/assets/map-plate.png; that copy
// is the ONLY duplicate, and it is a binary nobody hand-edits.
//
// Goes through db/lib/repoPaths#docsPath rather than path.join(__dirname, …)
// for the reason web/lib/handbook.js documents: Turbopack inlines __dirname as
// a literal in the Next server build, which silently breaks every hand-rolled
// docs/ read. React-cached rather than module scope, so re-measuring a node
// shows up without a redeploy.

export const PLATE_SRC = "/assets/map-plate.png";

const EMPTY = { width: 0, height: 0, nodes: {} };

const readNodes = cache(() => {
  const p = docsPath("assets/map-nodes.json");
  if (!p) return EMPTY;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      width: parsed.width ?? 0,
      height: parsed.height ?? 0,
      nodes: parsed.nodes ?? {},
    };
  } catch {
    // A missing or malformed table is not worth a 500: the map draws its known
    // Locations at no position rather than the page throwing. loadMap() drops
    // an unplaced node instead of stacking them all on the origin.
    return EMPTY;
  }
});

// The plate's own dimensions, which are the SVG viewBox.
export function plateSize() {
  const { width, height } = readNodes();
  return { width, height };
}

// { x, y } for one Location slug, or null if the table does not place it —
// a Location added to docs/zones.yaml but not yet measured onto the art.
export function nodeAt(slug) {
  const node = readNodes().nodes[slug];
  if (!node || typeof node.x !== "number" || typeof node.y !== "number") return null;
  return { x: node.x, y: node.y };
}
