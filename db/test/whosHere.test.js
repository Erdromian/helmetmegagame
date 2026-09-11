// whosHere()'s `withHoodIds`: the server-only map from a hood's token back to
// the character behind it.
//
// WHAT A FAILURE HERE MEANS. The map is what lets placeMembers() drop a hood
// who is already in the conversation, or who holds a key to the room, before
// it offers them — so if it names the wrong person, or names somebody the
// `concealed` list does not, the picker and the HERE column disagree about
// who is hidden in the same viewport. And it is a SIBLING key rather than an
// id on the rows themselves because those rows go to a browser:
// /api/avatar/<id> takes an id and answers with a face, so shipping one is
// the unmasking whatever the page draws. The default shape must not carry it.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { whosHere, resolveHoodToken } = require("../lib/whosHere");
const { hoodToken } = require("../lib/hoodToken");

// lastSightings is never reached: every call passes a sightings Map (empty
// unless the test says otherwise), so the rows are judged on what is worn
// right now plus whatever the test has the viewer remember.
function fakePrisma(rows) {
  return { character: { findMany: async () => rows } };
}

const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, factionId: null, faction: null };
const concealingTag = (extra = {}) => ({
  equipped: true,
  tag: {
    forcedName: null,
    name: "Knight's Helmet",
    concealsIdentity: true,
    concealSprite: "helm",
    forcesConceal: false,
    equipLayer: 1,
    ...extra,
  },
});

const plain = (id, name) => ({ ...base, id, name, concealed: false, age: 30, gender: "MAN", tags: [] });
const hood = (id, name) => ({ ...base, id, name, concealed: true, age: 20, gender: "MAN", tags: [concealingTag()] });
// The wish is OFF. A sack tied over the head is not a choice, and it conceals
// anyway — which is the case peopleHere()'s column filter gets wrong and this
// one has to get right.
const sacked = (id, name) => ({
  ...base,
  id,
  name,
  concealed: false,
  age: 60,
  gender: "WOMAN",
  tags: [concealingTag({ name: "Sack", forcesConceal: true })],
});
// A Beast is openly a Beast: named, not hidden, even under a helmet.
const beast = (id, name) => ({
  ...base,
  id,
  name,
  concealed: true,
  age: 40,
  gender: "MAN",
  tags: [
    concealingTag(),
    { equipped: true, tag: { forcedName: "Beast", name: "Apex Form", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: 0 } },
  ],
});
// The wish set with nothing over the face: concealment is derived, not stored.
const wishing = (id, name) => ({ ...base, id, name, concealed: true, age: 30, gender: "WOMAN", tags: [] });

const viewer = { id: "viewer", locationId: "loc", factionId: null };

test("no hoodIds unless they are asked for", async () => {
  const { concealed, hoodIds } = await whosHere(fakePrisma([hood("h1", "Sir Alder")]), viewer);

  assert.equal(hoodIds, undefined, "an id must not ride along by default");
  assert.equal(concealed[0].alias, "a young man");
  assert.ok(!concealed[0].alias.includes("Alder"));
});

test("every token in the map names the character behind it", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder"), sacked("s1", "Mira Holt")]);
  const { hoodIds } = await whosHere(prisma, viewer, { withHoodIds: true });

  assert.deepEqual(
    [...hoodIds],
    [
      [hoodToken("h1"), "h1"],
      [hoodToken("s1"), "s1"],
    ],
  );
});

test("the map is exactly the concealed list — no more, no fewer", async () => {
  const prisma = fakePrisma([
    hood("h1", "Sir Alder"),
    sacked("s1", "Mira Holt"),
    beast("b1", "Jorren Vask"),
    plain("p1", "Ann Vell"),
    wishing("w1", "Tomas Reeve"),
  ]);
  const { named, concealed, hoodIds } = await whosHere(prisma, viewer, { withHoodIds: true });

  assert.deepEqual(concealed.map((c) => c.token).sort(), [...hoodIds.keys()].sort());
  // A forced name and a wish with nothing on are both NAMED, so neither is in
  // the map — the two rows that most easily land in the wrong list.
  assert.deepEqual(named.map((c) => c.name).sort(), ["Ann Vell", "Beast", "Tomas Reeve"]);
  assert.deepEqual([...hoodIds.values()].sort(), ["h1", "s1"]);
});

test("a sack conceals without the column, and reads as what a stranger sees", async () => {
  const { concealed } = await whosHere(fakePrisma([sacked("s1", "Mira Holt")]), viewer);

  assert.equal(concealed.length, 1);
  assert.equal(concealed[0].alias, "an old woman");
});

test("includeSelf: false keeps you out of your own list", async () => {
  const prisma = fakePrisma([hood("viewer", "Me"), hood("h1", "Them")]);

  const both = await whosHere(prisma, viewer, { withHoodIds: true });
  assert.deepEqual([...both.hoodIds.values()], ["viewer", "h1"]);

  const others = await whosHere(prisma, viewer, { withHoodIds: true, includeSelf: false });
  assert.deepEqual([...others.hoodIds.values()], ["h1"]);
});

test("nowhere is nobody", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder")]);
  const { named, concealed, hoodIds } = await whosHere(prisma, { id: "viewer", locationId: null }, { withHoodIds: true });

  assert.deepEqual(named, []);
  assert.deepEqual(concealed, []);
  assert.equal(hoodIds.size, 0);
});

// The bug this pairing exists to stop: the lists that MINT a token decide who
// is hidden from the sighting, so the function that RESOLVES one has to as
// well. Bob speaks from under a helmet and then takes it off — your sighting
// still says hooded, so he is offered as "a young man", and resolving that
// token used to fail because there is nothing over his face now. A person
// standing in front of you that Transfer answered "Unknown recipient." about.
test("a hood who unmasks after you heard them is still reachable by their token", async () => {
  const unmasked = plain("h1", "Sir Alder");
  const prisma = fakePrisma([unmasked]);
  const sightings = new Map([["h1", { seq: "1", name: "Young Man", concealed: true, avatarPath: null, unknownFace: false }]]);

  const { named, concealed } = await whosHere(prisma, viewer, { sightings });
  assert.deepEqual(named, [], "the sighting is what you know, not the bare face in front of you");
  assert.equal(concealed[0].alias, "a young man");

  const token = concealed[0].token;
  assert.equal(await resolveHoodToken(prisma, viewer, token, { sightings }), "h1");
});

test("a token names nobody once they have walked away", async () => {
  const token = hoodToken("h1");
  assert.equal(await resolveHoodToken(fakePrisma([]), viewer, token, { sightings: new Map() }), null);
});

test("a forced name's token resolves to nobody — a Beast is not hiding", async () => {
  const prisma = fakePrisma([beast("b1", "Jorren Vask")]);
  assert.equal(await resolveHoodToken(prisma, viewer, hoodToken("b1"), { sightings: new Map() }), null);
});
