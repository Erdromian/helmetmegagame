// The tag sync runs on every deploy, as web's Pre-Deploy Command, and the
// deploy cannot take traffic until it finishes. Almost every one of those runs
// carries no catalog edit at all, so the run that matters is the SECOND one:
// nothing to create, nothing to update, and — the part a batching rewrite is
// most likely to break — nothing WRITTEN and barely anything read.
//
// This drives the real docs/tags.yaml against an in-memory stand-in for
// Prisma, so it needs no database. It asserts three things about that second
// run: the counts are all zero, not one write goes out, and the number of
// reads is a small constant rather than one per tag. That last one is the
// regression: the sync used to ask the database about all 883 tags five times
// over, and a fix that only stopped the WRITES would still have been slow.
const test = require("node:test");
const assert = require("node:assert/strict");
const { syncTagsFromYaml } = require("../lib/syncTags");

// A stand-in for the bits of PrismaClient syncTags actually touches. It keeps
// rows in Maps and counts every call, split into reads and writes.
function fakePrisma() {
  let nextId = 0;
  const groups = new Map(); // id -> row
  const tags = new Map(); // id -> row
  const calls = { reads: 0, writes: 0, byName: {} };
  const note = (name, kind) => {
    calls[kind] += 1;
    calls.byName[name] = (calls.byName[name] ?? 0) + 1;
  };

  // Prisma answers a relation `set` with a list of {id}; the rest of the row is
  // scalars. Splitting them here keeps the fake honest about which is which.
  const applyData = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && Array.isArray(value.set)) {
        row[key] = value.set.map((r) => ({ id: r.id }));
      } else {
        row[key] = value;
      }
    }
    return row;
  };

  return {
    calls,
    tagGroup: {
      findMany: async () => {
        note("tagGroup.findMany", "reads");
        return [...groups.values()].map((g) => ({ ...g }));
      },
      findUnique: async ({ where }) => {
        note("tagGroup.findUnique", "reads");
        const row = [...groups.values()].find((g) => (where.id ? g.id === where.id : g.slug === where.slug));
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        note("tagGroup.create", "writes");
        const row = applyData({ id: `g${(nextId += 1)}`, requiredTagId: null }, data);
        groups.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        note("tagGroup.update", "writes");
        return { ...applyData(groups.get(where.id), data) };
      },
    },
    tag: {
      findMany: async () => {
        note("tag.findMany", "reads");
        return [...tags.values()].map((t) => ({ ...t }));
      },
      findUnique: async ({ where }) => {
        note("tag.findUnique", "reads");
        const row = [...tags.values()].find((t) => (where.id ? t.id === where.id : t.slug === where.slug));
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        note("tag.create", "writes");
        const row = applyData(
          { id: `t${(nextId += 1)}`, parentTagId: null, requiredTagId: null, requirementSkills: [], conflictsWith: [] },
          data,
        );
        tags.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        note("tag.update", "writes");
        return { ...applyData(tags.get(where.id), data) };
      },
    },
    // No living characters, so the carry rebase has nothing to walk. Its own
    // guard is covered separately below.
    character: {
      findMany: async () => {
        note("character.findMany", "reads");
        return [];
      },
    },
  };
}

test("a second tag sync creates nothing, updates nothing and writes nothing", async () => {
  const prisma = fakePrisma();

  const first = await syncTagsFromYaml(prisma);
  assert.ok(first.tagsCreated > 0, "the first run should build the catalog");
  assert.ok(first.groupsCreated > 0, "the first run should build the groups");

  const writesAfterFirst = prisma.calls.writes;
  const readsAfterFirst = prisma.calls.reads;

  const second = await syncTagsFromYaml(prisma);

  assert.equal(second.groupsCreated, 0, "groups created on a no-op run");
  assert.equal(second.groupsUpdated, 0, "groups updated on a no-op run");
  assert.equal(second.tagsCreated, 0, "tags created on a no-op run");
  assert.equal(second.tagsUpdated, 0, "tags updated on a no-op run");
  assert.equal(second.linksUpdated, 0, "links updated on a no-op run");

  assert.equal(
    prisma.calls.writes - writesAfterFirst,
    0,
    "a no-op run must not write a single row — if this fails, the in-memory diff disagrees with what was stored",
  );

  // The point of the rewrite: reads are a handful of bulk loads, not one per
  // tag. The catalog is ~880 tags, so anything near that number means an N+1
  // has come back. The bound is deliberately loose so adding one bulk read
  // does not fail the build.
  const reads = prisma.calls.reads - readsAfterFirst;
  assert.ok(
    reads <= 12,
    `a no-op run should read the catalog in bulk, not per row — took ${reads} reads: ${JSON.stringify(prisma.calls.byName)}`,
  );
});

test("the carry rebase is skipped when the catalog did not move", async () => {
  const prisma = fakePrisma();
  await syncTagsFromYaml(prisma);

  const before = prisma.calls.byName["character.findMany"] ?? 0;
  const second = await syncTagsFromYaml(prisma);

  assert.equal(second.carryRebased, 0);
  assert.equal(
    (prisma.calls.byName["character.findMany"] ?? 0) - before,
    0,
    "with no tag created or updated, no weight changed, so the holders must not even be looked up",
  );
});
