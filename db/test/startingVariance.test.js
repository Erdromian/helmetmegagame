// Starting money (db/lib/startingVariance.js): each character's bank balance
// and purse roll within 10% of the seat's figure, and each starting balance
// stocks the Vault with GameConfig.vaultReservePercent of itself. Pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  startingRange,
  varyStarting,
  varyStartingPurse,
  vaultStockFor,
  DEFAULT_VAULT_RESERVE_PERCENT,
} = require("../lib/startingVariance");
const { FIELDS } = require("../lib/gameConfigFields");

const low = () => 0;
const high = () => 0.9999999;

test("the range is 10% either side, rounded inward to whole obols", () => {
  assert.deepEqual(startingRange(350), { lo: 315, hi: 385 });
  assert.deepEqual(startingRange(57), { lo: 52, hi: 62 });
  assert.deepEqual(startingRange(10), { lo: 9, hi: 11 });
  assert.deepEqual(startingRange(30), { lo: 27, hi: 33 });
});

test("a figure under 10 cannot move, and 0 stays 0", () => {
  for (const n of [0, 1, 3, 9]) {
    assert.equal(varyStarting(n, low), n);
    assert.equal(varyStarting(n, high), n);
  }
});

test("both ends of the range are reachable and nothing lands outside it", () => {
  assert.equal(varyStarting(350, low), 315);
  assert.equal(varyStarting(350, high), 385);
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = varyStarting(88, rng);
    assert.ok(v >= 80 && v <= 96, `88 rolled ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 17, "every whole obol from 80 to 96 turns up");
});

test("only the purse in a role kit rolls", () => {
  const kit = new Map([["obol", 68], ["foodstuffs", 40], ["dagger", 1]]);
  varyStartingPurse(kit, high);
  assert.deepEqual([...kit], [["obol", 74], ["foodstuffs", 40], ["dagger", 1]]);
  const none = new Map([["dagger", 1]]);
  assert.deepEqual([...varyStartingPurse(none, high)], [["dagger", 1]]);
});

test("a starting balance stocks the Vault with its percentage, rounded up", () => {
  assert.equal(vaultStockFor({ roleSlug: "hand", balance: 57, percent: 40 }), 23); // 22.8
  assert.equal(vaultStockFor({ roleSlug: "courtier", balance: 10, percent: 40 }), 4);
  assert.equal(vaultStockFor({ roleSlug: "soiler", balance: 3, percent: 40 }), 2); // 1.2, never short
  assert.equal(vaultStockFor({ roleSlug: "merchant", balance: 88, percent: 100 }), 88);
  assert.equal(vaultStockFor({ roleSlug: "merchant", balance: 88, percent: 150 }), 132);
});

test("the Baron's balance, a zero balance and a zero percentage stock nothing", () => {
  assert.equal(vaultStockFor({ roleSlug: "baron", balance: 36, percent: 40 }), 0);
  assert.equal(vaultStockFor({ roleSlug: "hand", balance: 0, percent: 40 }), 0);
  assert.equal(vaultStockFor({ roleSlug: "hand", balance: 57, percent: 0 }), 0);
});

test("stocked character by character, the Vault never falls under the percentage", () => {
  const balances = [26, 18, 24, 57, 16, 22, 14, 10, 10, 44, 12, 31, 18, 22, 43, 23, 17, 10, 60, 18, 3, 3, 5, 8];
  const total = balances.reduce((a, b) => a + b, 0);
  const stock = balances.reduce((a, b) => a + vaultStockFor({ roleSlug: "x", balance: b, percent: 40 }), 0);
  assert.ok(stock >= total * 0.4, `${stock} against 40% of ${total}`);
  assert.ok(stock <= total * 0.4 + balances.length, "and over by less than an obol a character");
});

test("the dev-panel knob defaults to the same 40 the code falls back on", () => {
  const field = FIELDS.find((f) => f.key === "vaultReservePercent");
  assert.ok(field, "vaultReservePercent is on /gm/dev");
  assert.equal(field.default, DEFAULT_VAULT_RESERVE_PERCENT);
  assert.equal(field.group, "economy");
  const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
  assert.match(schema, /vaultReservePercent Int @default\(40\)/);
});

test("the Vault has no authored obols left to pour on top of the stock", () => {
  const zones = fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8");
  const vault = zones.slice(zones.indexOf("undertown-1-7:"), zones.indexOf("undertown-1-7:") + 2500);
  const items = vault.slice(vault.indexOf("items:"), vault.indexOf("elevator-key"));
  assert.doesNotMatch(items, /^\s+obol:/m);
});
