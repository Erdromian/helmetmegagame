// The `named` lock clause (DESIRES.md §3): an exact list of Desire slugs on a
// tag's `desires: { locks: [...] }` block. Nothing validates those slugs at
// sync time, because tags sync before desires do and the catalog may not be in
// the database yet — so this is where a typo, a renamed Desire or a deleted
// one gets caught. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { normalizeDesireLocks, validateDesireLocks } = require("../lib/desireShapes");
const { lockedReasonForTemplate, unionLockClauses } = require("../lib/desireGates");
const { desireFamilyKeys } = require("../lib/desireFamilies");

const readMaster = (name) => yaml.load(fs.readFileSync(path.join(__dirname, "../../docs", name), "utf8"));

const tagsMaster = readMaster("tags.yaml");
const desiresMaster = readMaster("desires.yaml");

const desireSlugs = new Set(Object.keys(desiresMaster.desires ?? {}));

// Every tag in the master that carries at least one `named` clause.
function tagsWithNamedLocks() {
  const out = [];
  for (const [slug, entry] of Object.entries(tagsMaster.tags ?? {})) {
    const locks = entry?.desires?.locks;
    if (!Array.isArray(locks)) continue;
    if (locks.some((clause) => Array.isArray(clause?.named))) out.push([slug, entry]);
  }
  return out;
}

test("every slug a `named` lock lists is a real Desire", () => {
  const named = tagsWithNamedLocks();
  assert.ok(named.length > 0, "no tag carries a named lock — did Nobility lose its block?");
  for (const [slug, entry] of named) {
    for (const clause of entry.desires.locks) {
      for (const target of clause.named ?? []) {
        assert.ok(
          desireSlugs.has(target),
          `tag "${slug}" locks "${target}", which is not in docs/desires.yaml`,
        );
      }
    }
  }
});

test("a named lock survives normalize + validate", () => {
  const families = new Set(desireFamilyKeys());
  for (const [slug, entry] of tagsWithNamedLocks()) {
    const locks = normalizeDesireLocks(entry.desires.locks);
    validateDesireLocks(locks, { slug, families });
    const clause = locks.find((c) => Array.isArray(c.named));
    assert.deepEqual(clause.named, [...clause.named].sort(), "named should be stored sorted");
  }
});

test("named is exclusive with the other clause kinds, and with exceptFamilies", () => {
  const families = new Set(desireFamilyKeys());
  const bad = (clause) => () =>
    validateDesireLocks(normalizeDesireLocks([clause]), { slug: "test", families });

  assert.throws(bad({ named: ["eat-sweets"], tiers: [1] }), /exactly one of/);
  assert.throws(bad({ named: ["eat-sweets"], all: true }), /exactly one of/);
  assert.throws(bad({ named: ["eat-sweets"], families: ["food"] }), /exactly one of/);
  assert.throws(bad({ named: ["eat-sweets"], exceptFamilies: ["food"] }), /already the exact list/);
});

test("a named lock shuts exactly what it names and nothing else", () => {
  const pairs = unionLockClauses([
    { name: "Nobility", desireLocks: [{ named: ["eat-sweets", "win-a-bet"] }] },
  ]);
  const reason = (slug) => lockedReasonForTemplate({ slug, tier: 1, families: [] }, pairs);

  assert.equal(reason("eat-sweets"), "Locked by Nobility");
  assert.equal(reason("win-a-bet"), "Locked by Nobility");
  assert.equal(reason("receive-a-title"), null);
});

test("Nobility locks only Desires that exist, and leaves court life open", () => {
  const nobility = tagsMaster.tags?.nobility;
  assert.ok(nobility, "the nobility tag is gone from docs/tags.yaml");
  const clause = nobility.desires?.locks?.find((c) => Array.isArray(c.named));
  assert.ok(clause, "nobility no longer carries a named lock");

  const pairs = unionLockClauses([{ name: "Nobility", desireLocks: [clause] }]);
  // The seats a noble actually plays for must stay reachable, or the tag is
  // back to shutting the catalog the way `tiers: [1]` did.
  for (const slug of ["receive-a-title", "gain-court-position", "get-a-manor"]) {
    assert.ok(desireSlugs.has(slug), `${slug} is missing from the catalog`);
    assert.equal(lockedReasonForTemplate({ slug, tier: 1, families: [] }, pairs), null, `${slug} should stay open to a noble`);
  }
});
