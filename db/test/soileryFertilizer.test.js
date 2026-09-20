// node --test over db/lib/soilery.js#reap's fertilized branch (SOILERY.md's
// Addendum). Pure and Prisma-free, same posture as soilery.test.js.
//
// Everything here counts CROPS, not plants: a surviving plant brings in
// CROPS_PER_PLANT of its crop, and the fertilized branch doubles that whole
// yield rather than adding a single unit to it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { reap, BOUNTY_IN, CROPS_PER_PLANT } = require("../lib/soilery");

test("reap: unfertilized never exceeds planted", () => {
  const planted = 600;
  const ceiling = planted * CROPS_PER_PLANT;
  const reaped = reap(planted, () => 0.99);
  assert.equal(reaped, ceiling);
  assert.ok(reap(planted) <= ceiling);
});

test("reap: fertilized never yields fewer than planted", () => {
  const planted = 600;
  // Never rolls the bounty slot — every plant lands as a plain one.
  assert.equal(reap(planted, () => 0.99, { fertilized: true }), planted * CROPS_PER_PLANT);
});

test("reap: fertilized always rolling the bounty slot doubles everything", () => {
  const planted = 600;
  // floor(0 * BOUNTY_IN) === 0 every time, which is the double branch.
  assert.equal(reap(planted, () => 0, { fertilized: true }), planted * CROPS_PER_PLANT * 2);
});

test("reap: fertilized real per-unit variance lands between planted and 2x planted, within 3 std dev of the mean", () => {
  const planted = 6000;
  const floor = planted * CROPS_PER_PLANT;
  const reaped = reap(planted, Math.random, { fertilized: true });
  assert.ok(reaped >= floor, `reaped ${reaped} is below ${floor} — fertilized never loses a plant`);
  assert.ok(reaped <= floor * 2, `reaped ${reaped} is above the 2x ceiling for ${planted} planted`);
  // Each plant is CROPS_PER_PLANT x (1 + Bernoulli(1/BOUNTY_IN)), so the mean
  // and the standard deviation both carry that factor — a scaled binomial,
  // offset by the floor, and the mirror of the ordinary wither roll's.
  const mean = floor + floor * (1 / BOUNTY_IN);
  const variance = planted * (1 / BOUNTY_IN) * (1 - 1 / BOUNTY_IN);
  const stdDev = Math.sqrt(variance) * CROPS_PER_PLANT;
  assert.ok(
    Math.abs(reaped - mean) <= 3 * stdDev,
    `reaped ${reaped} is more than 3 std dev (${stdDev.toFixed(1)}) from the expected mean ${mean}`,
  );
});

test("reap: planting 0 fertilized reaps 0, with no rng calls needed", () => {
  assert.equal(reap(0, Math.random, { fertilized: true }), 0);
});
