// The Caving lens' fold of a caver's 1s into one result (web/lib/cavingLabels.js#foldCavingRolls) and the
// one number it must agree with the game on. The web keeps its own copy of
// CAVING_TROUBLE_CAP because cavingPass.js cannot be bundled for a browser;
// this is what stops the two drifting apart (CAVING.md §2e).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { CAVING_TROUBLE_CAP } = require("../lib/cavingPass");
const load = () => import(pathToFileURL(path.join(__dirname, "..", "..", "web", "lib", "cavingLabels.js")).href);

test("the web's copy of the cap is the game's", async () => {
  const web = await load();
  assert.equal(web.CAVING_TROUBLE_CAP, CAVING_TROUBLE_CAP);
});

const row = (id, characterId, zoneId, createdAtMs, kind = "TROUBLE", extra = {}) => ({ id, characterId, zoneId, createdAtMs, kind, die: kind === "TROUBLE" ? 1 : 3, locationName: `room-${id}`, resolvedAt: null, gmNotes: "", ...extra });

test("a caver's 1s in one zone fold into one row, keyed by the oldest and showing the newest", async () => {
  const { foldCavingRolls, foldCountLabel } = await load();
  const { rows, groupOf } = foldCavingRolls([
    row("b", "ada", "depths", 20),
    row("a", "ada", "depths", 10),
    row("q", "ada", "depths", 15, "QUIET"),
    row("c", "ada", "caves", 30), // another zone: its own result
    row("d", "bob", "depths", 5),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(rows.length, 4, "the QUIET roll stays, a and b become one");
  assert.equal(byId.has("b"), false);
  const ada = byId.get("a");
  assert.deepEqual(ada.memberIds, ["a", "b"]);
  assert.equal(ada.latestId, "b");
  assert.equal(ada.count, 2);
  assert.equal(ada.createdAtMs, 20, "the newest roll's time");
  assert.equal(ada.locationName, "room-b", "and the newest roll's place");
  assert.equal(byId.get("q").memberIds, undefined, "a QUIET roll is not folded");
  assert.equal(groupOf.get("b"), "a");
  assert.equal(groupOf.get("a"), "a");
  assert.equal(groupOf.has("q"), false);

  assert.equal(foldCountLabel(byId.get("c")), null, "a lone 1 is the ordinary case and gets no count");
  assert.equal(foldCountLabel(ada), "2 failed rolls this turn");
  assert.equal(foldCountLabel(null), null);
});

test("a group needs attention while any of its 1s does, and says how many are new", async () => {
  const { foldCavingRolls } = await load();
  const resolved = { resolvedAt: "2026-09-27T10:00:00.000Z", resolvedAtLabel: "2026-09-27 10:00", resolvedByUsername: "gm" };
  const [done] = foldCavingRolls([row("a", "ada", "depths", 1, "TROUBLE", resolved), row("b", "ada", "depths", 2, "TROUBLE", resolved)]).rows;
  assert.equal(done.statusLabel, "Resolved");
  assert.equal(done.resolvedByUsername, "gm");
  assert.equal(done.newSinceResolved, 0);

  const [reopened] = foldCavingRolls([
    row("a", "ada", "depths", 1, "TROUBLE", resolved),
    row("b", "ada", "depths", 2),
    row("c", "ada", "depths", 3),
  ]).rows;
  assert.equal(reopened.statusLabel, "Needs attention");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.newSinceResolved, 2);

  const [fresh] = foldCavingRolls([row("a", "ada", "depths", 1), row("b", "ada", "depths", 2)]).rows;
  assert.equal(fresh.newSinceResolved, 0, "nothing is 'new since resolved' before anything was");
});

test("the Result box is the oldest roll's, falling back to a later note", async () => {
  const { foldCavingRolls } = await load();
  const [a] = foldCavingRolls([row("a", "ada", "depths", 1, "TROUBLE", { gmNotes: "first" }), row("b", "ada", "depths", 2, "TROUBLE", { gmNotes: "second" })]).rows;
  assert.equal(a.gmNotes, "first");
  const [b] = foldCavingRolls([row("a", "ada", "depths", 1), row("b", "ada", "depths", 2, "TROUBLE", { gmNotes: "second" })]).rows;
  assert.equal(b.gmNotes, "second");
});

test("the tenth 1 marks the group stuck", async () => {
  const { foldCavingRolls } = await load();
  const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "ada", "depths", i));
  assert.equal(foldCavingRolls(rows).rows[0].stuck, true);
  assert.equal(foldCavingRolls(rows.slice(0, 9)).rows[0].stuck, false);
});
