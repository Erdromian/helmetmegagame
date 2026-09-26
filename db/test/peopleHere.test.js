// The shared people-picker (db/lib/peopleHere.js): the web's sheet and /chat
// and the Discord bot's "pick someone here" selects all read it. The one thing
// it must never do is ship a hooded person's real id or real name — the key is
// the hood token, the label the alias.
const test = require("node:test");
const assert = require("node:assert/strict");
const { rosterHere, pickerRows } = require("../lib/peopleHere");

const ROWS = [
  { id: "c-ada", name: "Ada Vale" },
  { id: "c-bram", name: "Bram Holt" },
  { id: "c-cy", name: "Cy Dunn" },
];

// A whosHere answer: Ada seen bare-faced (under the name the viewer holds),
// Bram and Cy in hoods under their aliases.
const ROOM = {
  named: [{ characterId: "c-ada", name: "Ada" }],
  concealed: [
    { alias: "a young man", token: "tok-b" },
    { alias: "a tall woman", token: "tok-c" },
  ],
  hoodIds: new Map([
    ["tok-b", "c-bram"],
    ["tok-c", "c-cy"],
  ]),
};

const prisma = {
  character: {
    findMany: async ({ where }) => ROWS.filter((r) => where.id.in.includes(r.id)),
  },
};
const viewer = { id: "c-me", locationId: "loc-1" };

test("rosterHere: the named half keeps the held name, the hooded half loses id and name", async () => {
  const { named, hooded } = await rosterHere(prisma, viewer, { room: ROOM, select: { id: true, name: true } });
  assert.deepEqual(named, [{ id: "c-ada", name: "Ada" }]);
  assert.deepEqual(
    hooded.map((h) => ({ id: h.id, name: h.name, hooded: h.hooded })),
    [
      { id: "hood:tok-c", name: "a tall woman", hooded: true },
      { id: "hood:tok-b", name: "a young man", hooded: true },
    ],
  );
  const shipped = JSON.stringify(hooded);
  for (const leak of ["c-bram", "c-cy", "Bram", "Cy Dunn"]) assert.ok(!shipped.includes(leak), `leaked ${leak}`);
});

test("pickerRows: target keys and labels, named first, never a bare id", async () => {
  const rows = await pickerRows(prisma, viewer, { room: ROOM });
  assert.deepEqual(rows, [
    { key: "character:c-ada", label: "Ada", hooded: false },
    { key: "hood:tok-c", label: "a tall woman", hooded: true },
    { key: "hood:tok-b", label: "a young man", hooded: true },
  ]);
});

test("nobody placed, nobody listed", async () => {
  assert.deepEqual(await pickerRows(prisma, { id: "c-me", locationId: null }), []);
});
