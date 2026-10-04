// The previous-game floor (db/lib/feedWipe.js#previousGameFloor). Its read walks every row of the
// current game, so it must run once at a time, and stop running once the game is old enough that
// no late row of the last game can still land. On 2026-10-04 eighty copies of it, fired together by
// one expired memo, stalled the live database at a turn end.
const test = require("node:test");
const assert = require("node:assert/strict");

const { feedWipeFloors, forgetGameFloor } = require("../lib/feedWipe");

const MINUTE = 60 * 1000;

// A fake with one current game. `floorReads` counts the MAX(seq) reads; `gate` holds them open so
// several callers can pile up behind one.
function fakePrisma({ gameId = "g2", createdAt = new Date(Date.now() - 60 * MINUTE), seq = 145311n } = {}) {
  const state = { gameId, createdAt, seq, floorReads: 0, fail: false, gate: null };
  const prisma = {
    state,
    gameState: {
      findUnique: async () => ({ gameId: state.gameId, game: { createdAt: state.createdAt } }),
    },
    gameConfig: {
      findUnique: async () => ({ messageWipeEnabled: false, feedWipeSeq: 0n, feedWipeSummarySeq: 0n }),
    },
    $queryRaw: async () => {
      state.floorReads += 1;
      if (state.gate) await state.gate;
      if (state.fail) throw new Error("connection pool timed out");
      return [{ seq: state.seq }];
    },
  };
  return prisma;
}

function withClock(t) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  return { advance: (ms) => { now += ms; } };
}

test.beforeEach(() => forgetGameFloor());

test("callers that arrive together share one read", async () => {
  const prisma = fakePrisma();
  let open;
  prisma.state.gate = new Promise((resolve) => { open = resolve; });

  const calls = Array.from({ length: 20 }, () => feedWipeFloors(prisma));
  await new Promise((resolve) => setImmediate(resolve));
  open();
  const results = await Promise.all(calls);

  assert.equal(prisma.state.floorReads, 1);
  for (const floors of results) assert.equal(floors.persist, 145311n);
});

test("a settled game never reads its floor again", async (t) => {
  const clock = withClock(t);
  const prisma = fakePrisma({ createdAt: new Date(Date.now() - 60 * MINUTE) });

  await feedWipeFloors(prisma);
  clock.advance(10 * MINUTE);
  await feedWipeFloors(prisma);
  clock.advance(10 * MINUTE);
  const floors = await feedWipeFloors(prisma);

  assert.equal(prisma.state.floorReads, 1);
  assert.equal(floors.turn, 145311n);
});

test("a game younger than the settle window reads again after half a minute", async (t) => {
  const clock = withClock(t);
  const prisma = fakePrisma({ createdAt: new Date(Date.now() - 10 * 1000) });

  await feedWipeFloors(prisma);
  clock.advance(10 * 1000);
  await feedWipeFloors(prisma);
  assert.equal(prisma.state.floorReads, 1, "inside the TTL the memo answers");

  // A late row of the last game landed while the memo was young.
  prisma.state.seq = 145320n;
  clock.advance(31 * 1000);
  const floors = await feedWipeFloors(prisma);
  assert.equal(prisma.state.floorReads, 2);
  assert.equal(floors.persist, 145320n);
});

test("a new game reads its own floor, and forgetGameFloor drops a settled one", async () => {
  const prisma = fakePrisma();
  await feedWipeFloors(prisma);

  prisma.state.gameId = "g3";
  prisma.state.seq = 226571n;
  assert.equal((await feedWipeFloors(prisma)).persist, 226571n);
  assert.equal(prisma.state.floorReads, 2);

  forgetGameFloor();
  await feedWipeFloors(prisma);
  assert.equal(prisma.state.floorReads, 3);
});

test("a failed read is not remembered, and the next caller tries again", async (t) => {
  t.mock.method(console, "error", () => {});
  const prisma = fakePrisma();
  prisma.state.fail = true;

  const floors = await feedWipeFloors(prisma);
  assert.deepEqual(floors, { turn: 0n, summary: 0n, persist: 0n }, "the safe answer hides nothing");

  prisma.state.fail = false;
  assert.equal((await feedWipeFloors(prisma)).persist, 145311n);
  assert.equal(prisma.state.floorReads, 2);
});
