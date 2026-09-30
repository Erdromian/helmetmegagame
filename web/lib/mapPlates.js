import "server-only";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { cache } from "react";
import { docsPath, repoPath } from "@lifeweb/db/lib/repoPaths";

// Where each Location sits on the drawn plate, in CELLS.
//
// `npm run map:build` writes two files per plate and the split is a fog rule,
// not tidiness (MAP.md §6b): the art goes to web/public/assets/maps/<id>.json
// for the browser to fetch, and the place table stays here in docs/, read
// server-side only. One file would have published the name, slug and cell of
// every place on the plate to anyone with curl, fogged or not.
//
// A slug with no marker is not an error. The Caves and the Depths have no
// plate yet, so `plateOf` answers null for them and loadMap sends the row
// anyway — drawn nowhere, listed everywhere.

// Drawing order, and the order the plate switch offers them in.
const PLATE_IDS = ["barony1", "barony2"];

// The art's URL carries a hash of the file, so a new drawing is a new URL.
// The board fetches it with `cache: "force-cache"`, which hands back ANY copy
// the browser holds, however old. Without the hash, a browser that opened the
// map before the stair glyph was added kept the stairless art for good, and
// drew no stairs at all (the GMs, who had the map open earliest).
export function plateUrl(id, version) {
  return `/assets/maps/${id}.json?v=${version}`;
}

const readPlates = cache(() => {
  const plates = [];
  const bySlug = new Map();
  for (const id of PLATE_IDS) {
    const nodesPath = docsPath("assets", "maps", `${id}.nodes.json`);
    const artPath = repoPath("web", "public", "assets", "maps", `${id}.json`);
    if (!nodesPath || !artPath) continue;
    let table;
    let raw;
    let art;
    try {
      table = JSON.parse(fs.readFileSync(nodesPath, "utf8"));
      raw = fs.readFileSync(artPath, "utf8");
      art = JSON.parse(raw);
    } catch {
      continue;
    }
    const version = createHash("sha1").update(raw).digest("hex").slice(0, 10);
    plates.push({ id, name: table.name ?? id, w: art.w, h: art.h, cell: art.cell, url: plateUrl(id, version) });
    for (const n of table.nodes ?? []) {
      if (typeof n.x !== "number" || typeof n.y !== "number") continue;
      bySlug.set(n.slug, { plate: id, x: n.x, y: n.y, code: n.code });
    }
  }
  return { plates, bySlug };
});

// Every plate, in drawing order: {id, name, w, h, cell, url}.
export function plates() {
  return readPlates().plates;
}

// null when no plate places this slug yet.
export function plateOf(slug) {
  return readPlates().bySlug.get(slug) ?? null;
}
