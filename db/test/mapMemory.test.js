// The map everybody but the outsiders is made remembering (db/lib/mapMemory.js,
// Map.docx). Pure YAML against docs/zones.yaml, no Prisma — the same shape as
// startingMemories.test.js — so it runs in a fresh playground with no rows.
//
// What it guards is the doc's own caveat: "check to make sure this doesn't
// reveal anything people aren't supposed to know". The floor is a RULE rather
// than a list, so these are the places the rule has to keep dark, asserted by
// name, plus the scramble rule for ways on the board.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { parseZonesYaml } = require("../lib/syncZones/parse");
const { isMapOutsider, mapFloorIds } = require("../lib/mapMemory");
const { LATE_JOIN_ROLE_SLUGS } = require("../lib/lateJoin");
const { scrambleState, scrambleText } = require("../lib/memoryScramble");

const master = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8"));
const { zoneEntries, locationEntries, connections } = parseZonesYaml(master);

// Rows shaped like the loader's: slug as id, the zone's kind riding along.
const kindOf = new Map(zoneEntries.map((z) => [z.slug, z.kind]));
const locations = locationEntries.map((l) => ({
  id: l.slug,
  retiredAt: null,
  attributes: l.attributes ?? {},
  zone: { kind: kindOf.get(l.zoneSlug) },
}));
const links = connections.map((c) => ({ aId: c.a, bId: c.b, hidden: c.hidden }));
const floor = mapFloorIds(locations, links);

test("the floor is the town, the fortress, the hills and the Undertown", () => {
  for (const slug of ["town-1", "town-7", "fortress-1", "fortress-5", "bridge", "factory", "undertown-a", "undertown-5"]) {
    assert.ok(floor.has(slug), `${slug} should be remembered by everybody`);
  }
});

test("nothing in the Caves or the Depths is on it", () => {
  for (const l of locations) {
    if (l.zone.kind === "CAVE_LEVEL") assert.ok(!floor.has(l.id), `${l.id} is underground and was handed over`);
  }
});

test("the secrets stay secret", () => {
  // The Charon: no way at all, known only to its three seats.
  assert.ok(!floor.has("fortress-6"), "the Charon was handed over");
  // The Charon in orbit: offMap, and edgeless.
  for (const l of locations) {
    if (l.attributes?.offMap) assert.ok(!floor.has(l.id), `${l.id} is off the map and was handed over`);
  }
  // The Hole in the Wall: hidden crawls and a climb out of the Depths.
  assert.ok(!floor.has("undertown-f"), "the Hole in the Wall was handed over");
});

test("a place reached only by hidden ways is never on it", () => {
  const ways = new Map();
  for (const c of connections) {
    for (const [near, far] of [[c.a, c.b], [c.b, c.a]]) {
      if (!ways.has(near)) ways.set(near, []);
      ways.get(near).push({ far, hidden: c.hidden });
    }
  }
  for (const id of floor) {
    const open = (ways.get(id) ?? []).filter((w) => !w.hidden && floor.has(w.far));
    assert.ok(open.length > 0, `${id} is on the floor with no ordinary way to anywhere else on it`);
  }
});

test("a retired place drops off", () => {
  const retired = locations.map((l) => (l.id === "town-2" ? { ...l, retiredAt: new Date() } : l));
  assert.ok(!mapFloorIds(retired, links).has("town-2"));
});

test("the outsiders are the Migrant and the late joins, and nobody else", () => {
  assert.ok(isMapOutsider("migrant"));
  for (const slug of LATE_JOIN_ROLE_SLUGS) assert.ok(isMapOutsider(slug), `${slug} should be an outsider`);
  for (const slug of ["mercenary", "baron", "bum", "merchant", "cerberus"]) {
    assert.ok(!isMapOutsider(slug), `${slug} should start knowing the map`);
  }
});

test("a scrambled memory drops about three ways in four, the same ones every time", () => {
  const state = scrambleState({
    characterId: "c1",
    tags: [{ slug: "concussed", acquiredAt: "2026-09-27T00:00:00Z" }],
    dayNumber: 4,
  });
  const lost = links.filter((_, i) => scrambleText(state, `way:${i}`, "x").scrambled).length;
  const share = lost / links.length;
  assert.ok(share > 0.55 && share < 0.95, `scrambled ${Math.round(share * 100)}% of ways`);
  const again = links.filter((_, i) => scrambleText(state, `way:${i}`, "x").scrambled).length;
  assert.equal(again, lost);
  // Not concussed: nothing is lost.
  const clear = scrambleState({ characterId: "c1", tags: [], dayNumber: 4 });
  assert.equal(links.filter((_, i) => scrambleText(clear, `way:${i}`, "x").scrambled).length, 0);
});
