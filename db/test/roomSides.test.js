// Rooms that open onto more than one Location — a window, a counter
// (Multi-locational rooms.docx, docs/systemdocs/MAP.md §2d, db/lib/roomSides.js).
//
// WHAT A FAILURE HERE MEANS. The overlay is what makes every door, stash and
// thread in the game side-aware without being rewritten: a side view that kept
// its home's gate would open a strict counter to anyone on the easy side, and a
// side view with the home's thread id would post one side's words into the
// other side's channel. The Who's Here half is the doc's one hard rule — the far
// side is listed and can be looked at, and never reaches a picker, since
// "they cannot target characters on the other location".
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";
process.env.DISCORD_GUILD_ID ||= "guild-1";

const {
  roomAt,
  roomsAt,
  roomViews,
  otherSides,
  opensOntoWhere,
  membershipKey,
  parseMembershipKey,
  sidePresenceWhere,
} = require("../lib/roomSides");
const { accessibleRooms, privateThreadUnits } = require("../lib/roomAccess");
const { whosHere, whosHereLines, resolveHoodToken, resolveCrossRoomRef } = require("../lib/whosHere");
const { buildDesired } = require("../lib/discordMirror/desired");
const { parseZonesYaml } = require("../lib/syncZones/parse");

// The Merchant's counter: home at the Merchant, private there (the licence),
// and a public side onto the Slums.
const counter = () => ({
  id: "counter",
  name: "Counter",
  slug: "undertown-6-4",
  locationId: "merchant",
  kind: "PRIVATE",
  accessTagSlugs: ["merchants-license"],
  sortOrder: 3,
  discordThreadId: "thread-home",
  starterMessageId: "start-home",
  postHash: "hash-home",
  sides: [
    {
      id: "side-slums",
      locationId: "slums",
      kind: "PUBLIC",
      accessTagSlugs: [],
      sortOrder: 0,
      discordThreadId: "thread-slums",
      starterMessageId: "start-slums",
      postHash: "hash-slums",
      location: { id: "slums", name: "Slums", discordChannelId: "chan-slums", zoneId: "undertown" },
    },
  ],
});

test("seen from home, a room is itself", () => {
  const view = roomAt(counter(), "merchant");
  assert.equal(view.kind, "PRIVATE");
  assert.equal(view.discordThreadId, "thread-home");
  assert.equal(view.sideId, null);
  assert.equal(view.homeLocationId, "merchant");
  assert.equal(membershipKey(view), "counter");
});

test("seen from a side, a room wears that side's gate, thread and order", () => {
  const view = roomAt(counter(), "slums");
  assert.equal(view.id, "counter", "one room, one id — its feed and stash never split");
  assert.equal(view.locationId, "slums", "standing at the side IS being where the room is");
  assert.equal(view.homeLocationId, "merchant");
  assert.equal(view.kind, "PUBLIC");
  assert.deepEqual(view.accessTagSlugs, []);
  assert.equal(view.discordThreadId, "thread-slums");
  assert.equal(view.starterMessageId, "start-slums");
  assert.equal(view.sortOrder, 0);
  assert.equal(view.sideId, "side-slums");
  assert.equal(membershipKey(view), "counter@slums");
  assert.deepEqual(parseMembershipKey("counter@slums"), { roomId: "counter", locationId: "slums" });
  assert.deepEqual(parseMembershipKey("counter"), { roomId: "counter", locationId: null });
});

test("a room is nowhere it does not open onto", () => {
  assert.equal(roomAt(counter(), "square"), null);
  assert.deepEqual(roomsAt([counter()], "square"), []);
  assert.deepEqual(otherSides(counter(), "slums"), ["merchant"]);
  assert.deepEqual(roomViews(counter()).map((v) => v.locationId), ["merchant", "slums"]);
});

test("the gate is the side's: the licence opens the home side, and anybody the public one", () => {
  const nobody = new Set();
  assert.equal(accessibleRooms([roomAt(counter(), "merchant")], nobody).length, 0);
  assert.equal(accessibleRooms([roomAt(counter(), "slums")], nobody).length, 1);
  assert.equal(accessibleRooms([roomAt(counter(), "merchant")], new Set(["merchants-license"])).length, 1);
});

test("the where fragment finds a room from its home or any side", () => {
  assert.deepEqual(opensOntoWhere("slums"), {
    OR: [{ locationId: "slums" }, { sides: { some: { locationId: "slums" } } }],
  });
});

test("who is in the room on a side: everyone there if public, the entitled if private", () => {
  assert.deepEqual(sidePresenceWhere(roomAt(counter(), "slums")), { status: "ALIVE", locationId: "slums" });
  const home = sidePresenceWhere(roomAt(counter(), "merchant"));
  assert.equal(home.locationId, "merchant");
  // A guest pass counts only on the side it was given at.
  assert.deepEqual(home.OR[0], { roomGuestOf: { some: { roomId: "counter", locationId: "merchant" } } });
  assert.ok(home.OR.some((c) => c.tags?.some?.tag?.slug?.in?.includes("merchants-license")), "a held key");
  assert.ok(
    home.OR.some((c) => c.tags?.some?.tag?.ringAccessSlugs?.hasSome?.includes("merchants-license")),
    "the worn ring's door tokens",
  );
});

test("private membership is one unit per private thread, keyed per side", () => {
  const units = privateThreadUnits([counter()]);
  assert.deepEqual(
    units.map((u) => [u.key, u.threadId]),
    [["counter", "thread-home"]],
    "the public side has no private thread to join",
  );
  const bothPrivate = counter();
  bothPrivate.sides[0].kind = "PRIVATE";
  bothPrivate.sides[0].accessTagSlugs = ["slum-key"];
  assert.deepEqual(
    privateThreadUnits([bothPrivate]).map((u) => u.key),
    ["counter", "counter@slums"],
  );
});

// --- Who's Here -----------------------------------------------------------

const hood = {
  equipped: true,
  tag: { forcedName: null, name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 1 },
};
const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, concealed: true, age: 30, gender: "man" };
const PEOPLE = {
  slums: [
    { ...base, id: "shopper", name: "Shopper", concealed: false, tags: [] },
    { ...base, id: "masked", name: "Masked", tags: [hood] },
  ],
  merchant: [{ ...base, id: "merchant-1", name: "Merchant", concealed: false, tags: [] }],
};

function fakePrisma({ rooms = [counter()] } = {}) {
  return {
    character: { findMany: async ({ where }) => PEOPLE[where.locationId] ?? [] },
    locationLink: { findMany: async () => [] },
    room: {
      findMany: async () =>
        rooms.map((r) => ({ ...r, location: { id: r.locationId, name: r.locationId === "merchant" ? "Merchant" : r.locationId } })),
    },
    // roomAccessKeys, for the viewer's own side of the door.
    characterTag: {
      findMany: async ({ where }) =>
        where.characterId === "merchant-1" ? [{ equipped: false, tag: { slug: "merchants-license" } }] : [],
    },
    roomGuest: { findMany: async () => [] },
    quest: { findMany: async () => [] },
  };
}

const merchantViewer = { id: "merchant-1", locationId: "merchant" };

test("the far side of a counter is listed under the room, and never offered to a picker", async () => {
  const out = await whosHere(fakePrisma(), merchantViewer, {
    sightings: new Map(),
    withAcross: true,
    withHoodIds: true,
  });
  assert.equal(out.rooms.length, 1);
  const [group] = out.rooms;
  assert.equal(group.roomName, "Counter");
  assert.equal(group.locationName, "Slums");
  assert.deepEqual(group.named.map((p) => p.name), ["Shopper"]);
  assert.equal(group.named[0].performerKey, null, "no menu handle");
  assert.equal(group.concealed.length, 1);
  assert.equal(group.concealed[0].token, null, "no token: no verb can name them");
  assert.ok(group.concealed[0].lookRef, "a look may still name them");
  assert.equal([...out.hoodIds.values()].includes("masked"), false);
  assert.match(whosHereLines(out).join("\n"), /\*\*Counter · Slums:\*\* Shopper \| /);
});

test("without the opt-in there is no counter list at all", async () => {
  const out = await whosHere(fakePrisma(), merchantViewer, { sightings: new Map() });
  assert.equal(out.rooms, undefined);
});

test("a viewer not let in on their own side sees nobody through it", async () => {
  const locked = counter();
  const out = await whosHere(fakePrisma({ rooms: [locked] }), { id: "merchant-2", locationId: "merchant" }, {
    sightings: new Map(),
    withAcross: true,
  });
  assert.deepEqual(out.rooms, []);
});

test("a look-only ref names the far hood for a look, and nobody for a verb", async () => {
  const prisma = fakePrisma();
  const out = await whosHere(prisma, merchantViewer, { sightings: new Map(), withAcross: true });
  const ref = out.rooms[0].concealed[0].lookRef;
  const looked = await resolveCrossRoomRef(prisma, merchantViewer, ref, { sightings: new Map() });
  assert.equal(looked?.id, "masked");
  // resolveHoodToken is what db/lib/targetKey.js resolves every verb's target through.
  assert.equal(await resolveHoodToken(prisma, merchantViewer, ref, { sightings: new Map() }), null);
});

// --- Discord: a thread per side --------------------------------------------

test("the mirror wants a thread under each side's channel, linked from that side's anchor", () => {
  const zone = {
    id: "undertown",
    slug: "undertown",
    name: "Undertown",
    kind: "SURFACE",
    sortOrder: 0,
    description: "",
    parentZoneId: null,
    discordRoleId: "role-z",
    gmRoleId: "role-gm",
    discordCategoryId: "cat",
    discordSummaryChannelId: "sum",
  };
  const loc = (id, name, channel) => ({
    id,
    slug: id,
    name,
    description: "",
    sortOrder: 0,
    zoneId: "undertown",
    attributes: [],
    discordChannelId: channel,
    anchorMessageId: null,
    anchorHash: null,
  });
  const targets = buildDesired({
    zones: [zone],
    locations: [loc("merchant", "Merchant", "chan-merchant"), loc("slums", "Slums", "chan-slums")],
    rooms: [{ ...counter(), description: "", soundproof: false, live: null }],
    config: {},
    spectators: true,
    guildId: "guild-1",
  });
  const threads = targets.filter((t) => t.kind === "room-thread");
  assert.deepEqual(
    threads.map((t) => [t.key, t.parentKey, t.currentId, t.idColumn.model]),
    [
      ["thread:room:counter", "channel:location:merchant", "thread-home", "room"],
      ["thread:room:counter@slums", "channel:location:slums", "thread-slums", "roomSide"],
    ],
  );
  assert.ok(threads.every((t) => t.subject.type === "room" && t.subject.id === "counter"), "one job rebuilds both");
  const slumsAnchor = targets.find((t) => t.key === "anchor:location:slums");
  assert.deepEqual(slumsAnchor.rooms.map((r) => r.discordThreadId), ["thread-slums"]);
  const { buildRoomBody } = require("../lib/syncZones/bodies");
  assert.match(buildRoomBody(roomAt(counter(), "slums"), null, { alsoReachedFrom: ["Merchant"] }), /Also reached from Merchant\./);
});

// --- docs/zones.yaml --------------------------------------------------------

test("zones.yaml names a room's other sides, each with its own access", () => {
  const yaml = (rooms) => ({
    zones: { undertown: { name: "Undertown", locations: { merchant: { name: "Merchant", rooms } } } },
  });
  const { roomEntries } = parseZonesYaml(
    yaml({
      counter: {
        name: "Counter",
        access: ["merchants-license"],
        sides: [{ location: "slums" }, { location: "old-town", access: ["old-key"] }],
      },
    }),
  );
  assert.deepEqual(roomEntries.find((r) => r.slug === "counter").sides, [
    { locationSlug: "slums", kind: "PUBLIC", accessTagSlugs: [], sortOrder: 0 },
    { locationSlug: "old-town", kind: "PRIVATE", accessTagSlugs: ["old-key"], sortOrder: 1 },
  ]);
  // A side that is its own home, or the same Location twice, is a problem the sync refuses.
  assert.throws(
    () => parseZonesYaml(yaml({ bad: { name: "Bad", sides: [{ location: "merchant" }, { location: "slums" }, { location: "slums" }] } })),
    (err) => /is its own Location/.test(err.message) && /opens onto "slums" twice/.test(err.message),
  );
});
