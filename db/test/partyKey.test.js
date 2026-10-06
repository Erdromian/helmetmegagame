// The key a party leader lends their followers (MAP.md §3a):
// db/lib/locationGraph.js#partyKeyFor, against a fake prisma, then fed through
// crossingCheck the way locationTravel.js#performLocationMove does per follower.
const test = require("node:test");
const assert = require("node:assert/strict");

const { partyKeyFor, crossingCheck } = require("../lib/locationGraph");

const CATEGORY = { "den-key": "Items", caving: "Skills", "tunnel-rat": "General" };

// `ring` is the worn, registered ring's door tokens, or null for no ring.
function fakePrisma({ ring = null } = {}) {
  return {
    characterTag: { findFirst: async () => (ring ? { tag: { ringAccessSlugs: ring } } : null) },
    // leaderKeys asks once for every held slug the catalog files under Items.
    tag: { findMany: async ({ where }) => where.slug.in.filter((slug) => CATEGORY[slug] === where.category).map((slug) => ({ slug })) },
  };
}

const holding = (...slugs) => ({ id: "leader", tags: slugs.map((slug) => ({ equipped: false, tag: { slug } })) });
const WAY = { hidden: false, modular: false, isOpen: true, onFoot: false, tightSqueeze: false };

test("partyKeyFor: a key the leader holds is lent", async () => {
  assert.equal(await partyKeyFor(fakePrisma(), { ...WAY, requiredTagSlug: "den-key" }, holding("den-key")), "den-key");
});

test("partyKeyFor: a door token on the leader's worn ring is lent", async () => {
  const link = { ...WAY, requiredTagSlug: "tower-key" };
  assert.equal(await partyKeyFor(fakePrisma({ ring: ["tower-key"] }), link, holding()), "tower-key");
});

test("partyKeyFor: a skill or trait in the lock is never lent", async () => {
  assert.equal(await partyKeyFor(fakePrisma(), { ...WAY, requiredTagSlug: "caving" }, holding("caving")), null);
  assert.equal(await partyKeyFor(fakePrisma(), { ...WAY, requiredTagSlug: "tunnel-rat" }, holding("tunnel-rat")), null);
});

test("partyKeyFor: nothing to lend without the key, or without a lock", async () => {
  assert.equal(await partyKeyFor(fakePrisma(), { ...WAY, requiredTagSlug: "den-key" }, holding("caving")), null);
  assert.equal(await partyKeyFor(fakePrisma(), { ...WAY, requiredTagSlug: null }, holding("den-key")), null);
  assert.equal(await partyKeyFor(fakePrisma(), null, holding("den-key")), null);
});

test("a lent key opens a locked or hidden way for a follower without one", async () => {
  for (const hidden of [false, true]) {
    const link = { ...WAY, hidden, requiredTagSlug: "den-key" };
    assert.equal(crossingCheck(link, { tagSlugs: [] }).passable, false, "on their own they're refused");
    const lent = await partyKeyFor(fakePrisma(), link, holding("den-key"));
    assert.equal(crossingCheck(link, { tagSlugs: new Set([lent]) }).passable, true);
  }
});

test("a lent key opens only the lock — a Giant is still refused a tight squeeze", async () => {
  const link = { ...WAY, requiredTagSlug: "den-key", tightSqueeze: true };
  const lent = await partyKeyFor(fakePrisma(), link, holding("den-key"));
  assert.equal(crossingCheck(link, { tagSlugs: new Set(["giant", lent]) }).passable, false);
});
