// A GM's staged "let in" (db/lib/roomGuests.js#letInAtPush), run by the turn
// push against its own transaction. Pinned here: the pass is written on the
// side the target is standing at, and anywhere else the row FAILS rather than
// moving them — the GM's choice when this was built. A public side or a key
// they already hold is a harmless no-op, not a failure.
const test = require("node:test");
const assert = require("node:assert/strict");

const { letInAtPush } = require("../lib/roomGuests");

const ROOM = {
  id: "room-1",
  name: "Counting Room",
  kind: "PRIVATE",
  accessTagSlugs: ["counting-key"],
  locationId: "hall",
  discordThreadId: null,
  sortOrder: 0,
  location: { name: "The Hall" },
  // A counter onto the Yard, open to anyone standing there.
  sides: [
    {
      id: "side-yard",
      locationId: "yard",
      kind: "PUBLIC",
      accessTagSlugs: [],
      sortOrder: 0,
      discordThreadId: null,
      starterMessageId: null,
      postHash: null,
      location: { id: "yard", name: "The Yard", discordChannelId: null, zoneId: "z" },
    },
  ],
};

const people = {
  here: { id: "here", status: "ALIVE", locationId: "hall" },
  away: { id: "away", status: "ALIVE", locationId: "street" },
  yard: { id: "yard", status: "ALIVE", locationId: "yard" },
  keyed: { id: "keyed", status: "ALIVE", locationId: "hall" },
  dead: { id: "dead", status: "DEAD", locationId: "hall" },
};

function fakeTx() {
  const upserts = [];
  const tx = {
    room: { findUnique: async ({ where }) => (where.id === ROOM.id ? ROOM : null) },
    character: { findUnique: async ({ where }) => people[where.id] ?? null },
    characterTag: {
      findMany: async ({ where }) =>
        where.characterId === "keyed" ? [{ equipped: false, tag: { slug: "counting-key" } }] : [],
    },
    // No open quest lists anybody here (roomAccess.js#allowedRoomIds).
    quest: { findMany: async () => [] },
    roomGuest: {
      upsert: async (args) => {
        upserts.push(args);
        return {};
      },
    },
  };
  return { tx, upserts };
}

test("somebody standing at the room is let in, on the side they stand at", async () => {
  const { tx, upserts } = fakeTx();
  const result = await letInAtPush(tx, { roomId: ROOM.id, characterId: "here" });
  assert.equal(result.error, undefined);
  assert.equal(result.already, undefined);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].create, { roomId: ROOM.id, characterId: "here", invitedById: null, locationId: "hall" });
});

test("somebody standing elsewhere fails the row, naming where they had to be", async () => {
  const { tx, upserts } = fakeTx();
  const result = await letInAtPush(tx, { roomId: ROOM.id, characterId: "away" });
  assert.equal(result.error, "They weren't standing at The Hall when the turn pushed.");
  assert.equal(upserts.length, 0);
});

test("an open side and a held key are no-ops, not failures", async () => {
  const yard = fakeTx();
  assert.equal((await letInAtPush(yard.tx, { roomId: ROOM.id, characterId: "yard" })).already, "open");
  assert.equal(yard.upserts.length, 0);

  const keyed = fakeTx();
  assert.equal((await letInAtPush(keyed.tx, { roomId: ROOM.id, characterId: "keyed" })).already, "key");
  assert.equal(keyed.upserts.length, 0);
});

test("the dead and a vanished room fail the row", async () => {
  const { tx, upserts } = fakeTx();
  assert.equal((await letInAtPush(tx, { roomId: ROOM.id, characterId: "dead" })).error, "They're no longer alive.");
  assert.equal((await letInAtPush(tx, { roomId: "gone", characterId: "here" })).error, "That room no longer exists.");
  assert.equal(upserts.length, 0);
});
