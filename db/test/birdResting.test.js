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

test("a bird the character was made with flies on the day they were made", () => {
  const dayStart = new Date("2026-09-19T05:00:00Z");
  const createdAt = new Date("2026-09-19T12:00:00.000Z");
  // Same creation transaction: stamped with (or a moment after) the character row.
  assert.equal(birdRestingToday(new Date("2026-09-19T12:00:00.000Z"), dayStart, createdAt), false);
  assert.equal(birdRestingToday(new Date("2026-09-19T12:00:00.250Z"), dayStart, createdAt), false);
  // Handed to them later the same day: still rests.
  assert.equal(birdRestingToday(new Date("2026-09-19T15:00:00Z"), dayStart, createdAt), true);
});
