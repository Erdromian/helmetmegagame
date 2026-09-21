// The fog a character is made with (db/lib/startingMemories.js). Pure YAML
// against the two masters, no Prisma — the same shape as
// roleStartingPlaces.test.js, and for the same reason: a fresh playground has
// no database rows to read.
//
// What this file is really for: the table is a hand-written list of map codes,
// and the map moves. A slug the database does not have is SILENTLY skipped by
// seedMemories (it findManys on `slug: in` and loops what came back), and
// inside threatSpawn it is skipped inside a catch that only console.errors. So
// a stale code costs somebody their map and says nothing. These assertions are
// the noise that was missing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { parseZonesYaml } = require("../lib/syncZones/parse");
const { entriesOf } = require("../lib/yamlEntries");
const {
  ROLE_MEMORIES,
  KIT_MEMORIES,
  UNDERTOWN_WITHHELD,
} = require("../lib/startingMemories");

const readMaster = (name) => yaml.load(fs.readFileSync(path.join(__dirname, "../../docs", name), "utf8"));

const { locationEntries, connections } = parseZonesYaml(readMaster("zones.yaml"));
const locationSlugs = new Set(locationEntries.map((location) => location.slug));

const roles = Object.values(readMaster("roles.yaml").groups).flatMap((group) => entriesOf(group, "slug"));

const everyTable = [...Object.entries(ROLE_MEMORIES), ...Object.entries(KIT_MEMORIES)];
const everySlug = new Set(everyTable.flatMap(([, slugs]) => slugs));

// A role with no entry gets a blank map rather than an error, which is how the
// Soiler shipped unable to see the Soilery. Nothing belongs here now; an entry
// added later should carry the reason it is deliberate.
const BLANK_MAP = new Set();

test("every slug in the table is a real Location in the zone master", () => {
  for (const [key, slugs] of everyTable) {
    for (const slug of slugs) {
      assert.ok(locationSlugs.has(slug), `${key} names "${slug}", which docs/zones.yaml has no Location for`);
    }
  }
});

test("every role in the role master knows something", () => {
  for (const role of roles) {
    if (BLANK_MAP.has(role.slug)) continue;
    assert.ok(ROLE_MEMORIES[role.slug]?.length, `role "${role.slug}" has no starting memory — add one, or say why it is blank in BLANK_MAP`);
  }
});

test("no table names a role the role master does not have", () => {
  const known = new Set(roles.map((role) => role.slug));
  for (const slug of Object.keys(ROLE_MEMORIES)) {
    assert.ok(known.has(slug), `ROLE_MEMORIES has "${slug}", which is not a role in docs/roles.yaml`);
  }
});

test("a role starts knowing the ground it is standing on", () => {
  for (const role of roles) {
    if (!role.starting_location || BLANK_MAP.has(role.slug)) continue;
    // recordArrival covers the spawn itself, so this is about the table being
    // honest rather than about the character being stranded — a seat whose own
    // home is missing from its list is the bum/pusher mistake, where a seat
    // that lives in the Undertown was handed the town above it instead.
    assert.ok(
      ROLE_MEMORIES[role.slug].includes(role.starting_location),
      `role "${role.slug}" starts at ${role.starting_location} and its table does not name it`,
    );
  }
});

// The Charon has no LocationLink at all, so it is never anybody's listed
// neighbour and this table is the ONLY way a seat can ever see it. The three
// seats are the arrangement in docs/systemdocs/CHARON.md, and until now a
// comment was the whole of what protected it.
test("only the Baron, the Baroness and the Hand know there is a ship", () => {
  const knowing = Object.entries(ROLE_MEMORIES)
    .filter(([, slugs]) => slugs.includes("fortress-6"))
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(knowing, ["baron", "baroness", "hand"]);
});

test("no table hands out a place that is only reachable by a hidden way", () => {
  // Derived rather than listed, so a secret added later is covered without
  // anybody remembering this file. A place whose every edge is hidden can
  // never be painted as a sighting — travelOptions drops those — so naming it
  // here would be the one real leak this table is capable of.
  const edges = new Map();
  for (const edge of connections) {
    for (const [near, far] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      if (!edges.has(near)) edges.set(near, []);
      edges.get(near).push({ far, hidden: edge.hidden });
    }
  }
  for (const [slug, ways] of edges) {
    if (ways.some((way) => !way.hidden)) continue;
    assert.ok(!everySlug.has(slug), `"${slug}" is reachable only by a hidden way, and a table hands it over`);
  }
});

test("the places held out by hand stay held out", () => {
  // The belt beside the brace above, and it is load-bearing rather than
  // duplicate. The derived test asks whether EVERY way in is hidden, and the
  // Hole in the Wall has a locked climb up from the Depths as well as its
  // hidden crawl off the Poorhouse — so the derived test would wave it
  // through. The Island and the Order Chambers are behind keys rather than
  // secrets and are held back on judgment, which nothing can derive.
  for (const slug of UNDERTOWN_WITHHELD) {
    assert.ok(!everySlug.has(slug), `"${slug}" is held out of the fog on purpose, and a table hands it over`);
  }
});

test("a place held out by hand is still a place", () => {
  // The Nook sat on this list until it was deleted from the game, which left a
  // dead slug guarding nothing and nobody any the wiser. The slug-resolution
  // test above only walks what the tables HAND OUT, so it cannot see this.
  for (const slug of UNDERTOWN_WITHHELD) {
    assert.ok(locationSlugs.has(slug), `"${slug}" is withheld, but docs/zones.yaml has no such Location — it guards nothing`);
  }
});
