// The giant-blocking cave gate (MAP.md §2a "Tight squeeze"): pure —
// db/lib/locationGraph.js#crossingCheck, no Prisma — plus the docs/zones.yaml
// `tight_squeeze:` key it is authored from (db/lib/syncZones/parse.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const { crossingCheck } = require("../lib/locationGraph");
const { parseZonesYaml } = require("../lib/syncZones/parse");

const WAY = { hidden: false, requiredTagSlug: null, modular: false, isOpen: true, onFoot: false, tightSqueeze: true };

test("crossingCheck: a giant is refused a tight squeeze, unconditionally", () => {
  const bare = crossingCheck(WAY, { tagSlugs: ["giant"] });
  assert.equal(bare.passable, false);
  assert.equal(bare.listed, true);
  assert.equal(bare.refusal, "You're too big to fit through here.");

  const withUnrelatedTag = crossingCheck(WAY, { tagSlugs: ["giant", "strong"] });
  assert.equal(withUnrelatedTag.passable, false);
});

test("crossingCheck: climbing or caving is not a bypass — a giant is refused with either", () => {
  assert.equal(crossingCheck(WAY, { tagSlugs: ["giant", "climbing"] }).passable, false);
  assert.equal(crossingCheck(WAY, { tagSlugs: ["giant", "caving"] }).passable, false);
  assert.equal(crossingCheck(WAY, { tagSlugs: ["giant", "climbing", "caving"] }).passable, false);
});

test("crossingCheck: nobody without the giant tag is touched by tightSqueeze at all", () => {
  assert.equal(crossingCheck(WAY, { tagSlugs: [] }).passable, true);
  assert.equal(crossingCheck(WAY, { tagSlugs: ["climbing"] }).passable, true);
  assert.equal(crossingCheck(WAY, { tagSlugs: ["caving"] }).passable, true);
});

test("crossingCheck: an ordinary way never refuses a giant", () => {
  const ordinary = { ...WAY, tightSqueeze: false };
  assert.equal(crossingCheck(ordinary, { tagSlugs: ["giant"] }).passable, true);
});

// --- docs/zones.yaml `tight_squeeze:` -----------------------------------

function zonesDoc(connectionExtra) {
  return {
    zones: [
      {
        id: "z",
        name: "Z",
        locations: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      },
    ],
    connections: [{ pair: ["z/a", "z/b"], ...connectionExtra }],
  };
}

test("parseZonesYaml: tight_squeeze: true on a connection sets LocationLink.tightSqueeze", () => {
  const { connections } = parseZonesYaml(zonesDoc({ tight_squeeze: true }));
  assert.equal(connections[0].tightSqueeze, true);
});

test("parseZonesYaml: a plain connection defaults tightSqueeze to false", () => {
  const { connections } = parseZonesYaml(zonesDoc({}));
  assert.equal(connections[0].tightSqueeze, false);
});

test("parseZonesYaml: a non-boolean tight_squeeze is rejected", () => {
  assert.throws(() => parseZonesYaml(zonesDoc({ tight_squeeze: "yes" })), /non-boolean tight_squeeze/);
});
