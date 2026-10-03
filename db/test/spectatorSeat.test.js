// node --test over the SPECTATOR seat — db/lib/feedAccess.js#spectatorPlacesFor on the web, and
// db/lib/spectatorAccess.js's bits on Discord. Run with `npm test --workspace=db`.
// A fake prisma that answers the handful of reads the watcher lists make; no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { placesFor, mayReadPlace, mayWritePlace } = require("../lib/feedAccess");
const { spectatorsVisible, spectatorOverwrite, spectatorDrift } = require("../lib/spectatorAccess");
const { SPECTATOR_ROLE_ID } = require("../lib/roleIds");
const {
  placeKeyForRoom,
  placeKeyForConversation,
  placeKeyForParty,
  DEADCHAT_PLACE_KEY,
  GAME_PLACE_KEY,
} = require("../lib/placeKey");

// One zone, one street, a public and a private room, one conversation, one party. The rooms
// arrive pre-filtered the way Postgres would filter them, so the fake has to honour the one
// `kind` filter that separates a ghost's list from a spectator's.
function fakePrisma() {
  const rooms = [
    { id: "r-pub", name: "Bar", description: "", kind: "PUBLIC", sortOrder: 0 },
    { id: "r-priv", name: "Back Room", description: "", kind: "PRIVATE", sortOrder: 1 },
  ];
  return {
    zone: {
      findMany: async ({ select }) => {
        const loc = select.locations.select;
        const roomWhere = loc.rooms.where ?? {};
        return [
          {
            id: "z1",
            name: "Town",
            description: "",
            discordSummaryChannelId: "sum-1",
            locations: [
              {
                id: "l1",
                name: "The Square",
                description: "",
                attributes: {},
                rooms: rooms.filter((r) => !roomWhere.kind || r.kind === roomWhere.kind),
                roomSides: [],
                playerThreads: loc.playerThreads ? [{ id: "c1", name: "A quiet word" }] : undefined,
              },
            ],
          },
        ];
      },
    },
    partyThread: { findMany: async () => [{ id: "p1", name: "Ada's Party" }] },
    gmZoneView: { findMany: async () => [] },
  };
}

const keysOf = (list) => list.map((entry) => entry.placeKey);

test("a spectator reads private rooms, conversations, parties and Deadchat — and speaks in none", async () => {
  const prisma = fakePrisma();
  const list = await placesFor(prisma, null, { spectator: true });
  const keys = keysOf(list);
  for (const key of [
    placeKeyForRoom("r-pub"),
    placeKeyForRoom("r-priv"),
    placeKeyForConversation("c1"),
    placeKeyForParty("p1"),
    DEADCHAT_PLACE_KEY,
    GAME_PLACE_KEY,
  ]) {
    assert.ok(keys.includes(key), `missing ${key}`);
  }
  assert.ok(list.every((entry) => entry.canSpeak === false), "every place is read-only");
  assert.equal(await mayReadPlace(prisma, null, placeKeyForConversation("c1"), { spectator: true }), true);
  assert.equal(await mayWritePlace(prisma, null, placeKeyForConversation("c1"), { spectator: true }), false);
  assert.equal(await mayWritePlace(prisma, null, DEADCHAT_PLACE_KEY, { spectator: true }), false);
  assert.equal(await mayWritePlace(prisma, null, placeKeyForParty("p1"), { spectator: true }), false);
});

test("the other watchers are unchanged: a ghost gets no private room, and no seat gets the parties", async () => {
  const prisma = fakePrisma();
  const ghost = keysOf(await placesFor(prisma, null, { ghost: true, discordUserId: "u1" }));
  assert.ok(!ghost.includes(placeKeyForRoom("r-priv")));
  assert.ok(!ghost.includes(placeKeyForConversation("c1")));
  assert.ok(!ghost.includes(placeKeyForParty("p1")));

  const gm = keysOf(await placesFor(prisma, null, { gm: true, discordUserId: "u1" }));
  assert.ok(gm.includes(placeKeyForConversation("c1")));
  assert.ok(!gm.includes(placeKeyForParty("p1")));

  // And a spectator flag never outranks a GM's seat.
  const both = keysOf(await placesFor(prisma, null, { gm: true, spectator: true, discordUserId: "u1" }));
  assert.deepEqual(both, gm);
});

test("somebody with no seat at all still gets the Game channel and nothing else", async () => {
  const list = await placesFor(fakePrisma(), null, {});
  assert.deepEqual(keysOf(list), [GAME_PLACE_KEY]);
});

test("on Discord the seat READS: View and Read Message History while the game is on", () => {
  const [on] = spectatorOverwrite({ visible: true });
  assert.equal(on.id, SPECTATOR_ROLE_ID);
  const allow = BigInt(on.allow);
  assert.equal(allow & 1024n, 1024n, "View Channel");
  assert.equal(allow & 65536n, 65536n, "Read Message History");
  // Still a seat that says nothing: Send, Send in Threads, reactions all denied.
  const deny = BigInt(on.deny);
  for (const bit of [2048n, 274877906944n, 64n]) assert.equal(deny & bit, bit);

  const [off] = spectatorOverwrite({ visible: false });
  assert.equal(BigInt(off.allow), 0n);
  assert.equal(BigInt(off.deny) & 1024n, 1024n, "hidden means View denied outright");

  assert.equal(spectatorsVisible("RUNNING"), true);
  assert.equal(spectatorsVisible("ENDED"), true);
  assert.equal(spectatorsVisible("LOBBY"), false);
  assert.equal(spectatorsVisible("CLOSED"), false);
});

test("an overwrite written before Read History was added counts as drift, so the doctor rewrites it", () => {
  const managed = [{ id: "chan-1", label: "The Square" }];
  const before = [{ id: "chan-1", permission_overwrites: [{ id: SPECTATOR_ROLE_ID, allow: "1024", deny: spectatorOverwrite()[0].deny }] }];
  assert.deepEqual(spectatorDrift(managed, before, true), managed);
  const after = [{ id: "chan-1", permission_overwrites: spectatorOverwrite({ visible: true }) }];
  assert.deepEqual(spectatorDrift(managed, after, true), []);
});
