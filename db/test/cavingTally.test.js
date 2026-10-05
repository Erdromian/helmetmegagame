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

const row = (id, characterId, zoneId, createdAtMs, kind = "TROUBLE", extra = {}) => ({ id, characterId, characterName: characterId.toUpperCase(), zoneId, zoneName: zoneId, createdAtMs, kind, die: kind === "TROUBLE" ? 1 : 3, locationName: `room-${id}`, resolvedAt: null, gmNotes: "", ...extra });

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

// ── Results by place (foldCavingResults, CAVING.md §5c) ──────────────────────────────────────────────

// A standing: where a character is now, and where they stood at the lock if the turn has locked.
const standing = (characterId, { now = null, at = null, live = true } = {}) => ({
  id: characterId,
  characterId,
  characterName: characterId.toUpperCase(),
  discordUsername: `@${characterId}`,
  nowLocationId: live ? now : null,
  nowLocationName: live && now ? `Place ${now}` : null,
  nowZoneName: live && now ? "Depths" : null,
  frozen: Boolean(at),
  standLocationId: at,
  standLocationName: at ? `Place ${at}` : null,
  standZoneId: at ? "depths" : null,
  standZoneName: at ? "Depths" : null,
  standAlert: false,
  hasStandSnapshot: Boolean(at),
});

test("before the lock a result names where the caver stands NOW, not where their newest 1 was", async () => {
  const { foldCavingResults } = await load();
  const { rows } = foldCavingResults(
    [row("a", "ada", "depths", 1), row("q", "ada", "depths", 2, "QUIET")],
    [standing("ada", { now: "L2" })],
  );
  const ada = rows.find((r) => r.id === "a");
  assert.equal(ada.locationName, "Place L2", "a 3 rolled after the 1 moved them");
  assert.equal(ada.merged, false);
  assert.equal(ada.members.length, 1);
  assert.equal(ada.members[0].severity, 1);
  assert.equal(ada.bystanders.length, 0);
});

test("a past turn with no stands falls back to the newest 1's place", async () => {
  const { foldCavingResults } = await load();
  const [ada] = foldCavingResults([row("a", "ada", "depths", 1)], [standing("ada", { live: false })]).rows;
  assert.equal(ada.locationName, "room-a");
});

test("at the lock everybody at one Location is one result, bystanders included, keyed by the oldest 1", async () => {
  const { foldCavingResults, severityLabel } = await load();
  const { rows, groupOf } = foldCavingResults(
    [
      row("b1", "bob", "depths", 5),
      row("a1", "ada", "depths", 10),
      row("a2", "ada", "depths", 20),
      row("c1", "cal", "depths", 30), // somewhere else
      row("q", "dee", "depths", 40, "QUIET"), // dee rolled, but no 1
    ],
    [
      standing("ada", { now: "L1", at: "L1" }),
      standing("bob", { now: "Town", at: "L1" }), // a GM moved him up after the lock
      standing("cal", { now: "L9", at: "L9" }),
      standing("dee", { now: "L1", at: "L1" }),
      standing("eve", { now: "L1", at: "L1" }), // never rolled at all
      standing("fay", { now: "L5", at: "L5" }), // alone, no 1s: no result
    ],
  );
  const troubles = rows.filter((r) => r.kind === "TROUBLE");
  assert.equal(troubles.length, 2, "L1 and L9; nobody failed at L5");
  const l1 = troubles.find((r) => r.locationName === "Place L1");
  assert.equal(l1.id, "b1", "the oldest 1 of anybody in it");
  assert.equal(l1.merged, true);
  assert.deepEqual(l1.memberIds, ["b1", "a1", "a2"]);
  assert.deepEqual(l1.members.map((m) => [m.characterId, m.severity]), [["ada", 2], ["bob", 1]], "worst first");
  assert.equal(l1.members.find((m) => m.characterId === "bob").nowLocationName, "Place Town");
  assert.deepEqual(l1.bystanders.map((b) => b.characterId), ["dee", "eve"]);
  assert.equal(l1.bystanders[0].severity, 0);
  assert.equal(l1.latestId, "a2");
  assert.equal(groupOf.get("a1"), "b1");
  assert.equal(groupOf.get("a2"), "b1");
  assert.equal(groupOf.get("c1"), "c1");
  assert.equal(severityLabel(l1), "ADA · Severity 2, BOB · Severity 1");
  assert.equal(rows.some((r) => r.id === "q"), true, "the QUIET roll is still listed on its own");
});

test("a merged result needs attention while any caver's 1 does, and reopens on a response written after it", async () => {
  const { foldCavingResults } = await load();
  const resolved = { resolvedAt: "2026-09-27T10:00:00.000Z", resolvedAtLabel: "2026-09-27 10:00", resolvedByUsername: "gm" };
  const stands = [standing("ada", { at: "L1" }), standing("bob", { at: "L1" })];
  const [done] = foldCavingResults([row("a", "ada", "d", 1, "TROUBLE", resolved), row("b", "bob", "d", 2, "TROUBLE", resolved)], stands).rows;
  assert.equal(done.statusLabel, "Resolved");

  const [open] = foldCavingResults([row("a", "ada", "d", 1, "TROUBLE", resolved), row("b", "bob", "d", 2)], stands).rows;
  assert.equal(open.statusLabel, "Needs attention");
  assert.equal(open.newSinceResolved, 1);

  const later = Date.parse(resolved.resolvedAt) + 60_000;
  const [answered] = foldCavingResults(
    [row("a", "ada", "d", 1, "TROUBLE", resolved), row("b", "bob", "d", 2, "TROUBLE", { ...resolved, response: "I hide", respondedAtMs: later })],
    stands,
  ).rows;
  assert.equal(answered.statusLabel, "Needs attention");
  assert.equal(answered.respondedSinceResolved, true);

  const pushed = { ...resolved, resolvedByUsername: null, autoResolved: true };
  const [auto] = foldCavingResults(
    [row("a", "ada", "d", 1, "TROUBLE", pushed), row("b", "bob", "d", 2, "TROUBLE", { ...pushed, response: "I hide", respondedAtMs: later })],
    stands,
  ).rows;
  assert.equal(auto.statusLabel, "Resolved", "the push let it go; the turn is over");
});

test("the merged Result box is the earliest caver's; the others keep theirs on their card", async () => {
  const { foldCavingResults } = await load();
  const [r] = foldCavingResults(
    [row("a", "ada", "d", 1, "TROUBLE", { gmNotes: "ada's" }), row("b", "bob", "d", 2, "TROUBLE", { gmNotes: "bob's" })],
    [standing("ada", { at: "L1" }), standing("bob", { at: "L1" })],
  ).rows;
  assert.equal(r.gmNotes, "ada's");
  assert.equal(r.members.find((m) => m.characterId === "bob").gmNotes, "bob's");
});

test("one caver stuck at 10 marks the merged result stuck", async () => {
  const { foldCavingResults } = await load();
  const rows = [...Array.from({ length: 10 }, (_, i) => row(`r${i}`, "ada", "d", i)), row("b", "bob", "d", 50)];
  const [r] = foldCavingResults(rows, [standing("ada", { at: "L1" }), standing("bob", { at: "L1" })]).rows;
  assert.equal(r.stuck, true);
  assert.equal(r.members.find((m) => m.characterId === "bob").stuck, false);
});
