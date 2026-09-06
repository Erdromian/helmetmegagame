#!/usr/bin/env node
// docs/zones.yaml -> a Graphviz .dot: one cluster per zone, one node per
// Location, one edge per `connections:` entry, styled for whatever actually
// gates the crossing.
//
//   npm run map:dot                 write zone.dot at the repo root
//   npm run map:dot -- out.dot      write somewhere else
//
//   dashed  = on_foot (no horse or cart)
//   dotted  = hidden (absent from the travel list without the tag)
//   bold    = modular (a gate with a winch)
//   blue    = crosses a zone, so the hop costs the Move
//   label   = whatever locked/hidden/announce/keyed the edge, so the graph
//             reads like the travel rules rather than just the map
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
// label short — "🏹 0.5, 🌾 0.3, 🎣 0.9" instead of three full words.
const LABOR_KINDS = ["hunting", "farming", "fishing"];
const LABOR_EMOJI = { hunting: "🏹", farming: "🌾", fishing: "🎣" };

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
    locations.set(locId, { name: loc.name, yield: loc.yield ?? null });
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
  const crossesZone = edge.a.split("/")[0] !== edge.b.split("/")[0];

  const style = [];
  if (edge.hidden) style.push("dotted");
  else if (edge.onFoot) style.push("dashed");
  if (edge.modular) style.push("bold");

  const label = [];
  if (edge.locked) label.push(`locked: ${edge.locked}`);
  if (edge.hidden) label.push(`hidden: ${edge.hidden}`);
  if (edge.announce) label.push(`announce: ${edge.announce}`);
  if (edge.keyed) label.push("keyed");

  const attrs = [];
  if (style.length) attrs.push(`style="${style.join(",")}"`);
  attrs.push(`color="${edge.hidden ? "gray45" : crossesZone ? "steelblue" : "black"}"`);
  if (crossesZone) attrs.push("penwidth=1.6");
  if (label.length) attrs.push(`label=${JSON.stringify(label.join("\\n"))}`);
  return ` [${attrs.join(", ")}]`;
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
    "  node [shape=box, style=rounded, fontname=Helvetica];",
    "",
  ];
  const loose = [];

  for (const [zoneId, zone] of zones) {
    lines.push(`  subgraph "cluster_${zoneId}" {`);
    lines.push(`    label=${JSON.stringify(zone.name)};`);
    for (const [locId, loc] of zone.locations) {
      const fullId = `${zoneId}/${locId}`;
      const yieldLine = yieldLabel(loc.yield);
      const label = yieldLine ? `${loc.name}\n${yieldLine}` : loc.name;
      const nodeLine = `${dotId(fullId)} [label=${JSON.stringify(label)}];`;
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

  lines.push("}");
  return lines.join("\n") + "\n";
}

function main() {
  const outPath = path.resolve(process.argv[2] ?? path.join(ROOT, "zone.dot"));
  const doc = yaml.load(fs.readFileSync(ZONES_PATH, "utf8"));
  const zones = collectZones(doc);
  const edges = collectEdges(doc);
  fs.writeFileSync(outPath, buildDot(zones, edges));
  console.log(`${edges.length} edges, ${zones.size} zones -> ${path.relative(ROOT, outPath)}`);
}

main();
