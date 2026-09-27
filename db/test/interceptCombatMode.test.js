// An AMBUSH needs combat mode (docs/systemdocs/COMBAT-MODE.md §3, Combat Overhaul.docx): setting one
// refuses without it, a Safe watch never asks, stopping one never does, and a standing Ambush whose
// owner is out of it goes dormant — kept, not fired. Fake databases, only the calls each path makes.
const test = require("node:test");
const assert = require("node:assert/strict");

const { setWatch, stopWatch } = require("../lib/verbs/watch");
const { fireWatches } = require("../lib/intercept");
const { NEEDS_COMBAT_MODE_INTERCEPT } = require("../lib/combatMode");

function watchDb(since) {
  const writes = [];
  return {
    writes,
    character: { findUnique: async () => ({ combatModeSinceTurn: since }) },
    interceptWatch: {
      upsert: async (args) => writes.push(["upsert", args]),
      deleteMany: async () => {
        writes.push(["delete"]);
        return { count: 1 };
      },
    },
    auditLog: { create: async (args) => writes.push(["audit", args]) },
    $transaction: async (fn) => fn({ interceptWatch: { upsert: async (a) => writes.push(["upsert", a]) }, auditLog: { create: async (a) => writes.push(["audit", a]) } }),
  };
}

const input = { mode: "AMBUSH", anyPerson: true, message: "Halt." };
const me = { id: "ada", locationId: "gate" };

test("a Safe watch needs no combat mode", async () => {
  const db = watchDb(null);
  const res = await setWatch(db, { character: me, discordUserId: "u", input: { ...input, mode: "SAFE" }, openTurn: null });
  assert.equal(res.ok, true);
});

test("setting an ambush out of combat mode is refused and writes nothing", async () => {
  const db = watchDb(null);
  const res = await setWatch(db, { character: me, discordUserId: "u", input, openTurn: null });
  assert.deepEqual(res, { ok: false, error: NEEDS_COMBAT_MODE_INTERCEPT });
  assert.deepEqual(db.writes, []);
});

test("in combat mode it is set as before", async () => {
  const db = watchDb(5);
  const res = await setWatch(db, { character: me, discordUserId: "u", input, openTurn: null });
  assert.equal(res.ok, true);
  assert.equal(db.writes[0][0], "upsert");
});

test("stopping a watch never asks about combat mode", async () => {
  const db = watchDb(null);
  const res = await stopWatch(db, { character: me, discordUserId: "u", openTurn: { id: "t" } });
  assert.equal(res.ok, true);
  assert.equal(res.stopped, true);
});

// fireWatches loads the watches here, drops the ones that can't fire, and only then looks at who
// arrived. So whether it went on to read an arrival is whether a watch survived the filter.
function fireDb(ownerSince, mode = "AMBUSH") {
  const calls = { arrivals: 0, deletes: 0 };
  return {
    calls,
    interceptWatch: {
      findMany: async () => [
        {
          id: "w1",
          characterId: "ada",
          locationId: "gate",
          mode,
          anyPerson: true,
          character: { id: "ada", tags: [], combatModeSinceTurn: ownerSince },
        },
      ],
      deleteMany: async () => {
        calls.deletes += 1;
        return { count: 0 };
      },
    },
    character: {
      findUnique: async () => {
        calls.arrivals += 1;
        return null;
      },
    },
  };
}

test("a Safe watch fires whether or not its owner is in combat mode", async () => {
  const db = fireDb(null, "SAFE");
  await fireWatches(db, { arrivals: [{ id: "bob" }], locationId: "gate", openTurn: { id: "t", number: 5 } });
  assert.equal(db.calls.arrivals, 1);
});

test("an ambush whose owner is out of combat mode is dormant: kept, and never fires", async () => {
  const db = fireDb(null);
  const out = await fireWatches(db, { arrivals: [{ id: "bob" }], locationId: "gate", openTurn: { id: "t", number: 5 } });
  assert.deepEqual(out, { dms: [], hits: [] });
  assert.equal(db.calls.arrivals, 0, "nothing left to fire, so no arrival is even looked at");
  assert.equal(db.calls.deletes, 0, "and the watch is not deleted");
});

test("the same watch wakes once its owner is alert again", async () => {
  const db = fireDb(5);
  await fireWatches(db, { arrivals: [{ id: "bob" }], locationId: "gate", openTurn: { id: "t", number: 5 } });
  assert.equal(db.calls.arrivals, 1);
});

// A sprung ambush keeps the targets it was set with until its fight is over: every later catch joins that
// fight, so a watch re-set to "Anyone" mid-fight would pull in people it was never set for (Bascinet,
// 2026-09-27). Stopping it is still allowed — that only narrows it.
const { AMBUSH_SPRUNG } = require("../lib/combatMode");

const OPEN_TURN = {
  id: "t1",
  number: 1,
  dayNumber: 1,
  startedAt: new Date(Date.now() - 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
  turnLengthHours: 24,
};

function sprungDb(fight) {
  const db = watchDb(5);
  db.gameConfig = { findUnique: async () => ({}) };
  db.gameState = { findUnique: async () => ({ phase: "RUNNING", sessionOpenedAt: null }) };
  db.turn = { findFirst: async () => OPEN_TURN };
  db.combat = {
    findFirst: async ({ where }) => {
      db.asked = where;
      return fight;
    },
  };
  return db;
}

test("an ambush can't be re-set while the fight it sprang is running", async () => {
  for (const mode of ["AMBUSH", "SAFE"]) {
    const db = sprungDb({ id: "c1" });
    const res = await setWatch(db, { character: me, discordUserId: "u", input: { ...input, mode }, openTurn: OPEN_TURN });
    assert.deepEqual(res, { ok: false, error: AMBUSH_SPRUNG });
    assert.deepEqual(db.writes, []);
    assert.deepEqual(db.asked, { turnId: "t1", fromAmbush: true, ambushOwnerId: "ada", endedAt: null });
  }
});

test("with no running ambush fight of theirs it is set as before", async () => {
  const db = sprungDb(null);
  const res = await setWatch(db, { character: me, discordUserId: "u", input, openTurn: OPEN_TURN });
  assert.equal(res.ok, true);
  assert.equal(db.writes[0][0], "upsert");
});

test("a sprung ambush can still be stopped", async () => {
  const db = sprungDb({ id: "c1" });
  const res = await stopWatch(db, { character: me, discordUserId: "u", openTurn: OPEN_TURN });
  assert.equal(res.ok, true);
});
