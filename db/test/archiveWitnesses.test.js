// Who witnessed an archive row (db/lib/archiveWitnesses.js,
// docs/systemdocs/ARCHIVE.md "Witnesses"). Pure, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { witnessesFrom, witnessColumns } = require("../lib/archiveWitnesses");

const ADA = { id: "ada", name: "Ada Vask" };
const OTTO = { id: "otto", name: "Otto Vask" };
const MARROW = { id: "marrow", name: "Marrow Kell" };
const ids = (list) => list.map((w) => w.id);

test("a line is witnessed by its speaker and everyone standing there", () => {
  const row = { kind: "MESSAGE", characterId: "ada", characterName: "Ada Vask" };
  const got = witnessesFrom(row, [OTTO, ADA, MARROW]);
  assert.deepEqual(got, [ADA, OTTO, MARROW]);
});

test("the speaker is a witness even with nobody else in the place", () => {
  assert.deepEqual(witnessesFrom({ kind: "MESSAGE", characterId: "ada", characterName: "Ada Vask" }, []), [ADA]);
});

test("a scene line with no speaker is witnessed by the room alone", () => {
  assert.deepEqual(ids(witnessesFrom({ kind: "MESSAGE", characterId: null }, [ADA, OTTO])), ["ada", "otto"]);
});

test("somebody asleep or unconscious witnesses nothing, unless it is their own row", () => {
  const row = { kind: "MESSAGE", characterId: "ada", characterName: "Ada Vask" };
  assert.deepEqual(ids(witnessesFrom(row, [{ ...ADA, deaf: true }, { ...OTTO, deaf: true }, MARROW])), ["ada", "marrow"]);
});

test("a telephone's row is witnessed only by the people who read it", () => {
  const room = [ADA, OTTO, MARROW];
  assert.deepEqual(ids(witnessesFrom({ kind: "MESSAGE", onlyCharacterId: "otto" }, room)), ["otto"]);
  assert.deepEqual(ids(witnessesFrom({ kind: "MESSAGE", exceptCharacterId: "otto" }, room)), ["ada", "marrow"]);
});

test("a day divider has no witnesses", () => {
  assert.deepEqual(witnessesFrom({ kind: "TURN_START", characterId: "ada" }, [OTTO]), []);
});

test("an event is witnessed by whoever it is about and the room", () => {
  const row = { kind: "DEATH", characterId: "marrow", characterName: "Marrow Kell" };
  assert.deepEqual(ids(witnessesFrom(row, [ADA])), ["marrow", "ada"]);
});

test("the two columns stay in step, one person per index, no repeats", () => {
  const cols = witnessColumns([ADA, OTTO, ADA, null, { id: "x" }]);
  assert.deepEqual(cols, { witnessIds: ["ada", "otto", "x"], witnessNames: ["Ada Vask", "Otto Vask", ""] });
  assert.deepEqual(witnessColumns(), { witnessIds: [], witnessNames: [] });
});
