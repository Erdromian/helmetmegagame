// A roof no longer takes your arelitz (Bascinet's call, 2026-09-27; CARRY.md
// §3). `indoors` used to answer two questions at once — is there a roof, and
// do wheels stay outside — and the second went in two steps: first a surface
// roof stopped parking mounts, then an underground one did too. What survives
// is the roof itself, for the mood dial and for building. The one thing that
// still keeps a mount out is a way too narrow for it, which is a fact about
// the connection rather than the place, and refuses rather than dismounts
// (MAP.md §2c, db/test/onFootWay.test.js).
//
// The `wheels` attribute used to except a place built to be driven into — the
// Godard Factory, the Depot, and the cave mouth. It is gone, and the last test
// below is what keeps it gone: the registry is a closed world, so a stray
// `wheels:` left in the YAML would be a sync problem rather than a silent no-op.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const locationAttributes = require("../lib/locationAttributes");
const { describeLocation, ATTRIBUTES } = locationAttributes;
const { placeClassOf } = require("../lib/mood");
const { canBuildHere } = require("../lib/structures");

const FACTORY = { indoors: true, attributes: { refinery: true }, zone: { kind: "SURFACE" } };
const FIELD = { indoors: false, attributes: {}, zone: { kind: "SURFACE" } };
const CRYPT = { indoors: true, attributes: {}, zone: { kind: "CAVE_LEVEL" } };

test("no door parks a mount any more, underground included", () => {
  assert.equal(locationAttributes.parksMounts, undefined);
  // Nor does anything unequip one for you: db/lib/indoors.js went when the
  // narrow way started refusing instead of dismounting.
  assert.equal(fs.existsSync(path.join(__dirname, "..", "lib", "indoors.js")), false);
});

test("a roof is still a roof for everything but the mount", () => {
  assert.equal(placeClassOf(FACTORY), "INDOORS");
  assert.match(canBuildHere(FACTORY).reason, /indoors/);
});

test("every Location says whether it has a roof, exactly once, and that a mount comes in", () => {
  for (const place of [FACTORY, CRYPT]) {
    const lines = describeLocation(place);
    assert.equal(lines.filter((line) => line.startsWith("**Indoors**")).length, 1);
    assert.ok(lines.some((line) => line.startsWith("**Indoors**: you can still bring")));
  }
  assert.ok(describeLocation(FIELD).some((line) => line.startsWith("**Outdoors**")));
});

test("no Location carries `wheels` any more, and the registry would reject one", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8"));
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.attributes?.wheels) found.push(node.name);
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  assert.deepEqual(found, [], "a leftover `wheels:` would fail the zone sync as an unknown key");
  assert.equal(ATTRIBUTES.wheels, undefined, "the registry is the closed world the sync validates against");
});
