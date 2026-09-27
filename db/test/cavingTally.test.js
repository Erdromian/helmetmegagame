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

const row = (id, characterId, zoneId, createdAtMs, kind = "TROUBLE", extra = {}) => ({ id, characterId, zoneId, zoneName: zoneId, createdAtMs, kind, die: kind === "TROUBLE" ? 1 : 3, locationName: `room-${id}`, resolvedAt: null, gmNotes: "", ...extra });

test("a caver's 1s fold into one result across both levels, keyed by the oldest and showing the newest", async () => {
  const { foldCavingRolls, severityLabel } = await load();
  const { rows, groupOf } = foldCavingRolls([
    row("b", "ada", "caves", 20),
    row("a", "ada", "caves", 10),
    row("q", "ada", "caves", 15, "QUIET"),
    row("c", "ada", "depths", 30), // down a level: still the same result (Caving.docx)
    row("d", "bob", "depths", 5),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(rows.length, 3, "the QUIET roll stays, a, b and c become one");
  assert.equal(byId.has("b"), false);
  assert.equal(byId.has("c"), false);
  const ada = byId.get("a");
  assert.deepEqual(ada.memberIds, ["a", "b", "c"]);
  assert.equal(ada.latestId, "c");
  assert.equal(ada.count, 3);
  assert.equal(ada.createdAtMs, 30, "the newest roll's time");
  assert.equal(ada.locationName, "room-c", "the newest roll's place");
  assert.equal(ada.zoneName, "depths", "and the newest roll's zone");
  assert.equal(byId.get("q").memberIds, undefined, "a QUIET roll is not folded");
  assert.equal(groupOf.get("c"), "a");
  assert.equal(groupOf.get("a"), "a");
  assert.equal(groupOf.has("q"), false);

  assert.equal(severityLabel(ada), "Severity 3");
  assert.equal(severityLabel(byId.get("d")), "Severity 1", "a lone 1 shows its severity too");
  assert.equal(severityLabel(byId.get("q")), null, "a roll that did not fail has none");
  assert.equal(severityLabel(null), null);
});

test("only failures show by default", async () => {
  const { isCavingFailure } = await load();
  assert.equal(isCavingFailure(row("a", "ada", "caves", 1)), true);
  assert.equal(isCavingFailure(row("q", "ada", "caves", 1, "QUIET")), false);
  assert.equal(isCavingFailure(row("f", "ada", "caves", 1, "FIND")), false);
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

test("severity 10 marks the result stuck, whichever levels the 1s were in", async () => {
  const { foldCavingRolls } = await load();
  const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "ada", i % 2 ? "depths" : "caves", i));
  assert.equal(foldCavingRolls(rows).rows[0].stuck, true);
  assert.equal(foldCavingRolls(rows.slice(0, 9)).rows[0].stuck, false);
});
