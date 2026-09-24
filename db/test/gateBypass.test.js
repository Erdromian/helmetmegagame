// A modular gate on a zone boundary must be the only plain way between those
// two zones (db/lib/gateBypass.js), because a hop inside a zone is free. The
// Fortress had two ways round its portcullis until 2026-09-23.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { findGateBypasses } = require("../lib/gateBypass");
const { parseZonesYaml } = require("../lib/syncZones/parse");

const end = (zone, name) => ({ zone, name });
const edge = (a, b, extra = {}) => ({ a, b, modular: false, requiredTagSlug: null, ...extra });

test("a plain second edge between the same two zones is a bypass", () => {
  const gate = edge(end("town", "Residences"), end("fortress", "Gatehouse"), { modular: true });
  const round = edge(end("town", "Graveyard"), end("fortress", "Gatehouse"));
  assert.deepEqual(findGateBypasses([gate, round]), [
    { gate: "Residences <-> Gatehouse", bypasses: ["Graveyard <-> Gatehouse"] },
  ]);
});

test("the bypass is found whichever way round the zones are written", () => {
  const gate = edge(end("fortress", "Gatehouse"), end("town", "Residences"), { modular: true });
  const round = edge(end("town", "Sanctuary"), end("fortress", "Gatehouse"));
  assert.equal(findGateBypasses([round, gate]).length, 1);
});

test("a locked, hidden or second modular way round is not a bypass", () => {
  const gate = edge(end("fortress", "Keep"), end("hills", "Refuse Pit"), { modular: true });
  const lift = edge(end("fortress", "Keep"), end("hills", "Cliffs"), { requiredTagSlug: "elevator-key" });
  const winch = edge(end("fortress", "Court"), end("hills", "Bridge"), { modular: true });
  assert.deepEqual(findGateBypasses([gate, lift, winch]), []);
});

test("a gate inside one zone is not on a boundary, and is left alone", () => {
  const den = edge(end("undertown", "Alleys"), end("undertown", "Den"), { modular: true, requiredTagSlug: "den-key" });
  const back = edge(end("undertown", "Poorhouse"), end("undertown", "Den"));
  assert.deepEqual(findGateBypasses([den, back]), []);
});

// --- docs/zones.yaml ----------------------------------------------------

// parseZonesYaml takes a PARSED doc and throws on a problem rather than
// returning one, so a broken master fails this test loudly by itself.
function loadZones() {
  const raw = fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8");
  return parseZonesYaml(yaml.load(raw));
}

test("no gate in docs/zones.yaml has a plain way round it", () => {
  const { locationEntries, connections } = loadZones();
  const byRef = new Map(locationEntries.map((l) => [l.slug, { zone: l.zoneSlug, name: l.slug }]));
  const links = connections.map((c) => ({
    a: byRef.get(c.a),
    b: byRef.get(c.b),
    modular: c.modular,
    requiredTagSlug: c.requiredTagSlug,
  }));
  assert.deepEqual(findGateBypasses(links), []);
});

test("the Fortress has exactly one plain way in from the Town, and it is the portcullis", () => {
  const { locationEntries, connections } = loadZones();
  const zoneOf = new Map(locationEntries.map((l) => [l.slug, l.zoneSlug]));
  const townFortress = connections.filter((c) => {
    const zones = [zoneOf.get(c.a), zoneOf.get(c.b)].sort();
    return zones[0] === "fortress" && zones[1] === "town";
  });
  assert.deepEqual(
    townFortress.map((c) => [c.a, c.b].sort().join(" <-> ")),
    ["fortress-2 <-> town-8"],
  );
  assert.equal(townFortress[0].modular, true);
  assert.equal(townFortress[0].announce, "TRUE_NAME");
});
