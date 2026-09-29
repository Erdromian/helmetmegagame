// The zones sync's rule (db/lib/zonesSync.js), on the pure planner: the YAML
// and the database in, a plan out. No database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { planZonesSync, yamlModel, normalizeSeed, canonical } = require("../lib/zonesSync");
const { parseZonesYaml } = require("../lib/syncZones/parse");

const clone = (v) => JSON.parse(JSON.stringify(v));

// A small world: the Den with its Bar, a second location, one way between them.
const fixture = {
  zones: [
    {
      id: "undertown",
      name: "Undertown",
      locations: [
        {
          id: "den",
          name: "The Den",
          description: "Smoke and dice.",
          rooms: [
            {
              id: "bar",
              name: "Bar",
              stash: { hidden: { alcohol: 4, cigarette: 6 } },
              sides: [{ location: "slums" }],
            },
          ],
        },
        { id: "slums", name: "The Slums" },
      ],
    },
  ],
  connections: [["undertown/den", "undertown/slums"]],
};

const yamlOf = (doc) => yamlModel(parseZonesYaml(doc));

// The database as the importer would have left it, before any GM touched it.
function dbFrom(yamlM) {
  const db = clone(yamlM);
  for (const kind of ["zones", "locations", "rooms"]) {
    for (const row of Object.values(db[kind])) row.retired = false;
  }
  return db;
}

const fields = (plan) => plan.updates.map((u) => `${u.kind}/${u.key}.${u.field}`).sort();

test("in step with the YAML: nothing to do", () => {
  const y = yamlOf(fixture);
  const plan = planZonesSync(y, dbFrom(y));
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.retires, []);
  assert.deepEqual(plan.deletes, []);
});

test("a stale stash seed is brought up to the YAML", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.rooms.bar.stashSeed = { resources: 0, items: [["alcohol", 4], ["cigarette", 6]] };
  const plan = planZonesSync(y, db);
  assert.deepEqual(fields(plan), ["rooms/bar.stashSeed"]);
  assert.deepEqual(plan.updates[0].to, { resources: 0, items: [], hidden: [["alcohol", 4], ["cigarette", 6]] });
});

test("a GM's edit during the game goes back to the YAML", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.locations.den.description = "A GM rewrote this.";
  db.links["den|slums"].onFoot = true;
  const plan = planZonesSync(y, db);
  assert.deepEqual(fields(plan), ["links/den|slums.onFoot", "locations/den.description"]);
  assert.equal(plan.updates.find((u) => u.field === "description").to, "Smoke and dice.");
});

test("a place a GM made during the game is retired, its side and way removed", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.locations.cellar = { ...clone(db.locations.slums), name: "Cellar" };
  db.rooms.stall = { ...clone(db.rooms.bar), name: "Stall", locationSlug: "cellar", stashSeed: null };
  db.sides["stall|den"] = { kind: "PUBLIC", accessTagSlugs: [], sortOrder: 0 };
  db.links["cellar|den"] = clone(db.links["den|slums"]);
  const plan = planZonesSync(y, db);
  assert.deepEqual(plan.retires, [
    { kind: "locations", key: "cellar" },
    { kind: "rooms", key: "stall" },
  ]);
  assert.deepEqual(plan.deletes, [
    { kind: "sides", key: "stall|den" },
    { kind: "links", key: "cellar|den" },
  ]);
});

test("a place the YAML dropped is retired, and an already-retired one is left be", () => {
  const doc = clone(fixture);
  doc.zones[0].locations[0].rooms = [];
  const db = dbFrom(yamlOf(fixture));
  const plan = planZonesSync(yamlOf(doc), db);
  assert.deepEqual(plan.retires, [{ kind: "rooms", key: "bar" }]);
  assert.deepEqual(plan.deletes, [{ kind: "sides", key: "bar|slums" }]);

  db.rooms.bar.retired = true;
  delete db.sides["bar|slums"];
  assert.deepEqual(planZonesSync(yamlOf(doc), db).retires, []);
});

test("a place a GM retired or deleted comes back", () => {
  const y = yamlOf(fixture);
  const retired = dbFrom(y);
  retired.rooms.bar.retired = true;
  assert.deepEqual(fields(planZonesSync(y, retired)), ["rooms/bar.retired"]);

  const deleted = dbFrom(y);
  delete deleted.rooms.bar;
  delete deleted.sides["bar|slums"];
  const plan = planZonesSync(y, deleted);
  assert.deepEqual(plan.creates, [
    { kind: "rooms", key: "bar" },
    { kind: "sides", key: "bar|slums" },
  ]);
});

test("an access list is a set: order is not a change", () => {
  const doc = clone(fixture);
  doc.zones[0].locations[0].rooms[0].access = ["b-key", "a-key"];
  const y = yamlOf(doc);
  const db = dbFrom(y);
  db.rooms.bar.accessTagSlugs = ["a-key", "b-key"];
  assert.deepEqual(planZonesSync(y, db).updates, []);
});

test("a seed compares by what it pours, not how it was written", () => {
  assert.equal(normalizeSeed({ resources: 0, items: [] }), null);
  assert.equal(normalizeSeed(null), null);
  assert.deepEqual(normalizeSeed({ items: ["rock", ["obol", 2]] }), {
    resources: 0,
    items: [["rock", 1], ["obol", 2]],
    hidden: [],
  });
  assert.equal(canonical({ b: 1, a: [2] }), canonical({ a: [2], b: 1 }));
});
