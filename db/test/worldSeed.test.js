// The Restart Game wipe pulls down every standing structure, because Structure
// cascades from Location and the wipe never deletes a Location. Putting them
// back is db/lib/worldSeed.js, and it is what the wipe and Start Game both
// call. What matters is that it can run twice — the wipe seeds, then the Start
// Game after it seeds again — without raising a second crucifix, and that it
// leaves a structure players are still using alone.
const test = require("node:test");
const assert = require("node:assert/strict");

const { seedAuthoredStructures } = require("../lib/worldSeed");

const fixture = {
  zones: [
    {
      id: "town",
      name: "Town",
      locations: [
        { id: "square", name: "The Square", structures: ["crucifix"] },
        { id: "smithy", name: "The Smithy", structures: ["forge"] },
        { id: "nowhere", name: "Nowhere", structures: ["gallows"] },
      ],
    },
  ],
};

// `standing` is the structures already PRESENT, as [locationId, typeSlug]
// strings. `tags` is the catalog. `nowhere` is deliberately absent from the
// location table: the YAML names a place db:import-zones has not stood up yet.
function fakePrisma({ standing = [], tags = ["crucifix", "forge", "gallows"] } = {}) {
  const created = [];
  const present = new Set(standing);
  return {
    created,
    location: {
      findMany: async () => [
        { id: "l-square", slug: "square" },
        { id: "l-smithy", slug: "smithy" },
      ],
    },
    tag: {
      findUnique: async ({ where: { slug } }) => (tags.includes(slug) ? { name: slug } : null),
    },
    structure: {
      count: async ({ where }) => (present.has(`${where.locationId}:${where.typeSlug}`) ? 1 : 0),
      create: async ({ data }) => {
        created.push(`${data.locationId}:${data.typeSlug}`);
        present.add(`${data.locationId}:${data.typeSlug}`);
        return data;
      },
    },
  };
}

test("a wiped world gets its authored structures back", async () => {
  const prisma = fakePrisma();
  const report = await seedAuthoredStructures(prisma, { doc: fixture });

  assert.deepEqual(prisma.created, ["l-square:crucifix", "l-smithy:forge"]);
  assert.equal(report.structures, 2);
  assert.equal(report.locations, 2);
});

test("they are COMPLETE and cost nobody anything — they were always there", async () => {
  const seen = [];
  const prisma = fakePrisma();
  prisma.structure.create = async ({ data }) => {
    seen.push(data);
    return data;
  };
  await seedAuthoredStructures(prisma, { doc: fixture });

  for (const row of seen) {
    assert.equal(row.status, "COMPLETE");
    assert.equal(row.resourcesCost, 0);
    assert.equal(row.turnsDone, row.turnsNeeded);
  }
});

// The wipe seeds, then Start Game seeds again. The second pass must be a
// no-op, or every restart would double the furniture.
test("running it twice raises nothing a second time", async () => {
  const prisma = fakePrisma();
  await seedAuthoredStructures(prisma, { doc: fixture });
  prisma.created.length = 0;
  const second = await seedAuthoredStructures(prisma, { doc: fixture });

  assert.deepEqual(prisma.created, []);
  assert.equal(second.structures, 0);
  assert.equal(second.locations, 0);
});

// This is what makes it safe to run mid-game: a forge somebody is standing in
// is PRESENT, so it is skipped rather than raised beside itself.
test("a structure already standing is left alone", async () => {
  const prisma = fakePrisma({ standing: ["l-smithy:forge"] });
  await seedAuthoredStructures(prisma, { doc: fixture });

  assert.deepEqual(prisma.created, ["l-square:crucifix"]);
});

// Tags sync before this in the wipe's order, but a catalog can still be missing
// one. A typo must not cost the other locations their furniture.
test("an unknown tag is reported, not thrown, and the rest still seed", async () => {
  const prisma = fakePrisma({ tags: ["forge"] });
  const report = await seedAuthoredStructures(prisma, { doc: fixture });

  assert.deepEqual(prisma.created, ["l-smithy:forge"]);
  assert.ok(report.unknown.some((line) => line.startsWith("square: crucifix")));
});

// A place the YAML names that the database has never been given is
// db:import-zones' job, not this seeder's.
test("a location that does not exist is reported, never created", async () => {
  const prisma = fakePrisma();
  const report = await seedAuthoredStructures(prisma, { doc: fixture });

  assert.ok(report.unknown.some((line) => line.includes("nowhere")));
  assert.ok(!prisma.created.some((row) => row.includes("gallows")));
});
