// Where a Mortus may tend the Web (REQUESTS.md §5a). /lifeweb used to ask for
// the Fortress zone, and when the Lifeweb moved down into the Undertown the
// check stayed behind: every Mortus saw both buttons grey, wherever they
// stood. The gate reads the `lifeweb` Location attribute now, so this keeps
// docs/zones.yaml holding exactly one such place — the Lifeweb itself.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { ATTRIBUTES, hasAttribute, describeLocation } = require("../lib/locationAttributes");
const { LIFEWEB_ATTRIBUTE } = require("../lib/lifeweb");

const zones = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8")).zones;

function marked() {
  const out = [];
  for (const [zoneSlug, zone] of Object.entries(zones)) {
    for (const [slug, location] of Object.entries(zone.locations ?? {})) {
      if (hasAttribute(location, LIFEWEB_ATTRIBUTE)) out.push({ zoneSlug, slug, name: location.name });
    }
  }
  return out;
}

test("the attribute is in the registry, so the zones sync accepts it", () => {
  assert.ok(ATTRIBUTES[LIFEWEB_ATTRIBUTE]);
});

test("exactly one place is the Lifeweb, and it is the Lifeweb", () => {
  const places = marked();
  assert.equal(places.length, 1, JSON.stringify(places));
  assert.equal(places[0].name, "Lifeweb");
  assert.equal(places[0].zoneSlug, "undertown");
});

test("Examine says nothing extra about it", () => {
  const lines = describeLocation({ indoors: false, attributes: { [LIFEWEB_ATTRIBUTE]: true } });
  assert.ok(!lines.some((l) => /lifeweb/i.test(l)), lines.join("\n"));
});
