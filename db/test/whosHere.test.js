// hoodsHere(): the server-only half of whosHere()'s `concealed` list.
//
// WHAT A FAILURE HERE MEANS. Two things go wrong in opposite directions.
// If this list DISAGREES with whosHere()'s `concealed` about who is hidden,
// one person shows up twice in the same viewport — named in the HERE column
// and hooded in the picker beside it, or the reverse. And if a row of this
// ever reaches a browser, the character id on it IS the unmasking:
// /api/avatar/<id> takes an id and answers with a face. Only `token` crosses
// the wire, and resolveHoodToken is what brings it back.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { whosHere, hoodsHere } = require("../lib/whosHere");
const { hoodToken } = require("../lib/hoodToken");

// lastSightings is never reached: every call below leaves `withSightings`
// off and passes no map, so the rows are judged on what is worn right now.
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
const sacked = (id, name) => ({
  ...base,
  id,
  name,
  // The wish is OFF. A sack tied over the head is not a choice.
  concealed: false,
  age: 60,
  gender: "WOMAN",
  tags: [concealingTag({ name: "Sack", forcesConceal: true })],
});
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
// The wish set, nothing over the face: concealment is derived, not stored.
const wishing = (id, name) => ({ ...base, id, name, concealed: true, age: 30, gender: "WOMAN", tags: [] });

const viewer = { id: "viewer", locationId: "loc", factionId: null };

test("a hood comes back with its id, its alias and its token", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder")]);
  const rows = await hoodsHere(prisma, viewer);

  assert.deepEqual(rows, [{ id: "h1", alias: "a young man", token: hoodToken("h1") }]);
  assert.ok(!rows[0].alias.includes("Alder"));
});

test("forcesConceal counts without the column; the bare wish does not", async () => {
  const prisma = fakePrisma([sacked("s1", "Mira Holt"), wishing("w1", "Tomas Reeve"), plain("p1", "Ann Vell")]);
  const rows = await hoodsHere(prisma, viewer);

  assert.deepEqual(
    rows.map((r) => r.id),
    ["s1"],
  );
  assert.equal(rows[0].alias, "an old woman");
});

test("a forced name is not a hood, even with the helmet on", async () => {
  const prisma = fakePrisma([beast("b1", "Jorren Vask")]);
  assert.deepEqual(await hoodsHere(prisma, viewer), []);
});

test("the list is exactly whosHere()'s concealed half", async () => {
  const rows = [hood("h1", "Sir Alder"), sacked("s1", "Mira Holt"), beast("b1", "Jorren Vask"), plain("p1", "Ann Vell"), wishing("w1", "Tomas Reeve")];
  const prisma = fakePrisma(rows);

  const { concealed } = await whosHere(prisma, viewer);
  const hoods = await hoodsHere(prisma, viewer);

  assert.equal(hoods.length, concealed.length);
  assert.deepEqual(
    hoods.map((r) => r.alias),
    concealed.map((r) => r.alias),
  );
  assert.deepEqual(
    hoods.map((r) => r.token),
    concealed.map((r) => r.token),
  );
});

test("includeSelf: false keeps you out of your own list", async () => {
  const prisma = fakePrisma([hood("viewer", "Me"), hood("h1", "Them")]);

  assert.deepEqual((await hoodsHere(prisma, viewer)).map((r) => r.id), ["viewer", "h1"]);
  assert.deepEqual((await hoodsHere(prisma, viewer, { includeSelf: false })).map((r) => r.id), ["h1"]);
});

test("nowhere is nobody", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder")]);
  assert.deepEqual(await hoodsHere(prisma, { id: "viewer", locationId: null }), []);
});

test("no AUTH_SECRET, no token — and an untokened hood is not offerable", async () => {
  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const prisma = fakePrisma([hood("h1", "Sir Alder")]);
    const [row] = await hoodsHere(prisma, viewer);
    assert.equal(row.token, null);
  } finally {
    process.env.AUTH_SECRET = secret;
  }
});
