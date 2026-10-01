// The Gambits the game settles itself (db/lib/autoGambits.js) against fake
// Prismas. They file SOLVED, and nothing a GM does on the desk short of
// Reject may stop the roll: these pin that the heal, confession and Trinket
// passes settle a row whatever its review status, Result or reviewer, and
// skip only a row that is gone or that an earlier run already settled.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isSelfResolving, isSettled, withSettled } = require("../lib/autoGambits");
const { runHealGambitPass } = require("../lib/healGambitPass");
const { runConfessionPass } = require("../lib/confessionPass");
const { runTrinketPass } = require("../lib/trinketPass");

const turn = { id: "t1", number: 4 };

// What a GM can leave on a row from the desk: nothing, a Result (Save), a
// reviewer (Solve after a Reopen), or a Reopen back to OPEN.
const DESK_STATES = {
  "untouched": { moveReviewStatus: "SOLVED", resultMessage: null, reviewedByDiscordUserId: null },
  "a GM wrote a Result on": { moveReviewStatus: "SOLVED", resultMessage: "Botched it.", reviewedByDiscordUserId: null },
  "a GM solved": { moveReviewStatus: "SOLVED", resultMessage: null, reviewedByDiscordUserId: "gm1" },
  "a GM reopened": { moveReviewStatus: "OPEN", resultMessage: null, reviewedByDiscordUserId: null },
};

test("the markers: which rows settle themselves, and the settled stamp", () => {
  for (const marker of ["auto:lesson", "auto:heal_gambit", "auto:confession", "auto:trinket", "auto:break_arelitz"]) {
    assert.equal(isSelfResolving(`auto:craft\n${marker}`), true, marker);
  }
  assert.equal(isSelfResolving("auto:bloodcrazed"), false, "a vampire's compulsion is a GM's to rule");
  assert.equal(isSelfResolving(null), false);
  assert.equal(isSettled("auto:trinket"), false);
  assert.equal(withSettled("auto:trinket"), "auto:trinket\nauto:settled");
  assert.equal(isSettled(withSettled(null)), true);
});

// --- heal ------------------------------------------------------------------

// No audit row on purpose: the pass's "record incomplete" branch is the
// shortest path to a write, which is all these need to see.
function fakeHealPrisma(row) {
  const updates = [];
  const db = {
    action: {
      findMany: async ({ where }) => {
        assert.equal(where.moveReviewStatus, undefined, "the pass must not filter on status");
        return row ? [{ id: row.id, characterId: "medic", character: { id: "medic", name: "Ada", discordUserId: "u1" } }] : [];
      },
      findUnique: async () => row,
      update: async ({ data }) => {
        updates.push(data);
        return { ...row, ...data };
      },
    },
    auditLog: { findFirst: async () => null },
  };
  db.$transaction = (fn) => fn(db);
  return { db, updates };
}

for (const [state, fields] of Object.entries(DESK_STATES)) {
  test(`a heal Gambit ${state} is still settled by the pass`, async () => {
    const { db, updates } = fakeHealPrisma({ id: "a1", gmNotes: "auto:heal_gambit", ...fields });
    await runHealGambitPass(db, turn);
    assert.equal(updates.length, 1);
    assert.match(updates[0].resultMessage, /Could not be resolved automatically/);
    assert.equal(isSettled(updates[0].gmNotes), true);
  });
}

test("a heal Gambit an earlier run settled is not settled twice", async () => {
  const { db, updates } = fakeHealPrisma({ id: "a1", gmNotes: "auto:heal_gambit\nauto:settled", ...DESK_STATES.untouched });
  await runHealGambitPass(db, turn);
  assert.equal(updates.length, 0);
});

// --- confession ------------------------------------------------------------

// A roll of 1 against the threshold of 5: the burden stays, which keeps the
// tag and mood writers out of the fake.
function fakeConfessionPrisma(action) {
  const actionUpdates = [];
  const offerUpdates = [];
  const db = {
    offer: {
      findMany: async () => [
        { id: "o1", initiatorId: "pen", responderId: "chap", learnerId: "pen", teacherId: "chap", tagId: "g1", threshold: 5, learnerActionId: "a1", tag: { name: "Guilt" } },
      ],
      update: async ({ data }) => offerUpdates.push(data),
    },
    character: {
      findMany: async () => [
        { id: "pen", name: "Pen", discordUserId: "u1", status: "ALIVE" },
        { id: "chap", name: "Chap", discordUserId: "u2", status: "ALIVE" },
      ],
    },
    action: {
      findUnique: async () => action,
      update: async ({ data }) => actionUpdates.push(data),
    },
  };
  db.$transaction = (fn) => fn(db);
  return { db, actionUpdates, offerUpdates };
}

for (const [state, fields] of Object.entries(DESK_STATES)) {
  test(`a confession ${state} still rolls its die`, async () => {
    const { db, actionUpdates, offerUpdates } = fakeConfessionPrisma({ id: "a1", diceRoll: 1, diceModifier: 0, ...fields });
    const out = await runConfessionPass(db, turn);
    assert.equal(out.resolved, 1);
    assert.match(actionUpdates[0].resultMessage, /Guilt stayed \(1 vs 5\)/);
    assert.equal(offerUpdates[0].status, "RESOLVED");
    assert.equal(offerUpdates[0].outcome.gmDecided, undefined);
    assert.equal(out.dms.length, 2, "the penitent and the chaplain are both told");
  });
}

test("a confession whose Move a GM rejected is cancelled, not rolled", async () => {
  const { db, actionUpdates, offerUpdates } = fakeConfessionPrisma(null);
  const out = await runConfessionPass(db, turn);
  assert.equal(out.resolved, 0);
  assert.equal(actionUpdates.length, 0);
  assert.equal(offerUpdates[0].status, "CANCELLED");
});

// --- Trinket ---------------------------------------------------------------

// The mint itself is out of reach of a fake, so these stop at the character
// lookup: reaching it means the row got past the guard and would be minted.
function fakeTrinketPrisma(row) {
  const reached = [];
  const db = {
    action: {
      findMany: async ({ where }) => {
        assert.equal(where.moveReviewStatus, undefined, "the pass must not filter on status");
        return row ? [{ id: row.id, characterId: "smith", diceRoll: 4 }] : [];
      },
      findUnique: async () => row,
    },
    tag: { findUnique: async () => ({ id: "trinket", slug: "trinket" }) },
    character: {
      findUnique: async () => {
        reached.push(row.id);
        return null;
      },
    },
  };
  db.$transaction = (fn) => fn(db);
  return { db, reached };
}

for (const [state, fields] of Object.entries(DESK_STATES)) {
  test(`a Trinket ${state} still goes to the forge`, async () => {
    const { db, reached } = fakeTrinketPrisma({ id: "a1", gmNotes: "auto:trinket", ...fields });
    await runTrinketPass(db, turn);
    assert.deepEqual(reached, ["a1"]);
  });
}

test("a Trinket an earlier run minted is not minted twice", async () => {
  const { db, reached } = fakeTrinketPrisma({ id: "a1", gmNotes: "auto:trinket\nauto:settled", ...DESK_STATES.untouched });
  await runTrinketPass(db, turn);
  assert.deepEqual(reached, []);
});
