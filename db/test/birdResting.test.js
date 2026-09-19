const test = require("node:test");
const assert = require("node:assert");
const { birdRestingToday } = require("../lib/bird");

test("a bird that arrived today rests; one from yesterday flies", () => {
  const dayStart = new Date("2026-09-19T05:00:00Z");
  assert.equal(birdRestingToday(new Date("2026-09-19T12:00:00Z"), dayStart), true);
  assert.equal(birdRestingToday(new Date("2026-09-18T12:00:00Z"), dayStart), false);
  assert.equal(birdRestingToday(null, dayStart), false);
  assert.equal(birdRestingToday(new Date(), null), false);
});
