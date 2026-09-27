// intercept.js#seenByMany: seenBy for a whole list, one reader, one Friends
// lookup. Row by row it must answer exactly what seenBy answers, since seenBy
// is now seenByMany of one — so every case here is checked both ways.
const test = require("node:test");
const assert = require("node:assert/strict");
const { seenBy, seenByMany, seenByIdMany } = require("../lib/intercept");

const HERE = "loc-1";

const hood = () => ({
  equipped: true,
  tag: { slug: "hood", name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 3, forcedName: null },
});
const beast = () => ({
  equipped: false,
  tag: { slug: "apex-form", name: "Apex Form", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: null, forcedName: "Beast" },
});

const person = (id, name, over = {}) => ({
  id,
  name,
  firstName: name.split(" ")[0],
  lastName: name.split(" ")[1] ?? null,
  age: 20,
  gender: "MAN",
  concealed: false,
  status: "ALIVE",
  locationId: HERE,
  discordUserId: `u-${id}`,
  updatedAt: new Date(0),
  tags: [],
  ...over,
});

// `known` is each reader's Friends list, `rows` what a lookup by id finds.
// Counts every Friends query and every character read, so batching is tested,
// not assumed.
function fakeDb({ known = {}, rows = {}, anonymize = true } = {}) {
  const calls = { acquaintance: 0, character: 0 };
  return {
    calls,
    acquaintance: {
      findMany: async ({ where }) => {
        calls.acquaintance += 1;
        return (known[where.ownerId] ?? []).filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId }));
      },
    },
    gameConfig: { findUnique: async () => ({ anonymizeStrangers: anonymize }) },
    character: {
      findUnique: async ({ where }) => {
        calls.character += 1;
        return rows[where.id] ?? null;
      },
      findMany: async ({ where }) => {
        calls.character += 1;
        return where.id.in.map((id) => rows[id]).filter(Boolean);
      },
    },
  };
}

const friend = person("F", "Ada Marrow", { gender: "WOMAN" });
const stranger = person("S", "Bo Stark");
const hooded = person("H", "Cal Vane", { tags: [hood()] });
const forced = person("B", "Dunn Hale", { tags: [beast()] });
const me = person("R", "Rhea Reed", { gender: "WOMAN" });

// Both answers, so seenBy and seenByMany can never quietly disagree.
async function both(db, viewerId, rows) {
  const many = await seenByMany(db, viewerId, rows);
  const one = [];
  for (const row of rows) one.push(await seenBy(db, viewerId, row));
  assert.deepEqual(one, many, "seenBy and seenByMany disagree");
  return many;
}

test("a friend is their name, a stranger is what they look like", async () => {
  const db = fakeDb({ known: { R: ["F"] } });
  assert.deepEqual(await both(db, "R", [friend, stranger]), ["Ada Marrow", "a young man"]);
});

test("a hood is its alias even to a friend, and asks nobody's Friends list", async () => {
  const db = fakeDb({ known: { R: ["H"] } });
  assert.deepEqual(await seenByMany(db, "R", [hooded]), ["a young man"]);
  assert.equal(db.calls.acquaintance, 0, "a hood never needs the Friends list");
});

test("a forced name is the name the whole room reads, friend or not", async () => {
  assert.deepEqual(await both(fakeDb(), "R", [forced]), ["Beast"]);
  assert.deepEqual(await both(fakeDb({ known: { R: ["B"] } }), "R", [forced]), ["Beast"]);
});

test("you always know yourself", async () => {
  const db = fakeDb();
  assert.deepEqual(await seenByMany(db, "R", [me]), ["Rhea Reed"]);
  assert.equal(db.calls.acquaintance, 0);
});

test("a row that is gone is somebody", async () => {
  assert.deepEqual(await seenByMany(fakeDb(), "R", [null, stranger]), ["somebody", "a young man"]);
});

// No reader: a GM's view, a ghost, the lobby. There is nobody to recognise
// with, so seenBy never had a stranger rule for them — a face is named, a hood
// is still a hood.
test("with no reader, a bare face is named and a hood is not", async () => {
  const db = fakeDb();
  assert.deepEqual(await both(db, null, [stranger, hooded]), ["Bo Stark", "a young man"]);
  assert.equal(db.calls.acquaintance, 0);
});

test("with the stranger rule switched off, every bare face is named", async () => {
  const db = fakeDb({ anonymize: false });
  assert.deepEqual(await both(db, "R", [stranger, hooded]), ["Bo Stark", "a young man"]);
});

test("a whole list is one Friends lookup, in the order it came", async () => {
  const db = fakeDb({ known: { R: ["F"] } });
  const names = await seenByMany(db, "R", [stranger, friend, hooded, forced, me, stranger]);
  assert.deepEqual(names, ["a young man", "Ada Marrow", "a young man", "Beast", "Rhea Reed", "a young man"]);
  assert.equal(db.calls.acquaintance, 1);
});

test("an empty list asks nothing", async () => {
  const db = fakeDb();
  assert.deepEqual(await seenByMany(db, "R", []), []);
  assert.deepEqual(await seenByMany(db, "R", undefined), []);
  assert.equal(db.calls.acquaintance, 0);
});

test("seenByIdMany: one read for the rows, order kept, a missing id is somebody", async () => {
  const db = fakeDb({ rows: { F: friend, S: stranger }, known: { R: ["F"] } });
  const names = await seenByIdMany(db, "R", ["S", "gone", "F", "S"]);
  assert.deepEqual(names, ["a young man", "somebody", "Ada Marrow", "a young man"]);
  assert.equal(db.calls.character, 1);
  assert.equal(db.calls.acquaintance, 1);
});

test("seenByIdMany of nothing reads nothing", async () => {
  const db = fakeDb();
  assert.deepEqual(await seenByIdMany(db, "R", []), []);
  assert.equal(db.calls.character, 0);
});
