// Intercept needs combat mode (docs/systemdocs/COMBAT-MODE.md §3): setting a watch refuses without
// it, stopping one never does, and a standing watch whose owner is out of it goes dormant — kept,
// not fired. Fake databases, only the calls each path makes.
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

test("setting a watch out of combat mode is refused and writes nothing", async () => {
  const db = watchDb(null);
  const res = await setWatch(db, { character: me, discordUserId: "u", input, openTurn: { id: "t" } });
  assert.deepEqual(res, { ok: false, error: NEEDS_COMBAT_MODE_INTERCEPT });
  assert.deepEqual(db.writes, []);
});

test("in combat mode it is set as before", async () => {
  const db = watchDb(5);
  const res = await setWatch(db, { character: me, discordUserId: "u", input, openTurn: { id: "t" } });
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
function fireDb(ownerSince) {
  const calls = { arrivals: 0, deletes: 0 };
  return {
    calls,
    interceptWatch: {
      findMany: async () => [
        {
          id: "w1",
          characterId: "ada",
          locationId: "gate",
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

test("a watch whose owner is out of combat mode is dormant: kept, and never fires", async () => {
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
