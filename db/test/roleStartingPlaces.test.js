// A fresh playground imports only the current zone master. Old database rows
// must not be required to resolve the role picker's starting places.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { parseZonesYaml } = require("../lib/syncZones/parse");
const { entriesOf } = require("../lib/yamlEntries");

const readMaster = (name) => yaml.load(fs.readFileSync(path.join(__dirname, "../../docs", name), "utf8"));

test("every role can spawn using only the current zone master", async (t) => {
  const { zoneEntries, locationEntries } = parseZonesYaml(readMaster("zones.yaml"));
  const zones = new Map(zoneEntries.map((zone) => [zone.slug, zone]));
  const locations = new Map(locationEntries.map((location) => [location.slug, location]));
  for (const group of Object.values(readMaster("roles.yaml").groups)) {
    for (const role of entriesOf(group, "slug")) {
      await t.test(role.slug, () => {
        if (role.starting_zone) {
          const zone = zones.get(role.starting_zone);
          assert.ok(zone, `unknown starting zone: ${role.starting_zone}`);
          assert.notEqual(zone.kind, "CAVE_GROUP", "a group is not a standable zone");
          assert.ok(locationEntries.some((location) => location.zoneSlug === zone.slug), "starting zone has no locations");
        }
        if (role.starting_location) {
          const location = locations.get(role.starting_location);
          assert.ok(location, `unknown starting location: ${role.starting_location}`);
          if (role.starting_zone) assert.equal(location.zoneSlug, role.starting_zone, "starting location belongs to another zone");
        }
      });
    }
  }
});
