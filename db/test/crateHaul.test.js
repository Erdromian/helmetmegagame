// Hauling a crate (db/lib/crateHaul.js, CARRY.md §10): the first haul of a turn climbs the Tired
// ladder, and an Exhausted it lands on is stamped for THIS turn — it used to carry a "2t" clock.
// A fake database holding one character's crate claim and fatigue rows; the mood leg is stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { TIRED_SLUG, EXHAUSTED_SLUG } = require("../lib/constants");
const { turnsLeft } = require("../lib/turnFormat");

// The mood leg reads a whole character; this test is about the ladder, so it only counts calls.
const moodCalls = [];
const moodPath = path.join(__dirname, "../lib/mood.js");
require.cache[moodPath] = {
  id: moodPath,
  filename: moodPath,
  loaded: true,
  exports: { applyMood: async (_tx, characterId, opts) => moodCalls.push({ characterId, kind: opts.kind }) },
};
const { chargeCrateHaul } = require("../lib/crateHaul");
const { applyFatigueStep } = require("../lib/fatigue");

const TAGS = {
  [TIRED_SLUG]: { id: "t-tired", defaultDurationTurns: 1 },
  [EXHAUSTED_SLUG]: { id: "t-exhausted", defaultDurationTurns: 1 },
};
const SLUG_OF = { "t-tired": TIRED_SLUG, "t-exhausted": EXHAUSTED_SLUG };

function fakeTx({ held = [], crateHauledTurn = null } = {}) {
  let next = 0;
  const me = { id: "ada", crateHauledTurn, rows: held.map(({ slug, expiresTurn = null }) => ({ id: `r${next++}`, slug, expiresTurn })) };
  const tx = {
    me,
    tag: { findUnique: async ({ where }) => TAGS[where.slug] ?? null },
    character: {
      // The claim: WHERE crateHauledTurn is null or not this turn.
      updateMany: async ({ data }) => {
        if (me.crateHauledTurn === data.crateHauledTurn) return { count: 0 };
        me.crateHauledTurn = data.crateHauledTurn;
        return { count: 1 };
      },
    },
    characterTag: {
      findFirst: async ({ where }) => me.rows.find((r) => r.slug === where.tag.slug) ?? null,
      delete: async ({ where }) => {
        me.rows = me.rows.filter((r) => r.id !== where.id);
      },
      createMany: async ({ data }) => {
        let count = 0;
        for (const d of data) {
          const slug = SLUG_OF[d.tagId];
          if (me.rows.some((r) => r.slug === slug)) continue;
          me.rows.push({ id: `r${next++}`, slug, expiresTurn: d.expiresTurn });
          count += 1;
        }
        return { count };
      },
    },
  };
  return tx;
}

const hauler = (extra = []) => ({ id: "ada", tags: extra.map((slug) => ({ tag: { slug } })) });
const row = (tx, slug) => tx.me.rows.find((r) => r.slug === slug) ?? null;
const TURN = { id: "turn-7", number: 7 };

test.beforeEach(() => {
  moodCalls.length = 0;
});

test("a first haul makes you Tired, carried into the next turn", async () => {
  const tx = fakeTx();
  const out = await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 1, turn: TURN });
  assert.equal(out.tired, true);
  assert.deepEqual(tx.me.rows.map((r) => r.slug), [TIRED_SLUG]);
  assert.equal(row(tx, TIRED_SLUG).expiresTurn, 8);
  assert.equal(tx.me.crateHauledTurn, 7);
});

test("a haul while Tired makes you Exhausted for the rest of THIS turn only", async () => {
  // The Banneret's case: Tired from yesterday's haul (granted on turn 6, lasting through 7).
  const tx = fakeTx({ held: [{ slug: TIRED_SLUG, expiresTurn: 7 }], crateHauledTurn: 6 });
  await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 1, turn: TURN });
  assert.deepEqual(tx.me.rows.map((r) => r.slug), [EXHAUSTED_SLUG], "the Tired row is consumed by the step");
  assert.equal(row(tx, EXHAUSTED_SLUG).expiresTurn, 7, "stamped for the open turn, so the push turns it into Tired");
  assert.equal(turnsLeft(row(tx, EXHAUSTED_SLUG).expiresTurn, TURN.number), 1, "the sheet reads 'Expires this turn', not 2t");
});

test("only the first haul of a turn tires you", async () => {
  const tx = fakeTx();
  await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 1, turn: TURN });
  const again = await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 1, turn: TURN });
  assert.equal(again.tired, false);
  assert.deepEqual(tx.me.rows.map((r) => r.slug), [TIRED_SLUG]);
  // The mood cost is per crate picked up, every time.
  assert.equal(moodCalls.length, 2);
});

test("an Exhausted hauler climbs nothing and keeps their clock", async () => {
  const tx = fakeTx({ held: [{ slug: EXHAUSTED_SLUG, expiresTurn: 7 }] });
  const out = await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 1, turn: TURN });
  assert.equal(out.tired, false);
  assert.deepEqual(tx.me.rows, [{ id: "r0", slug: EXHAUSTED_SLUG, expiresTurn: 7 }]);
});

test("Pack Mule and Strong haul for free", async () => {
  for (const slug of ["pack-mule", "strong"]) {
    const tx = fakeTx();
    const out = await chargeCrateHaul(tx, hauler([slug]), { moved: 1, pickedUp: 1, turn: TURN });
    assert.deepEqual(out, { tired: false, mood: false });
    assert.equal(tx.me.rows.length, 0);
    assert.equal(tx.me.crateHauledTurn, null);
  }
  assert.equal(moodCalls.length, 0);
});

test("handing a crate over tires the giver but costs no mood", async () => {
  const tx = fakeTx();
  const out = await chargeCrateHaul(tx, hauler(), { moved: 1, pickedUp: 0, turn: TURN });
  assert.deepEqual(out, { tired: true, mood: false });
  assert.equal(moodCalls.length, 0);
});

test("the step at a turn close is unchanged: Exhausted covers the next turn", async () => {
  const tx = fakeTx({ held: [{ slug: TIRED_SLUG, expiresTurn: 7 }] });
  const out = await applyFatigueStep(tx, "ada", 7);
  assert.equal(out.slug, EXHAUSTED_SLUG);
  assert.equal(row(tx, EXHAUSTED_SLUG).expiresTurn, 8);
});

test("exhaustedFrom leaves a Tired step's clock alone", async () => {
  const tx = fakeTx();
  await applyFatigueStep(tx, "ada", 7, { exhaustedFrom: 7 });
  assert.equal(row(tx, TIRED_SLUG).expiresTurn, 8);
});
