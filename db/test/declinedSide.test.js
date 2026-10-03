// Declining an invitation bars ONE thing: joining that same fight's attackers (docs/systemdocs/ATTACK.md §4,
// Bascinet 2026-09-27). Its defenders stay open — the declined row becomes their place on that side, since a
// person has one row per fight — and so do new attacks and other fights. Fake databases, only the calls each
// path makes; the row locks and unique claims are exercised against a real Postgres elsewhere.
const test = require("node:test");
const assert = require("node:assert/strict");

const { combatBlock } = require("../lib/combatGate");
const { intervene } = require("../lib/combat");
const { DECLINED_ATTACKERS } = require("../lib/combatMode");

const TURN = {
  id: "t1",
  number: 1,
  dayNumber: 1,
  startedAt: new Date(Date.now() - 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
  turnLengthHours: 24,
};

const ADA = {
  id: "ada",
  status: "ALIVE",
  locationId: "gate",
  combatModeSinceTurn: 1,
  heldReason: null,
  heldUntil: null,
  discordUserId: null,
  tags: [],
};

// Ada turned down an invitation to fight c1, here, this turn.
function fakeDb() {
  const writes = [];
  return {
    writes,
    gameConfig: { findUnique: async () => ({}) },
    gameState: { findUnique: async () => ({ phase: "RUNNING", sessionOpenedAt: null }) },
    turn: { findFirst: async () => TURN },
    character: {
      findUnique: async () => ADA,
      updateMany: async () => ({ count: 1 }),
    },
    location: { findUnique: async () => null },
    combat: {
      findUnique: async () => ({ id: "c1", turnId: "t1", locationId: "gate", endedAt: null, distances: { ada: [0, "gate"] } }),
    },
    combatParticipant: {
      findFirst: async ({ where }) => {
        if (where.status === "DECLINED") return { id: "p1" }; // a location-wide decline query, if anything still asks one
        if (where.combatId && where.characterId) return { id: "p1", status: "DECLINED", side: "DEFENDER", alert: true };
        return null; // not in any fight right now
      },
      findMany: async () => [],
      createMany: async (args) => {
        writes.push(["create", args]);
        return { count: 1 };
      },
      updateMany: async (args) => {
        writes.push(["update", args]);
        return { count: 1 };
      },
    },
  };
}

test("a decline gates nothing on its own: new attacks and other fights stay open", async () => {
  const db = fakeDb();
  assert.equal(await combatBlock(db, { character: ADA, turn: TURN }), null);
});

test("they can't join the attackers of the fight they turned down, and nothing is written", async () => {
  const db = fakeDb();
  const out = await intervene(db, { character: ADA, combatId: "c1", side: "ATTACKER", turn: TURN });
  assert.deepEqual(out, { ok: false, error: DECLINED_ATTACKERS, dms: [], speak: [] });
  assert.deepEqual(db.writes, []);
});

test("they can join its defenders: the declined row becomes their place on that side", async () => {
  const db = fakeDb();
  const out = await intervene(db, { character: ADA, combatId: "c1", side: "DEFENDER", turn: TURN });
  assert.equal(out.ok, true, out.error);
  const updates = db.writes.filter(([op]) => op === "update");
  const creates = db.writes.filter(([op]) => op === "create");
  assert.equal(creates.length, 0, "no second row in the same fight");
  const row = updates.find(([, args]) => args.where.id === "p1");
  assert.ok(row, "the declined row is the one rewritten");
  // Claimed only while they hold no place in a fight: the row is theirs again only if it is still out of it.
  assert.deepEqual(row[1].where, { id: "p1", activeTurnId: null });
  assert.equal(row[1].data.side, "DEFENDER");
  assert.equal(row[1].data.role, "INTERVENER");
  assert.equal(row[1].data.status, "JOINED");
  assert.equal(row[1].data.activeTurnId, "t1");
});
