// node --test over the lamed half of the free zone move
// (db/lib/locationTravel.js's LAMED_SLUGS) — the tags that take the free
// crossing away without touching ACT, so a Crippled Leg or a dazed Pain
// Shock can still fight, work and walk around a zone, but can't cross into
// another one for free. Follows db/test/boatTravel.test.js's fixture
// pattern: freeZoneMoves/freeZoneMovesReason imported straight off
// db/lib/locationTravel.js, plain { tags } objects, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { freeZoneMoves, freeZoneMovesReason } = require("../lib/locationTravel");

const NAMES = { "pain-shock": "Pain Shock", "crippled-leg": "Crippled Leg", cripple: "Cripple", bruised: "Bruised", horse: "Horse" };
const withTags = (...slugs) => ({ tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: NAMES[slug] ?? slug } })) });

test("freeZoneMoves: Pain Shock zeroes the allowance same as Crippled Leg", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  assert.equal(freeZoneMoves(withTags("pain-shock"), config), 0);
  assert.equal(freeZoneMoves(withTags("crippled-leg"), config), 0);
});

test("freeZoneMoves: Cripple zeroes the allowance too", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  assert.equal(freeZoneMoves(withTags("cripple"), config), 0);
});

test("freeZoneMoves: a mount cancels Pain Shock's lameness, same as it does a bad leg", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const mounted = withTags("pain-shock", "horse");
  // base (1) + the horse's own bonus crossing (1) — the same total a
  // clear-headed rider gets, because isMounted() is checked before
  // LAMED_SLUGS and returns early.
  assert.equal(freeZoneMoves(mounted, config), 2);
});

test("freeZoneMovesReason: names Pain Shock and Cripple the same way it names Crippled Leg", () => {
  assert.match(freeZoneMovesReason(withTags("pain-shock")), /Pain Shock: you can't cross a zone for free without riding\./);
  assert.match(freeZoneMovesReason(withTags("cripple")), /Cripple: you can't cross a zone for free without riding\./);
});

test("freeZoneMoves: unaffected without a lamed tag", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  assert.equal(freeZoneMoves(withTags("bruised"), config), 1);
});
