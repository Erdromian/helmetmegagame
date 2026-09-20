const test = require("node:test");
const assert = require("node:assert");
const { mountRestingThisTurn, fastTravelBonus, equippedSlugs } = require("../lib/mounts");

const turnStart = new Date("2026-09-19T05:00:00Z");
const mounted = (acquiredAt) => [{ equipped: true, acquiredAt, tag: { slug: "arelitz" } }];

test("a mount that arrived this turn rests; one held since before it doesn't", () => {
  assert.equal(mountRestingThisTurn(mounted(new Date("2026-09-19T12:00:00Z")), turnStart), true);
  assert.equal(mountRestingThisTurn(mounted(new Date("2026-09-18T12:00:00Z")), turnStart), false);
  assert.equal(mountRestingThisTurn([], turnStart), false);
  assert.equal(mountRestingThisTurn(mounted(new Date()), null), false);
});

test("fastTravelBonus is zero while the mount is resting, normal once it isn't", () => {
  const active = equippedSlugs(mounted(new Date("2026-09-19T12:00:00Z")));
  assert.equal(fastTravelBonus(active, mounted(new Date("2026-09-19T12:00:00Z")), turnStart), 0);
  assert.equal(fastTravelBonus(active, mounted(new Date("2026-09-18T12:00:00Z")), turnStart), 1);
});

test("with no turnStartedAt supplied, fastTravelBonus is unaffected (display-only callers)", () => {
  const active = equippedSlugs(mounted(new Date()));
  assert.equal(fastTravelBonus(active, mounted(new Date()), null), 1);
});
