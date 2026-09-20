// Who takes your arelitz at the door. `indoors` used to answer two questions at
// once — is there a roof, and do wheels stay outside — and the split that
// survives is the one that matters: an indoors roof only parks a mount
// UNDERGROUND (`zone.kind === "CAVE_LEVEL"`). A surface chapel keeps its roof
// for the mood dial and for building, but admits a cart same as the square
// outside it.
//
// The `wheels` attribute used to except a place built to be driven into — the
// Godard Factory, the Depot, and the cave mouth. It is gone (CARRY.md §3), and
// the last test below is what keeps it gone: the registry is a closed world, so
// a stray `wheels:` left in the YAML would be a sync problem rather than a
// silent no-op.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { parksMounts, describeLocation, ATTRIBUTES } = require("../lib/locationAttributes");
const { placeClassOf } = require("../lib/mood");
const { canBuildHere } = require("../lib/structures");

const CHAPEL = { indoors: true, attributes: { haven: true }, zone: { kind: "SURFACE" } };
const FACTORY = { indoors: true, attributes: { refinery: true }, zone: { kind: "SURFACE" } };
const FIELD = { indoors: false, attributes: {}, zone: { kind: "SURFACE" } };
const CRYPT = { indoors: true, attributes: {}, zone: { kind: "CAVE_LEVEL" } };
const OPEN_CAVE = { indoors: false, attributes: {}, zone: { kind: "CAVE_LEVEL" } };

test("parksMounts: an underground roof parks a cart, and nothing else does", () => {
  assert.equal(parksMounts(CHAPEL), false);
  assert.equal(parksMounts(FACTORY), false);
  assert.equal(parksMounts(FIELD), false);
  assert.equal(parksMounts(CRYPT), true);
  // A roof is half the rule. Underground with no roof authored parks nothing —
  // which no real Location is today, since every Caves/Depths place is
  // `indoors: true`, but the function must not read the zone alone.
  assert.equal(parksMounts(OPEN_CAVE), false);
  // Nowhere at all is nowhere to park: a caller with no Location loaded must
  // never blind-refuse an equip.
  assert.equal(parksMounts(null), false);
});

test("a surface roof is still a roof for everything but the cart", () => {
  assert.equal(placeClassOf(FACTORY), "INDOORS");
  assert.match(canBuildHere(FACTORY).reason, /indoors/);
});

test("every indoors Location says which kind of roof it has, exactly once", () => {
  const surface = describeLocation(FACTORY);
  assert.ok(surface.some((line) => line.startsWith("**Indoors**: you can still bring")));
  assert.equal(surface.filter((line) => line.startsWith("**Indoors**")).length, 1);

  const underground = describeLocation(CRYPT);
  assert.ok(underground.some((line) => line.startsWith("**Indoors**: you can't equip")));

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
