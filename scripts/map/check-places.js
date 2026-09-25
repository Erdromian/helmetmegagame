#!/usr/bin/env node
// Does the master agree with the plate, and with itself?
//
//   npm run map:check
//
// Read-only, and it exits 1 on anything it calls a PROBLEM, so it can sit in
// front of a commit. Five questions:
//
//   1. Does docs/zones.yaml parse, and is every slug unique across zones,
//      locations and rooms? They share one namespace (SYNC.md).
//   2. Does every `access:` and `stash:` slug (items and hidden) name a real tag? The importer
//      cannot check this — tags sync after zones — so nothing else does.
//   3. Does every connection name two real Locations, and is each edge
//      stated once? Undirected, so stating it twice is an error.
//   4. Does every node on the Playscii plate have a Location at its slug,
//      and does every Location in a renumbered zone have a node?
//   5. Can you actually walk there? An unreachable Location is a Discord
//      channel nobody can ever stand in.
//
// Two places are exempt on purpose. A Location carrying the `offMap`
// attribute is drawn nowhere and linked to nothing by definition, so it
// answers neither (4) nor (5); and the Charon on the ground has no road
// because the Panic Room's button is its only door (db/lib/charonPlaces.js,
// docs/systemdocs/CHARON.md), so it answers (4) but not (5).
//
// The zones not yet renumbered are listed in PENDING below; their Locations
// are exempt from (4), and their unreachable places are reported as notes
// rather than problems.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { CHARON_SLUG } = require("../../db/lib/charonPlaces");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (...p) => yaml.load(fs.readFileSync(path.join(ROOT, ...p), "utf8"));

// Zones whose slugs are still descriptive rather than map codes. Each one
// comes off this list when its own renumbering pass lands.
const PENDING = new Set(["hills", "caves", "depths"]);

function main() {
  const zonesDoc = read("docs", "zones.yaml");
  const tagsDoc = read("docs", "tags.yaml");
  const plate = read("docs", "assets", "maps", "nodes.yaml");
  const tags = new Set(Object.keys(tagsDoc.tags ?? tagsDoc));

  const problems = [];
  const notes = [];
  const slugs = new Map();
  const locations = new Map(); // "zone/loc" -> { zone, slug, offMap }
  const claim = (slug, what) => {
    if (slugs.has(slug)) problems.push(`slug "${slug}" is used twice: ${slugs.get(slug)} and ${what}`);
    slugs.set(slug, what);
  };

  const walk = (zoneId, zone) => {
    for (const [locId, loc] of Object.entries(zone.locations ?? {})) {
      claim(locId, `location ${locId}`);
      locations.set(`${zoneId}/${locId}`, { zone: zoneId, slug: locId, offMap: Boolean(loc.attributes?.offMap) });
      for (const [roomId, room] of Object.entries(loc.rooms ?? {})) {
        claim(roomId, `room ${roomId}`);
        for (const slug of room.access ?? []) {
          if (!tags.has(slug)) problems.push(`room "${roomId}" access names "${slug}", which is not a tag`);
        }
        const stash = Array.isArray(room.stash)
          ? room.stash
          : Object.keys(room.stash?.items ?? {})
              .concat(Object.keys(room.stash?.hidden ?? {}))
              .concat(room.stash?.resources ? ["resources"] : []);
        for (const slug of stash) {
          if (!tags.has(slug)) problems.push(`room "${roomId}" stashes "${slug}", which is not a tag`);
        }
      }
    }
    for (const [levelId, level] of Object.entries(zone.levels ?? {})) {
      claim(levelId, `level ${levelId}`);
      walk(levelId, level);
    }
  };
  for (const [zoneId, zone] of Object.entries(zonesDoc.zones)) {
    claim(zoneId, `zone ${zoneId}`);
    walk(zoneId, zone);
  }

  // --- the graph
  const adjacent = new Map([...locations.keys()].map((k) => [k, []]));
  const stated = new Set();
  for (const entry of zonesDoc.connections ?? []) {
    const pair = Array.isArray(entry) ? entry : entry.pair;
    for (const end of pair) {
      if (!locations.has(end)) problems.push(`connection names "${end}", which is not a location`);
    }
    if (!pair.every((e) => locations.has(e))) continue;
    const key = [...pair].sort().join(" <-> ");
    if (stated.has(key)) problems.push(`edge ${key} is stated twice — connections are undirected`);
    stated.add(key);
    adjacent.get(pair[0]).push(pair[1]);
    adjacent.get(pair[1]).push(pair[0]);
  }

  // --- the plate
  const plated = new Set();
  for (const map of Object.values(plate.maps ?? {})) {
    for (const group of map.groups ?? []) {
      for (const [code, entry] of Object.entries(group.nodes ?? {})) {
        const name = typeof entry === "string" ? entry : entry.name;
        const slug = (typeof entry === "string" ? null : entry.slug) ?? `${group.zone}-${String(code).toLowerCase()}`;
        plated.add(slug);
        if (![...locations.values()].some((l) => l.slug === slug)) {
          problems.push(`the plate draws ${group.zone} "${code}" (${name}) at slug "${slug}", which is not a location`);
        }
      }
    }
  }
  for (const { zone, slug, offMap } of locations.values()) {
    if (PENDING.has(zone) || plated.has(slug) || offMap) continue;
    problems.push(`location "${slug}" is in a renumbered zone but nothing on the plate draws it`);
  }

  // --- can you get there
  const start = "town/town-2";
  if (adjacent.has(start)) {
    const queue = [start];
    const seen = new Set(queue);
    while (queue.length) {
      for (const next of adjacent.get(queue.pop())) if (!seen.has(next)) (seen.add(next), queue.push(next));
    }
    for (const key of locations.keys()) {
      if (seen.has(key)) continue;
      const { zone, slug, offMap } = locations.get(key);
      if (offMap || slug === CHARON_SLUG) continue;
      // A skeleton Location with no rooms is one nobody has written yet; it
      // gets its edges when its zone's pass lands, so it is a note.
      const bare = !Object.keys(zonesDoc.zones[zone]?.locations?.[key.split("/")[1]]?.rooms ?? {}).length;
      (bare || PENDING.has(zone) ? notes : problems).push(`${key} cannot be walked to from the Square`);
    }
  }

  for (const n of notes) console.log(`  note     ${n}`);
  for (const p of problems) console.error(`  PROBLEM  ${p}`);
  console.log(
    `\n${locations.size} locations, ${slugs.size} slugs, ${stated.size} edges, ${plated.size} nodes on the plate — ` +
      (problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "all agree"),
  );
  process.exit(problems.length ? 1 : 0);
}

if (require.main === module) main();
