// The `wheels` attribute: an indoors Location a cart may come into anyway.
// docs/systemdocs/CARRY.md §3.
//
// The point of these is the SPLIT. `indoors` used to answer two questions at
// once, and the three places wearing `wheels` have to keep answering "is there
// a roof" the old way while answering "do wheels stay outside" the new one.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { parksMounts, describeLocation, ATTRIBUTES } = require("../lib/locationAttributes");
const { placeClassOf } = require("../lib/mood");
const { canBuildHere } = require("../lib/structures");

const CHAPEL = { indoors: true, attributes: { haven: true }, zone: { kind: "SURFACE" } };
const FACTORY = { indoors: true, attributes: { refinery: true, wheels: true }, zone: { kind: "SURFACE" } };
const FIELD = { indoors: false, attributes: {}, zone: { kind: "SURFACE" } };

test("parksMounts: a roof parks a cart, a roof with wheels does not", () => {
  assert.equal(parksMounts(CHAPEL), true);
  assert.equal(parksMounts(FACTORY), false);
  assert.equal(parksMounts(FIELD), false);
  // Nowhere at all is nowhere to park: a caller with no Location loaded must
  // never blind-refuse an equip.
  assert.equal(parksMounts(null), false);
});

test("wheels moves nothing but the cart", () => {
  // Still under a roof for the dial...
  assert.equal(placeClassOf(FACTORY), "INDOORS");
  // ...and still no palisade in the warehouse.
  assert.match(canBuildHere(FACTORY).reason, /indoors/);
});

test("a wheels Location says so once, not twice", () => {
  const lines = describeLocation(FACTORY);
  assert.ok(lines.some((line) => line.startsWith("**Wheels**")));
  // The placement line is suppressed there — two lines about the same cart
  // would read as an argument.
  assert.ok(!lines.some((line) => line.startsWith("**Indoors**")));
  assert.ok(describeLocation(CHAPEL).some((line) => line.startsWith("**Indoors**")));
});

test("the three places that carry wheels are the three the docs name", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8"));
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.attributes?.wheels) found.push(node.name);
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  assert.deepEqual(found.sort(), ["Customs", "Depot", "Godard Factory"]);
  assert.ok(ATTRIBUTES.wheels, "the sync rejects a key the registry doesn't know");
});
