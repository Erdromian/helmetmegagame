// node --test over db/lib/ascensionReveal.js — the pass that puts the Rite of Ascension into the
// Grimoire once the cult has finished its objectives (docs/systemdocs/THANATI.md §5a). Run with
// `npm test --workspace=db`. Prisma is faked; the assertions that matter are about what it is asked
// to WRITE, because the write is what the document reads back.
//
// Two of these guard a way to hand the cult the end of the world by accident:
//   - no objectives at all must not read as "all done" (`[].every()` is true);
//   - a second close, or a resumed advance, must not DM anybody twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runAscensionRevealPass, ASCENSION_REVEAL_DM } = require("../lib/ascensionReveal");

const TURN = { id: "t1", number: 12 };

// Objectives are handed over already pinned, which is what a GM's "Success" is. A pinned row is
// answered by db/lib/objectives.js without any further query, so the fake below stays small.
const objective = (id, pinned) => ({
  id,
  partyKey: "thanati",
  kind: "custom",
  text: `objective ${id}`,
  pinned,
  targetCharacterId: null,
  createdAt: new Date(),
});

function fakePrisma({ revealedTurn = null, objectives = [], cult = [], claimWins = true } = {}) {
  const calls = { updates: [], objectiveWheres: [] };
  return {
    calls,
    gameState: {
      findUnique: async () => ({ ascensionRevealedTurn: revealedTurn }),
      updateMany: async (args) => {
        calls.updates.push(args);
        return { count: claimWins ? 1 : 0 };
      },
    },
    objective: {
      findMany: async (args) => {
        calls.objectiveWheres.push(args?.where ?? null);
        return objectives;
      },
    },
    character: { findMany: async () => cult },
  };
}

const CULT = [
  { id: "c1", name: "Ash", discordUserId: "111" },
  { id: "c2", name: "Wren", discordUserId: "222" },
];

test("all objectives done: stamps the turn and DMs every living cultist", async () => {
  const prisma = fakePrisma({ objectives: [objective("o1", true), objective("o2", true)], cult: CULT });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, true);
  assert.equal(out.objectives, 2);
  assert.deepEqual(out.dms, [
    { discordUserId: "111", content: ASCENSION_REVEAL_DM },
    { discordUserId: "222", content: ASCENSION_REVEAL_DM },
  ]);

  // The stamp is the thing the Grimoire reads, and it is claimed on the null so two closes cannot
  // both take it.
  assert.equal(prisma.calls.updates.length, 1);
  assert.deepEqual(prisma.calls.updates[0].where, { id: 1, ascensionRevealedTurn: null });
  assert.deepEqual(prisma.calls.updates[0].data, { ascensionRevealedTurn: 12 });
  // Only the cult's own objectives are ever counted — the Tribunal finishing its work must not
  // open the cult's page.
  assert.deepEqual(prisma.calls.objectiveWheres[0], { partyKey: "thanati" });
});

test("NO OBJECTIVES IS NOT ALL DONE: a cult whose GM has set nothing is told nothing", async () => {
  // [].every(...) is true, so the empty case has to be refused on purpose. Bascinet's doc: none of
  // this happens until the objectives have been selected by GMs and properly completed.
  const prisma = fakePrisma({ objectives: [], cult: CULT });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, false);
  assert.deepEqual(out.dms, []);
  assert.equal(prisma.calls.updates.length, 0, "it stamped the reveal with no objectives set");
});

test("one objective outstanding: nothing is revealed and nothing is written", async () => {
  const prisma = fakePrisma({
    objectives: [objective("o1", true), objective("o2", false), objective("o3", true)],
    cult: CULT,
  });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, false);
  assert.deepEqual(out.dms, []);
  assert.equal(prisma.calls.updates.length, 0);
});

test("already revealed: a later close says nothing and writes nothing", async () => {
  const prisma = fakePrisma({
    revealedTurn: 9,
    objectives: [objective("o1", true)],
    cult: CULT,
  });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, false);
  assert.deepEqual(out.dms, []);
  assert.equal(prisma.calls.updates.length, 0, "it re-stamped an already-revealed game");
});

test("losing the guarded claim sends no DMs", async () => {
  // A resumed advance racing the original: both read null, both pass the objective check, and the
  // updateMany decides. The loser must go quiet rather than DM the cult a second time.
  const prisma = fakePrisma({ objectives: [objective("o1", true)], cult: CULT, claimWins: false });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, false);
  assert.deepEqual(out.dms, []);
  assert.equal(prisma.calls.updates.length, 1, "it should still have tried to claim");
});

test("a cultist with no Discord account is counted but not DMed", async () => {
  const prisma = fakePrisma({
    objectives: [objective("o1", true)],
    cult: [...CULT, { id: "c3", name: "Lark", discordUserId: null }],
  });
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, true);
  assert.equal(out.told, 2);
  assert.equal(out.dms.length, 2);
  assert.ok(out.dms.every((d) => d.discordUserId));
});

test("no game state at all reads as idle rather than throwing", async () => {
  // A database with no GameState row — the pass must hand the ledger an object, since null means
  // "retry forever" and would wedge every turn from here on.
  const prisma = fakePrisma();
  prisma.gameState.findUnique = async () => null;
  const out = await runAscensionRevealPass(prisma, TURN);

  assert.equal(out.revealed, false);
  assert.equal(out.turnNumber, 12);
  assert.deepEqual(out.dms, []);
});
