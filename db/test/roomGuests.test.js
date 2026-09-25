// The door of a private room (db/lib/roomGuests.js). One thing pinned here:
// that a PLAYER cannot let somebody in, or show them out, by naming them with
// a plain id while they stand here in a hood. The bot's /add names a character
// outright off their role, and the web's named row posts an id, so naming a
// suspect and watching the door open was a test of who was under the mask.
// Only a hood token may reach a hood, and a refused hood reads exactly like
// somebody who is not here at all.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { addRoomGuest, removeRoomGuest } = require("../lib/roomGuests");

const HERE = "loc-1";
const ROOM = {
  id: "room-1",
  name: "Back Room",
  kind: "PRIVATE",
  accessTagSlugs: ["back-room-key"],
  locationId: HERE,
  discordThreadId: null,
  location: { name: "The Pub" },
};
const helm = {
  tagId: "helm",
  equipped: true,
  tag: { forcedName: null, name: "Knight's Helmet", concealsIdentity: true, concealSprite: "helm", forcesConceal: false, equipLayer: 1 },
};
const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, age: 30, gender: "MAN", discordUserId: null, discordMirrored: false };
const actor = { ...base, id: "me", name: "Me", locationId: HERE, concealed: false, tags: [] };
const hooded = { ...base, id: "h1", name: "Sir Alder", locationId: HERE, concealed: true, tags: [helm] };
const open = { ...base, id: "p1", name: "Ann Vell", locationId: HERE, concealed: false, tags: [] };
const away = { ...base, id: "a1", name: "Far Away", locationId: "loc-2", concealed: false, tags: [] };
const people = [actor, hooded, open, away];

// Every query this path does not care about answers empty, so the sightings
// lookup finds no open turn and every sighting map comes back empty.
function fakePrisma() {
  const models = {
    room: { findUnique: async () => ROOM },
    character: {
      findFirst: async ({ where }) => people.find((p) => p.id === where.id && p.status === where.status) ?? null,
      findUnique: async ({ where }) => people.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }) => people.filter((p) => p.locationId === where.locationId),
    },
    // The actor holds the room's key, so they are inside.
    characterTag: { findMany: async () => [{ tag: { slug: "back-room-key" } }] },
    roomGuest: {
      findMany: async () => [],
      upsert: async () => ({}),
      deleteMany: async () => ({}),
    },
  };
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, groupBy: async () => [] };
  return new Proxy(models, { get: (target, key) => target[key] ?? empty });
}

test("a plain id cannot let a hood in, and reads like somebody absent", async () => {
  const prisma = fakePrisma();
  const hood = await addRoomGuest(prisma, { actor, roomId: ROOM.id, characterId: "h1" });
  const gone = await addRoomGuest(prisma, { actor, roomId: ROOM.id, characterId: "a1" });

  assert.equal(hood.ok, false);
  assert.equal(hood.error, "They aren't here to be let in.");
  assert.equal(gone.error, hood.error, "a hood refused by id must read exactly like somebody absent");
});

test("the absent sentence names nobody", async () => {
  const gone = await addRoomGuest(fakePrisma(), { actor, roomId: ROOM.id, characterId: "a1" });
  assert.ok(!gone.error.includes("Far Away"));
});

test("a hood reached by token, and anybody in the open, still gets through", async () => {
  const prisma = fakePrisma();
  const byToken = await addRoomGuest(prisma, { actor, roomId: ROOM.id, characterId: "h1", byToken: true });
  const named = await addRoomGuest(prisma, { actor, roomId: ROOM.id, characterId: "p1" });

  assert.equal(byToken.ok, true);
  assert.equal(named.ok, true);
});

test("showing a hood out by plain id is refused the same way", async () => {
  const out = await removeRoomGuest(fakePrisma(), { actor, roomId: ROOM.id, characterId: "h1" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "They aren't here to be let in.");
});

test("a GM works the door by id, hood or not", async () => {
  const gm = await addRoomGuest(fakePrisma(), { actor: null, roomId: ROOM.id, characterId: "h1", gm: true });
  assert.equal(gm.ok, true);
});
