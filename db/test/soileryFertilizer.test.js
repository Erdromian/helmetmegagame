// node --test over db/lib/soilery.js#reapFoodstuffs's fertilized branch (the
// old Soilery doc's Addendum, kept by the rework): nothing withers, and each
// crop has a 1-in-6 chance of bringing in 2 Foodstuffs instead of 1. Pure and
// Prisma-free, same posture as soilery.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { reapFoodstuffs, BOUNTY_IN } = require("../lib/soilery");

test("unfertilized never exceeds planted", () => {
  for (let i = 0; i < 20; i++) assert.ok(reapFoodstuffs(600) <= 600);
});

test("fertilized never yields fewer than planted", () => {
  for (let i = 0; i < 20; i++) assert.ok(reapFoodstuffs(600, Math.random, { fertilized: true }) >= 600);
});

test("fertilized always rolling the bounty slot doubles everything", () => {
  assert.equal(reapFoodstuffs(100, () => 0, { fertilized: true }), 200);
});

test("fertilized real per-unit variance lands within 3 std dev of 7/6 a crop", () => {
  const planted = 60_000;
  const got = reapFoodstuffs(planted, Math.random, { fertilized: true });
  const p = 1 / BOUNTY_IN;
  const mean = planted * (1 + p);
  const sd = Math.sqrt(planted * p * (1 - p));
  assert.ok(Math.abs(got - mean) < 3 * sd, `got ${got}, expected about ${mean}`);
});

test("planting 0 fertilized reaps 0, with no rng calls needed", () => {
  assert.equal(reapFoodstuffs(0, () => { throw new Error("rng should not be called"); }, { fertilized: true }), 0);
});
