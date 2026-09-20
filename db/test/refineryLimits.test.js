// node --test over the Factory's two limits (db/lib/refinery.js): a shift climbs the
// Tired -> Exhausted ladder like a day's mining, and only so many people fit on the floor in
// a turn. Pure and Prisma-free: the count is asked of a fake client, and the trigger is read
// straight off MOVE_EFFECTS.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REFINERY_MAX_WORKERS,
  REFINERY_FULL_MESSAGE,
  REFINERY_EXHAUSTED_MESSAGE,
  refineFatigueRefusal,
  refinersThisTurn,
} = require("../lib/refinery");
const { MOVE_EFFECTS } = require("../lib/moveEffects");
const { AUTO_MINE_NOTE, AUTO_REFINE_NOTE, TIRED_SLUG, EXHAUSTED_SLUG, PICKAXE_SLUG } = require("../lib/constants");
const { computeMiningAccess } = require("../lib/mining");

test("five people fit on the floor in a turn, and the sixth is told why", () => {
  assert.equal(REFINERY_MAX_WORKERS, 5);
  assert.equal(REFINERY_FULL_MESSAGE, "Too many people are producing Squeeze at the factory this turn.");
});

test("Exhausted refuses a shift, Tired and nothing at all do not", () => {
  assert.equal(refineFatigueRefusal(new Set([EXHAUSTED_SLUG])), REFINERY_EXHAUSTED_MESSAGE);
  assert.equal(refineFatigueRefusal([EXHAUSTED_SLUG, "lucky"]), REFINERY_EXHAUSTED_MESSAGE);
  assert.equal(refineFatigueRefusal(new Set([TIRED_SLUG])), null);
  assert.equal(refineFatigueRefusal(new Set()), null);
  assert.equal(refineFatigueRefusal(null), null);
});

test("Refine and Mine refuse on exactly the same tag: the ladder is one ladder", () => {
  for (const held of [[], [TIRED_SLUG], [EXHAUSTED_SLUG], [TIRED_SLUG, EXHAUSTED_SLUG]]) {
    // Mine also wants a pickaxe, so hold one: this compares the two on fatigue alone.
    const mineRefuses = !computeMiningAccess({ tagSlugs: new Set([...held, PICKAXE_SLUG]) }).ok;
    assert.equal(refineFatigueRefusal(held) != null, mineRefuses, `held ${JSON.stringify(held)}`);
  }
});

test("a refining shift steps the ladder at the push, the same as a day's mining", () => {
  const read = MOVE_EFFECTS.exhausted.read;
  assert.equal(read({ gmNotes: AUTO_REFINE_NOTE }), 1);
  assert.equal(read({ gmNotes: AUTO_MINE_NOTE }), 1);
  // Farming takes its own lockout and a craft or a hand-filed Move takes none.
  assert.equal(read({ gmNotes: "auto:farm" }), 0);
  assert.equal(read({ gmNotes: "auto:craft" }), 0);
  assert.equal(read({ gmNotes: null }), 0);
});

test("the seat count is this turn's refining shifts and nothing else", async () => {
  const asked = [];
  const fake = {
    action: {
      count: async (args) => {
        asked.push(args);
        return 3;
      },
    },
  };
  assert.equal(await refinersThisTurn(fake, "turn-9"), 3);
  assert.deepEqual(asked, [{ where: { turnId: "turn-9", gmNotes: AUTO_REFINE_NOTE } }]);
});
