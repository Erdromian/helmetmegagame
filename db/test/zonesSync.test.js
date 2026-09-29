// The zones sync's rule (db/lib/zonesSync.js), on the pure planner: three
// models in, a plan out. No database.
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

test("in step with the YAML and the baseline: nothing to do", () => {
  const y = yamlOf(fixture);
  const plan = planZonesSync(y, dbFrom(y), clone(y));
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.retires, []);
  assert.deepEqual(plan.deletes, []);
});

test("first run: the YAML wins every field that differs", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.rooms.bar.stashSeed = { resources: 0, items: [["alcohol", 4], ["cigarette", 6]] };
  db.locations.den.description = "Old words.";
  const plan = planZonesSync(y, db, null);
  assert.equal(plan.firstRun, true);
  assert.deepEqual(fields(plan), ["locations/den.description", "rooms/bar.stashSeed"]);
  assert.deepEqual(plan.updates.find((u) => u.field === "stashSeed").to, {
    resources: 0,
    items: [],
    hidden: [["alcohol", 4], ["cigarette", 6]],
  });
});

test("a GM's hand edit is kept while the YAML has not changed that field", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.locations.den.description = "A GM rewrote this.";
  const plan = planZonesSync(y, db, clone(y));
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.kept, [{ kind: "locations", key: "den", field: "description" }]);
});

test("a YAML change overwrites, and says so when a GM had changed it too", () => {
  const base = yamlOf(fixture);
  const doc = clone(fixture);
  doc.zones[0].locations[0].description = "New smoke, new dice.";
  doc.zones[0].locations[1].name = "The Old Slums";
  const y = yamlOf(doc);
  const db = dbFrom(base);
  db.locations.den.description = "A GM rewrote this.";
  const plan = planZonesSync(y, db, base);
  const byField = Object.fromEntries(plan.updates.map((u) => [`${u.key}.${u.field}`, u]));
  assert.equal(byField["den.description"].to, "New smoke, new dice.");
  assert.equal(byField["den.description"].conflict, true);
  assert.equal(byField["slums.name"].conflict, false);
});

test("a dropped room is retired only when the baseline had it", () => {
  const base = yamlOf(fixture);
  const doc = clone(fixture);
  doc.zones[0].locations[0].rooms = [];
  const y = yamlOf(doc);
  const db = dbFrom(base);

  const withBase = planZonesSync(y, db, base);
  assert.deepEqual(withBase.retires, [{ kind: "rooms", key: "bar" }]);
  assert.deepEqual(withBase.deletes, [{ kind: "sides", key: "bar|slums" }]);

  const firstRun = planZonesSync(y, db, null);
  assert.deepEqual(firstRun.retires, []);
  assert.deepEqual(firstRun.deletes, []);
  assert.ok(firstRun.reportOnly.some((r) => r.kind === "rooms" && r.key === "bar"));
});

test("a room a GM made at runtime is never touched", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.rooms["gm-cellar"] = { ...clone(db.rooms.bar), name: "Cellar", stashSeed: null };
  const plan = planZonesSync(y, db, clone(y));
  assert.deepEqual(plan.retires, []);
  assert.equal(plan.reportOnly.length, 0);
});

test("a dropped way is removed", () => {
  const base = yamlOf(fixture);
  const doc = clone(fixture);
  doc.connections = [];
  // Unreachable is only a warning, so the parse still passes.
  const plan = planZonesSync(yamlOf(doc), dbFrom(base), base);
  assert.deepEqual(plan.deletes, [{ kind: "links", key: "den|slums" }]);
});

test("a place a GM hard-deleted is not made again", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  delete db.rooms.bar;
  delete db.sides["bar|slums"];
  const plan = planZonesSync(y, db, clone(y));
  assert.deepEqual(plan.creates, []);
  assert.ok(plan.reportOnly.some((r) => r.key === "bar" && r.code === "hand-deleted"));

  const firstRun = planZonesSync(y, db, null);
  assert.ok(firstRun.creates.some((c) => c.kind === "rooms" && c.key === "bar"));
});

test("a GM's retire stands; a place the YAML brings back returns", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.rooms.bar.retired = true;

  const kept = planZonesSync(y, db, clone(y));
  assert.equal(kept.updates.length, 0);

  const base = clone(y);
  delete base.rooms.bar; // the YAML dropped it last time, and has it again now
  const back = planZonesSync(y, db, base);
  assert.deepEqual(fields(back), ["rooms/bar.retired"]);
});

test("a field the baseline predates is written without a conflict", () => {
  const y = yamlOf(fixture);
  const db = dbFrom(y);
  db.rooms.bar.soundproof = true;
  const base = clone(y);
  delete base.rooms.bar.soundproof;
  const plan = planZonesSync(y, db, base);
  assert.deepEqual(fields(plan), ["rooms/bar.soundproof"]);
  assert.equal(plan.updates[0].conflict, false);
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
