const test = require("node:test");
const assert = require("node:assert/strict");

// syncLocationAccess (db/lib/locationMove.js) writes a move's Location
// overwrites from where the character stands NOW, not from the move that asked.
// Every Discord call is swapped for a recorder before locationMove is required,
// since it takes its REST helpers by destructuring at load. No database either:
// a stand-in prisma answers the three reads the sync makes.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";

const rest = require("../lib/discordRest");
const calls = [];
let delayMs = 0;
const record = (kind) => async (...args) => {
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  calls.push([kind, ...args]);
};
rest.putChannelOverwrite = record("put");
rest.deleteChannelOverwrite = record("delete");
rest.addMemberRole = record("addRole");
rest.removeMemberRole = record("removeRole");

const { syncArrivalAccess, syncLocationAccess } = require("../lib/locationMove");
const { LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY } = require("../lib/zoneChannelSpec");

const HERE = String(LOCATION_MEMBER_ALLOW);
const WATCH = String(LOCATION_VANTAGE_ALLOW);
const MUTE = String(LOCATION_VANTAGE_DENY);

const places = {
  A: { id: "A", discordChannelId: "chanA", zoneId: "town", zone: { discordRoleId: "roleTown" } },
  B: { id: "B", discordChannelId: "chanB", zoneId: "town", zone: { discordRoleId: "roleTown" } },
  C: { id: "C", discordChannelId: "chanC", zoneId: "town", zone: { discordRoleId: "roleTown" } },
  F: { id: "F", discordChannelId: "chanF", zoneId: "fort", zone: { discordRoleId: "roleFort" } },
};

// `standing` is read once per findUnique, so a list plays out a character who
// moves on while the sync is writing. `watching` is the location ids of their
// live vantages.
function fakePrisma({ standing, watching = [], status = "ALIVE", discordMirrored = true }) {
  const where = Array.isArray(standing) ? [...standing] : [standing];
  let last = where[0];
  const next = () => (last = where.length > 1 ? where.shift() : where[0] ?? last);
  return {
    character: {
      findUnique: async ({ select }) => {
        const locationId = next();
        if (!select.discordUserId) return { locationId };
        return {
          id: "c1",
          discordUserId: "u1",
          locationId,
          status,
          discordMirrored,
          location: { discordChannelId: places[locationId].discordChannelId, zone: places[locationId].zone },
        };
      },
    },
    turn: { findFirst: async () => ({ id: "t1" }) },
    vantage: {
      findMany: async () => watching.map((id) => ({ characterId: "c1", locationId: id, location: places[id] })),
    },
    gameConfig: { findUnique: async () => null },
  };
}

const facts = (from, to, extra = {}) => ({
  characterId: "c1",
  fromLocation: from ? places[from] : null,
  toLocation: places[to],
  droppedVantages: [],
  ...extra,
});

test.beforeEach(() => {
  calls.length = 0;
  delayMs = 0;
});

test("a walk opens where they stand as Here and the street behind as watched", async () => {
  await syncArrivalAccess(fakePrisma({ standing: "B", watching: ["A"] }), [facts("A", "B")]);
  assert.deepEqual(calls, [
    ["put", "chanB", "u1", { allow: HERE, deny: "0", type: 1 }],
    ["put", "chanA", "u1", { allow: WATCH, deny: MUTE, type: 1 }],
  ]);
});

test("a late A -> B, after they walked straight back to A, leaves A as Here, not mute", async () => {
  // The bug: the first move's Discord half ran after the second's and set A to
  // the watcher's mask while they stood in it.
  await syncArrivalAccess(fakePrisma({ standing: "A", watching: ["B"] }), [facts("A", "B")]);
  assert.deepEqual(calls, [
    ["put", "chanA", "u1", { allow: HERE, deny: "0", type: 1 }],
    ["put", "chanB", "u1", { allow: WATCH, deny: MUTE, type: 1 }],
  ]);
});

test("a walk of several hops opens the end first, then settles the streets it passed", async () => {
  const hops = [facts("A", "B"), facts("B", "C", { droppedVantages: [{ location: places.A }] })];
  await syncArrivalAccess(fakePrisma({ standing: "C", watching: ["B"] }), hops);
  assert.deepEqual(calls[0], ["put", "chanC", "u1", { allow: HERE, deny: "0", type: 1 }]);
  assert.deepEqual(
    calls.slice(1).sort(),
    [
      ["delete", "chanA", "u1"],
      ["put", "chanB", "u1", { allow: WATCH, deny: MUTE, type: 1 }],
    ].sort(),
  );
});

test("moving again mid-write goes round again with the new place", async () => {
  // Read B for the first pass, then C on the re-check and every read after it.
  await syncArrivalAccess(fakePrisma({ standing: ["B", "C"], watching: [] }), [facts("A", "B")]);
  const last = calls.filter(([, channel]) => channel === "chanC" || channel === "chanB").slice(-2);
  assert.deepEqual(last, [
    ["put", "chanC", "u1", { allow: HERE, deny: "0", type: 1 }],
    ["delete", "chanB", "u1"],
  ]);
});

test("a zone crossing grants the zone they are in and takes the other one off", async () => {
  await syncArrivalAccess(fakePrisma({ standing: "F", watching: [] }), [facts("C", "F")]);
  assert.ok(calls.some((c) => c[0] === "addRole" && c[2] === "roleFort"));
  assert.ok(calls.some((c) => c[0] === "removeRole" && c[2] === "roleTown"));
  assert.ok(!calls.some((c) => c[0] === "removeRole" && c[2] === "roleFort"));
});

test("a step inside one zone touches no role", async () => {
  await syncArrivalAccess(fakePrisma({ standing: "B", watching: [] }), [facts("A", "B")]);
  assert.ok(!calls.some((c) => c[0] === "addRole" || c[0] === "removeRole"));
});

test("not mirrored gets nothing written at all", async () => {
  await syncArrivalAccess(fakePrisma({ standing: "B", discordMirrored: false }), [facts("A", "B")]);
  assert.deepEqual(calls, []);
});

test("somebody killed on arrival gets nothing opened, and what the move touched is closed", async () => {
  await syncArrivalAccess(fakePrisma({ standing: "B", status: "DEAD" }), [facts("A", "B")]);
  assert.deepEqual(calls.sort(), [["delete", "chanA", "u1"], ["delete", "chanB", "u1"]]);
});

test("two syncs for one character never interleave their writes", async () => {
  delayMs = 5;
  const prisma = fakePrisma({ standing: "B", watching: ["A"] });
  await Promise.all([
    syncLocationAccess(prisma, "c1", { channelIds: ["chanA", "chanB"] }),
    syncLocationAccess(prisma, "c1", { channelIds: ["chanB", "chanC"] }),
  ]);
  const channels = calls.map((c) => c[1]);
  assert.deepEqual(channels, ["chanB", "chanA", "chanB", "chanC"]);
});
