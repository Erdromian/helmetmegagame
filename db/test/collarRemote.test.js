// db/lib/collar.js#canWorkRemote: the Remote Detonator answers to the Exactor's
// ring, worn (docs/systemdocs/COLLAR.md §3). Keyed like a door, not like the
// seat, so a stolen ring works it — but only on a finger, only once registered,
// and never a held tag that happens to share the ring's token.
const test = require("node:test");
const assert = require("node:assert/strict");
const { canWorkRemote, wearsExactorsRing, DETONATOR_SLUG, EXACTOR_RING_TOKEN } = require("../lib/collar");
const { accessSlugsOf, wornRingAccess } = require("../lib/rings");

const ring = (over = {}) => ({
  slug: "custom-ring-x",
  ringOfCharacterId: "c1",
  ringRegisteredAt: new Date(),
  ringAccessSlugs: ["den-key", EXACTOR_RING_TOKEN, "silver-chip"],
  ...over,
});
const remote = { equipped: false, tag: { slug: DETONATOR_SLUG } };

function gate(tags) {
  return canWorkRemote(accessSlugsOf(tags), wornRingAccess(tags));
}

test("the remote answers to whoever wears the Exactor's ring", () => {
  assert.equal(gate([remote, { equipped: true, tag: ring() }]), true);
});

test("the remote alone arms nobody", () => {
  assert.equal(gate([remote]), false);
});

test("the ring alone sets nothing off", () => {
  assert.equal(gate([{ equipped: true, tag: ring() }]), false);
});

test("the Exactor's ring in a pocket works no remote", () => {
  assert.equal(gate([remote, { equipped: false, tag: ring() }]), false);
});

test("an unregistered ring works no remote", () => {
  assert.equal(gate([remote, { equipped: true, tag: ring({ ringRegisteredAt: null }) }]), false);
});

test("somebody else's ring works no remote", () => {
  assert.equal(gate([remote, { equipped: true, tag: ring({ ringAccessSlugs: ["barons-key", "tower-key"] }) }]), false);
});

test("a held tag with the ring's token is not the ring", () => {
  assert.equal(gate([remote, { equipped: false, tag: { slug: EXACTOR_RING_TOKEN } }]), false);
});

test("wornRingAccess reads only a worn, registered ring", () => {
  assert.deepEqual(wornRingAccess([{ equipped: true, tag: ring() }]), ring().ringAccessSlugs);
  assert.deepEqual(wornRingAccess([{ equipped: false, tag: ring() }]), []);
  assert.deepEqual(wornRingAccess([{ equipped: true, tag: ring({ ringRegisteredAt: null }) }]), []);
  assert.equal(wearsExactorsRing(null), false);
});
