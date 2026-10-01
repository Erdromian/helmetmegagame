// db/lib/healGambitPass.js against a fake Prisma. A heal Gambit is filed
// SOLVED now (medical.js), so the status can't be what tells the pass a GM
// got there first. These pin the replacement: the pass still settles a
// Solved row with no Result, and leaves alone one a GM wrote on.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runHealGambitPass } = require("../lib/healGambitPass");

const turn = { id: "t1", number: 4 };

// No audit row on purpose: the pass's "record incomplete" branch is the
// shortest path to a write, which is all these need to see.
function fakePrisma(row) {
  const updates = [];
  const db = {
    action: {
      findMany: async ({ where }) => {
        assert.equal(where.moveReviewStatus, undefined, "the pass must not filter on status any more");
        return [{ id: row.id, characterId: "medic", character: { id: "medic", name: "Ada", discordUserId: "u1" } }];
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

test("a Solved heal Gambit with no Result is still settled by the pass", async () => {
  const { db, updates } = fakePrisma({ id: "a1", moveReviewStatus: "SOLVED", resultMessage: null, reviewedByDiscordUserId: null });
  await runHealGambitPass(db, turn);
  assert.equal(updates.length, 1);
  assert.match(updates[0].resultMessage, /Could not be resolved automatically/);
});

test("a heal Gambit a GM wrote a Result on is left alone", async () => {
  const { db, updates } = fakePrisma({ id: "a1", moveReviewStatus: "SOLVED", resultMessage: "Botched it.", reviewedByDiscordUserId: null });
  await runHealGambitPass(db, turn);
  assert.equal(updates.length, 0);
});

test("a heal Gambit a GM solved is left alone", async () => {
  const { db, updates } = fakePrisma({ id: "a1", moveReviewStatus: "SOLVED", resultMessage: null, reviewedByDiscordUserId: "gm1" });
  await runHealGambitPass(db, turn);
  assert.equal(updates.length, 0);
});

test("a reopened heal Gambit with no Result is still settled", async () => {
  const { db, updates } = fakePrisma({ id: "a1", moveReviewStatus: "OPEN", resultMessage: null, reviewedByDiscordUserId: null });
  await runHealGambitPass(db, turn);
  assert.equal(updates.length, 1);
});
