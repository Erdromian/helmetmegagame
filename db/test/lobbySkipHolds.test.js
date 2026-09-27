// node --test over what a GM's Skip to character creation may hold before
// Start Game (LOBBY.md §2): nothing. A pick in the wizard before the game
// starts writes no hold and counts as none, so one skipper's pick never shows
// as taken to the next, and the roll never loses a seat to it. A character
// actually created is still a seat.
// Run with `npm test --workspace=db`.
//
// Prisma is faked with just the queries these paths make, as in
// lobbyRaces.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const { seatsAllocated, buildDraft } = require("../lib/lobby");
const { heldSeats, heldSeatsByFate } = require("../lib/seatCount");

const SHERIFF = { id: "r1", slug: "sheriff", name: "Sheriff", isUnique: true, unlimited: false, weight: null, requiresWhitelist: false };

// A wizard hold on the Sheriff by a GM who skipped ahead, and optionally a
// character somebody actually built in it.
function makeDb({ holds = 1, seated = 0, ready = [], priorities = {} } = {}) {
  const count = (n) => (n ? [{ roleId: SHERIFF.id, _count: n }] : []);
  return {
    character: {
      count: async () => seated,
      groupBy: async ({ where }) => (where.status === "ALIVE" ? count(seated) : []),
    },
    roleReservation: {
      count: async () => holds,
      groupBy: async () => count(holds),
    },
    lobbyEntry: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async () => ready.map((discordUserId) => ({ discordUserId })),
    },
    playerPreference: {
      findMany: async () => ready.map((discordUserId) => ({ discordUserId, rolePriorities: priorities, joblessRole: "MIGRANT" })),
    },
    role: { findMany: async () => [{ ...SHERIFF }] },
    gameConfig: { upsert: async () => ({ id: 1 }) },
  };
}

test("seats are allocated only once the game has started", () => {
  assert.equal(seatsAllocated("CLOSED"), false);
  assert.equal(seatsAllocated("LOBBY"), false);
  assert.equal(seatsAllocated("RUNNING"), true);
  assert.equal(seatsAllocated("ENDED"), true);
});

test("a wizard hold counts as a seat by default", async () => {
  const db = makeDb();
  assert.equal(await heldSeats(db, SHERIFF), 1);
  assert.equal((await heldSeatsByFate(db, [SHERIFF])).get(SHERIFF.id), 1);
});

test("before Start, a wizard hold is not a seat", async () => {
  const db = makeDb();
  assert.equal(await heldSeats(db, SHERIFF, { countReservations: false }), 0);
  assert.equal((await heldSeatsByFate(db, [SHERIFF], { countReservations: false })).get(SHERIFF.id), undefined);
});

test("before Start, a built character still is a seat", async () => {
  const db = makeDb({ seated: 1 });
  assert.equal(await heldSeats(db, SHERIFF, { countReservations: false }), 1);
  assert.equal((await heldSeatsByFate(db, [SHERIFF], { countReservations: false })).get(SHERIFF.id), 1);
});

test("the roll gives out a seat a skipper only picked", async () => {
  const db = makeDb({ ready: ["u1"], priorities: { sheriff: "HIGH" } });
  const draft = await buildDraft(db, new Map(), { seed: "fixed" });
  assert.equal(draft.rows.find((r) => r.discordUserId === "u1").roleSlug, "sheriff");
});

test("the roll does not give out a seat a skipper built a character in", async () => {
  const db = makeDb({ seated: 1, ready: ["u1"], priorities: { sheriff: "HIGH" } });
  const draft = await buildDraft(db, new Map(), { seed: "fixed" });
  assert.notEqual(draft.rows.find((r) => r.discordUserId === "u1").roleSlug, "sheriff");
});
