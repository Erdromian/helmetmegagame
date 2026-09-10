#!/usr/bin/env node
// docs/zones.yaml -> a Graphviz .dot: one cluster per zone, one node per
// Location, one edge per `connections:` entry, styled for whatever actually
// gates the crossing.
//
//   npm run map:dot                 write zone.dot at the repo root
//   npm run map:dot -- out.dot      write somewhere else
//
//   dashed   = on_foot (no horse, cart or boat fits) — wins over dotted below,
//              so an edge that's both hidden and on_foot still reads as on_foot
//   dotted   = hidden and NOT on_foot (absent from the travel list without the tag)
//   bold     = modular (a gate with a winch)
//   gray     = hidden
//   dark cyan = a Fishing Boat's extra crossing works here (both ends are in
//              db/lib/mounts.js's WATER_ZONE_SLUGS — Forest, Black Hills,
//              Marshes — and it isn't on_foot, since nothing stowable can
//              cross one of those at all)
//   blue     = crosses a zone otherwise, so the hop costs the Move
//   label    = whatever locked/hidden/announce/keyed the edge, so the graph
//              reads like the travel rules rather than just the map
//
// Each node's label also carries its `yield:` block (LABORING.md §3) — the
// authored `base` coefficients, one line per LaborKind. A Location with no
// row for a kind cannot work it there at all, so an absent line is a `×`,
// not a zero.
//
// A Location only clusters with its zone if it actually connects to another
// Location IN that zone (hills-mountain doesn't — both its edges leave the
// Black Hills entirely) — otherwise Graphviz still draws the false adjacency
// a shared cluster implies, with nothing to lay it out around.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const ZONES_PATH = path.join(ROOT, "docs", "zones.yaml");

// Fixed display order (the LaborKind enum in schema.prisma), so two
// Locations' yields line up down the page instead of following whatever
// order docs/zones.yaml happened to author them in. The emoji keep a node's
// label short — "🏹 0.5, 🌾 0.3, 🎣 0.9, ⛏️ 0.7" instead of four full words.
const LABOR_KINDS = ["hunting", "farming", "fishing", "prospecting"];
const LABOR_EMOJI = { hunting: "🏹", farming: "🌾", fishing: "🎣", prospecting: "⛏️" };

// Mirrors db/lib/mounts.js#WATER_ZONE_SLUGS — the only zones a Fishing Boat's
// extra crossing works between. Kept as its own small copy rather than a
// cross-package require, the same call every other doc-derived script here
// makes: this reads docs/zones.yaml, not the game's runtime state.
const WATER_ZONES = new Set(["forest", "hills", "marshes"]);

// `kind: group` zones (Underground) never appear in connections themselves —
// only their `levels:` do, each one a real zone id (caves, depths). Flatten
// them here so the returned map is keyed exactly how connections addresses
// them (SYNC.md, docs/zones.yaml's own header comment).
function collectZones(doc) {
  const zones = new Map(); // zoneId -> { name, locations: Map<locId, { name, yield }> }
  for (const [zoneId, zone] of Object.entries(doc.zones ?? {})) {
    if (zone.kind === "group") {
      for (const [levelId, level] of Object.entries(zone.levels ?? {})) {
        zones.set(levelId, { name: level.name, locations: collectLocations(level) });
      }
      continue;
    }
    zones.set(zoneId, { name: zone.name, locations: collectLocations(zone) });
  }
  return zones;
}

function collectLocations(zoneOrLevel) {
  const locations = new Map();
  for (const [locId, loc] of Object.entries(zoneOrLevel.locations ?? {})) {
    locations.set(locId, { name: loc.name, yield: loc.yield ?? null, indoors: Boolean(loc.indoors) });
  }
  return locations;
}

// "🏹 0.5, 🌾 0.3" — omits a kind with no row rather than printing a 0,
// since no row means the labor can't be done here at all.
function yieldLabel(yield_) {
  if (!yield_) return null;
  const parts = LABOR_KINDS.filter((kind) => yield_[kind] != null).map(
    (kind) => `${LABOR_EMOJI[kind]} ${yield_[kind]}`,
  );
  return parts.length ? parts.join(", ") : null;
}

// One normalized shape per connections: entry, whichever of the two forms
// (bare pair or a mapping with `pair:`) it was written as.
function collectEdges(doc) {
  return (doc.connections ?? []).map((entry) => {
    const isBare = Array.isArray(entry);
    const [a, b] = isBare ? entry : entry.pair;
    return {
      a,
      b,
      onFoot: !isBare && Boolean(entry.on_foot),
      modular: !isBare && Boolean(entry.modular),
      keyed: !isBare && Boolean(entry.keyed),
      locked: isBare ? null : (entry.locked ?? null),
      hidden: isBare ? null : (entry.hidden ?? null),
      announce: isBare ? null : (entry.announce ?? null),
    };
  });
}

function dotId(slug) {
  return JSON.stringify(slug); // quoted, so the "/" in a slug is fine
}

function edgeAttrs(edge) {
  const zoneA = edge.a.split("/")[0];
  const zoneB = edge.b.split("/")[0];
  const crossesZone = zoneA !== zoneB;
  // Boat-eligible by the zone-pair rule mounts.js#boatCrossing checks — minus
  // on_foot, since blocksOnFoot() refuses a boat (or anything else stowable)
  // at one of those regardless of which zones it joins.
  const boatWater = !edge.onFoot && WATER_ZONES.has(zoneA) && WATER_ZONES.has(zoneB);

  // on_foot always draws dashed, even on a hidden edge — a line SHAPE is the
  // one signal here that never competes with color, so it's the one thing
  // guaranteed legible no matter what else is layered on this edge.
  const style = [];
  if (edge.onFoot) style.push("dashed");
  else if (edge.hidden) style.push("dotted");
  if (edge.modular) style.push("bold");

  const label = [];
  if (edge.locked) label.push(`locked: ${edge.locked}`);
  if (edge.hidden) label.push(`hidden: ${edge.hidden}`);
  if (edge.announce) label.push(`announce: ${edge.announce}`);
  if (edge.keyed) label.push("keyed");

  const attrs = [];
  if (style.length) attrs.push(`style="${style.join(",")}"`);
  const color = edge.hidden ? "gray45" : boatWater ? "darkcyan" : crossesZone ? "steelblue" : "black";
  attrs.push(`color="${color}"`);
  if (boatWater || crossesZone) attrs.push("penwidth=1.6");
  // A real newline here, not the two-character "\n" — JSON.stringify escapes
  // an actual line break into DOT's `\n` for us. Pre-escaping it ourselves
  // double-escaped the backslash, so Graphviz printed "\nkeyed" literally
  // instead of breaking the line.
  if (label.length) attrs.push(`label=${JSON.stringify(label.join("\n"))}`);
  return ` [${attrs.join(", ")}]`;
}

// Light fills only — every node inside is forced to a solid white box
// (below), so a cluster tint can never eat into label contrast. Picked by
// what's actually there: the Marshes' standing water, the Fortress's
// heraldic purple, Town's lamplight, cave grey, and the Depths one notch
// darker and colder for being further down. Forest and the Black Hills get
// the same light-touch treatment for consistency, since every zone gets one.
const ZONE_FILL = {
  town: "#fdf6d3",
  fortress: "#e9def2",
  forest: "#deefe0",
  hills: "#ece1cb",
  marshes: "#dbe9f5",
  caves: "#e4e4e4",
  depths: "#c8ccd6",
};

// A standalone HTML-like label rather than literal legend edges: real edges
// would either fight rankdir=LR for a stacked layout or need invisible rank
// tricks, and a table gives every row equal weight for free. Two separate
// lists rather than one combined swatch per row, because style and color are
// genuinely independent channels here — a dashed edge can be black or gray,
// and knowing that is the whole point of §7's "dashed always wins" rule.
function legendLines() {
  const row = (glyph, glyphColor, text) =>
    `<TR><TD ALIGN="LEFT"><FONT COLOR="${glyphColor}">${glyph}</FONT></TD>` +
    `<TD ALIGN="LEFT">${text}</TD></TR>`;
  const table = [
    '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="3" CELLPADDING="1">',
    '<TR><TD COLSPAN="2"><B>Line style</B></TD></TR>',
    row("──────", "black", "Open road"),
    row("╌ ╌ ╌ ╌", "black", "On foot — no horse, cart or boat fits"),
    row("· · · · · · ·", "black", "Hidden only — and not on foot"),
    row("━━━━━━", "black", "Modular gate — a winch, shut or open"),
    '<TR><TD COLSPAN="2"> </TD></TR>',
    '<TR><TD COLSPAN="2"><B>Line color</B></TD></TR>',
    row("──────", "black", "Ordinary crossing"),
    row("──────", "steelblue", "Crosses a zone — costs the Move"),
    row("──────", "darkcyan", "A Fishing Boat's extra crossing works here"),
    row("──────", "gray45", "Hidden — always this color, dashed or not"),
    '<TR><TD COLSPAN="2"> </TD></TR>',
    '<TR><TD COLSPAN="2"><B>Location border</B></TD></TR>',
    // A real nested box-in-a-box, matching the peripheries=2 double border
    // on an indoors node itself — a word or a single-line glyph couldn't
    // show "two borders" the way the actual node shape does.
    '<TR><TD ALIGN="LEFT"><TABLE BORDER="1" CELLBORDER="1" CELLSPACING="2" CELLPADDING="6"><TR><TD></TD></TR></TABLE></TD>' +
      '<TD ALIGN="LEFT">Indoors — a mount/cart/boat is parked at the door</TD></TR>',
    "</TABLE>",
  ].join("");
  return [
    '  subgraph cluster_legend {',
    '    label="Legend";',
    "    style=filled;",
    '    fillcolor="white";',
    '    fontname=Helvetica;',
    `    legend [shape=none, margin=0, fontname=Helvetica, label=<${table}>];`,
    "  }",
  ];
}

function buildDot(zones, edges) {
  // Which nodes have at least one edge to another node in the SAME zone —
  // the only nodes a cluster's layout can actually justify grouping.
  const clustered = new Set();
  for (const edge of edges) {
    if (edge.a.split("/")[0] === edge.b.split("/")[0]) {
      clustered.add(edge.a);
      clustered.add(edge.b);
    }
  }

  const lines = [
    "// Generated by scripts/map/zone-dot.js from docs/zones.yaml — do not hand-edit.",
    "graph zones {",
    "  rankdir=LR;",
    '  node [shape=box, style="rounded,filled", fillcolor=white, fontname=Helvetica];',
    "",
  ];
  const loose = [];

  for (const [zoneId, zone] of zones) {
    lines.push(`  subgraph "cluster_${zoneId}" {`);
    lines.push(`    label=${JSON.stringify(zone.name)};`);
    lines.push("    style=filled;");
    lines.push(`    fillcolor="${ZONE_FILL[zoneId] ?? "white"}";`);
    for (const [locId, loc] of zone.locations) {
      const fullId = `${zoneId}/${locId}`;
      const yieldLine = yieldLabel(loc.yield);
      const label = yieldLine ? `${loc.name}\n${yieldLine}` : loc.name;
      // A double border, not a color or a word: peripheries is the node-shape
      // equivalent of an edge's line style, and indoors already has its own
      // mechanic (a mount is parked at the door — CARRY.md §3) rather than
      // sharing a channel with something else.
      const peripheries = loc.indoors ? ", peripheries=2" : "";
      const nodeLine = `${dotId(fullId)} [label=${JSON.stringify(label)}${peripheries}];`;
      if (clustered.has(fullId)) lines.push(`    ${nodeLine}`);
      else loose.push(`  ${nodeLine}`);
    }
    lines.push("  }");
  }
  lines.push(...loose);
  lines.push("");

  for (const edge of edges) {
    lines.push(`  ${dotId(edge.a)} -- ${dotId(edge.b)}${edgeAttrs(edge)};`);
  }
  lines.push("", ...legendLines());

  lines.push("}");
  return lines.join("\n") + "\n";
}

// The pure read-YAML-to-dot-text step, exported so scripts/map/zone-image.js
// can render straight from it without shelling back out to this file or
// re-reading a .dot that might be stale.
function generateDot() {
  const doc = yaml.load(fs.readFileSync(ZONES_PATH, "utf8"));
  const zones = collectZones(doc);
  const edges = collectEdges(doc);
  return { dot: buildDot(zones, edges), zoneCount: zones.size, edgeCount: edges.length };
}

function main() {
  const outPath = path.resolve(process.argv[2] ?? path.join(ROOT, "zone.dot"));
  const { dot, zoneCount, edgeCount } = generateDot();
  fs.writeFileSync(outPath, dot);
  console.log(`${edgeCount} edges, ${zoneCount} zones -> ${path.relative(ROOT, outPath)}`);
}

if (require.main === module) main();

module.exports = { generateDot, ROOT };
