// node --test over the roll floor: no die-plus-modifiers total in the game goes below 1
// (db/lib/rollDie.js#rollTotal). One case per roll that adds modifiers, so a new sum that
// forgets the floor shows up here. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");

const { rollTotal, MIN_ROLL_TOTAL } = require("../lib/rollDie");
const { rollLine } = require("../lib/gambitModifier");
const { rollCombat } = require("../lib/combatRoll");
const { resolveTorture } = require("../lib/torture");
const { stealTotal, stealSucceeds } = require("../lib/steal");
const { pickpocketOutcome } = require("../lib/pickpocket");
const { lessonOutcome } = require("../lib/lessons");
const { healOutcome } = require("../lib/healGambit");
const { breakInSucceeded } = require("../lib/arelitz");

function withDie(n, fn) {
  const real = Math.random;
  Math.random = () => (n - 1) / 6 + 0.01;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

test("rollTotal adds, and never goes below 1", () => {
  assert.equal(MIN_ROLL_TOTAL, 1);
  assert.equal(rollTotal(4, 1), 5);
  assert.equal(rollTotal(4), 4);
  assert.equal(rollTotal(1, 0), 1);
  assert.equal(rollTotal(2, -1), 1);
  assert.equal(rollTotal(2, -3), 1);
  assert.equal(rollTotal(1, -5), 1);
  assert.equal(rollTotal(3, null), 3);
});

test("a Gambit's reveal line shows 1, not a negative", () => {
  const { text, total } = rollLine({ number: 4 }, { diceRoll: 2, diceModifier: -3 });
  assert.equal(total, 1);
  assert.equal(text, "🎲 Your Gambit for turn 4: **2** (-3) → **1**");
});

test("a surprised fighter who rolls a 1 totals 1", () => {
  const roll = withDie(1, () => rollCombat([], { alert: false }));
  assert.equal(roll.die, 1);
  assert.equal(roll.total, 1);
});

test("torture, steal and pickpocket floor at 1 without changing who succeeds", () => {
  const t = resolveTorture({ die: 2, gambitMods: [{ label: "Panicking", value: -2 }, { label: "Starving", value: -1 }] });
  assert.equal(t.total, 1);
  assert.equal(t.success, false);

  const drunkClumsy = [{ label: "Clumsy", value: -2 }, { label: "Wasted", value: -2 }];
  assert.equal(stealTotal(2, drunkClumsy), 1);
  assert.equal(stealSucceeds(6, drunkClumsy), false);

  assert.equal(pickpocketOutcome(-3), "failed");
  assert.equal(pickpocketOutcome(1), "failed");
});

test("a lesson and a break-in floor at 1", () => {
  const l = lessonOutcome({ die: 1, diceModifier: -2, threshold: 4, learnerStatus: "ALIVE" });
  assert.equal(l.total, 1);
  assert.equal(l.succeeded, false);
  assert.equal(breakInSucceeded(1, -3), false);
});

test("a heal miss floors at 1, so its margin tops out at threshold − 1", () => {
  const out = healOutcome({ die: 2, diceModifier: -4, threshold: 4, severityRung: 1 });
  assert.equal(out.total, 1);
  assert.equal(out.margin, 3);
  assert.equal(out.complicationRung, 3);
});
