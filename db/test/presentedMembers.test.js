// Who a members strip may name, and what face it may draw.
//
// WHAT A FAILURE HERE MEANS. The strip above a conversation used to select
// Character.name and ship the character's id with it. /api/avatar/<id> takes
// an id and answers with a face, so the id ALONE was the leak — a hooded
// member's real portrait was one request away whatever the page chose to
// draw. That is why a concealed row here carries no id at all, and why the
// test below asserts its absence rather than only asserting the name.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { presentedMembers, presentedNameOf, resolveMemberToken } = require("../lib/presentedMembers");
const { hoodToken } = require("../lib/hoodToken");

function fakePrisma(rows) {
  return {
    character: {
      findMany: async ({ where }) =>
        rows.filter((r) => where.id.in.includes(r.id) && r.status === "ALIVE"),
    },
  };
}

const base = { status: "ALIVE", updatedAt: new Date(1700000000000) };
const plain = (id, name) => ({ ...base, id, name, concealed: false, age: 30, gender: "MAN", tags: [] });
const hood = (id, name) => ({
  ...base,
  id,
  name,
  concealed: true,
  age: 20,
  gender: "WOMAN",
  tags: [
    {
      equipped: true,
      tag: { forcedName: null, name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: false, equipLayer: 1 },
    },
  ],
});
const beast = (id, name) => ({
  ...base,
  id,
  name,
  concealed: false,
  age: 40,
  gender: "MAN",
  tags: [
    {
      equipped: true,
      tag: { forcedName: "Beast", name: "Apex Form", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: 0 },
    },
  ],
});

test("a hood carries no character id, and no face until it is seen", async () => {
  const prisma = fakePrisma([hood("h1", "Cersei Vane")]);
  const [row] = await presentedMembers(prisma, ["h1"], { id: "viewer" });

  assert.equal(row.characterId, null, "shipping the id is the leak, whatever is drawn");
  assert.equal(row.token, hoodToken("h1"));
  assert.equal(row.name, "a young woman");
  assert.ok(!row.name.includes("Cersei"));
  assert.equal(row.avatarPath, null);
  assert.equal(row.unknownFace, true);
  assert.equal(row.concealed, true);
});

test("a sighting is what buys the mask", async () => {
  const prisma = fakePrisma([hood("h1", "Cersei Vane")]);
  const sightings = new Map([["h1", { name: "Young Woman", avatarPath: "/assets/helms/hood.webp", seq: 12n }]]);
  const [row] = await presentedMembers(prisma, ["h1"], { id: "viewer" }, { sightings });

  assert.equal(row.avatarPath, "/assets/helms/hood.webp");
  assert.equal(row.unknownFace, false);
  // Still no id: a face you have earned is not a name you have earned.
  assert.equal(row.characterId, null);
});

test("you always see yourself, hooded or not", async () => {
  const prisma = fakePrisma([hood("h1", "Cersei Vane")]);
  const [row] = await presentedMembers(prisma, ["h1"], { id: "h1" });
  // Nobody should have to speak to learn what they look like — but the row is
  // still the hood's, because that is what the conversation sees.
  assert.equal(row.avatarPath, "/assets/helms/hood.webp");
  assert.equal(row.unknownFace, false);
  assert.equal(row.characterId, null);
});

test("a forced name is named openly, and wears its plaque", async () => {
  const prisma = fakePrisma([beast("b1", "Jorren Vask")]);
  const [row] = await presentedMembers(prisma, ["b1"], { id: "viewer" });
  // A Beast is not hiding (PROXYING.md §5): the name is public and the id
  // comes with it, but the FACE is the letter plaque, never their portrait.
  assert.equal(row.name, "Beast");
  assert.equal(row.characterId, "b1");
  assert.equal(row.avatarPath, "/assets/letters/B.webp");
  assert.equal(row.concealed, false);
});

test("somebody with nothing over their face is just themselves", async () => {
  const prisma = fakePrisma([plain("p1", "Sir Alder")]);
  const [row] = await presentedMembers(prisma, ["p1"], { id: "viewer" });
  assert.equal(row.name, "Sir Alder");
  assert.equal(row.characterId, "p1");
  // Null avatarPath means "ask /api/avatar", which is only ever said about
  // somebody this viewer may have the face of.
  assert.equal(row.avatarPath, null);
  assert.equal(row.token, null);
});

test("order is the caller's, and the dead drop out", async () => {
  const prisma = fakePrisma([
    plain("a", "Ada"),
    plain("b", "Bran"),
    { ...plain("c", "Corpse"), status: "DEAD" },
  ]);
  const rows = await presentedMembers(prisma, ["b", "c", "a"], { id: "viewer" });
  assert.deepEqual(rows.map((r) => r.name), ["Bran", "Ada"]);
});

test("a hood token resolves only inside the roster it was minted from", () => {
  const token = hoodToken("h1");
  assert.equal(resolveMemberToken(["x", "h1", "y"], token), "h1");
  // Not in this place — the whole point of scoping it to a roster.
  assert.equal(resolveMemberToken(["x", "y"], token), null);
  assert.equal(resolveMemberToken(["h1"], "not-a-token"), null);
  assert.equal(resolveMemberToken(["h1"], null), null);
});

test("with no AUTH_SECRET a token is never minted, and never matches", () => {
  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    assert.equal(hoodToken("h1"), null);
    // The one that matters: `null === null` must not name the first id in the
    // list, or the handle becomes an unmasking oracle for anybody who sends
    // nothing at all.
    assert.equal(resolveMemberToken(["h1", "h2"], null), null);
  } finally {
    process.env.AUTH_SECRET = secret;
  }
});

test("presentedNameOf answers with a name, or something rather than nothing", async () => {
  const prisma = fakePrisma([hood("h1", "Cersei Vane"), plain("p1", "Sir Alder")]);
  assert.equal(await presentedNameOf(prisma, "h1", { id: "viewer" }), "a young woman");
  assert.equal(await presentedNameOf(prisma, "p1", { id: "viewer" }), "Sir Alder");
  assert.equal(await presentedNameOf(prisma, "gone", { id: "viewer" }), "somebody");
});
