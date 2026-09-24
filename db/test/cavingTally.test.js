// The Caving lens' count of 1s (web/lib/cavingLabels.js#troubleTallies) and the
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

const row = (id, characterId, zoneId, createdAtMs, kind = "TROUBLE") => ({ id, characterId, zoneId, createdAtMs, kind });

test("each TROUBLE row learns which 1 of the turn it is, per character and zone", async () => {
  const { troubleTallies, tallyLabel } = await load();
  const tallies = troubleTallies([
    row("b", "ada", "depths", 20),
    row("a", "ada", "depths", 10),
    row("q", "ada", "depths", 15, "QUIET"),
    row("c", "ada", "caves", 30), // another zone: its own count
    row("d", "bob", "depths", 5),
  ]);
  assert.deepEqual(tallies.get("a"), { nth: 1, total: 2, stuck: false });
  assert.deepEqual(tallies.get("b"), { nth: 2, total: 2, stuck: false });
  assert.deepEqual(tallies.get("c"), { nth: 1, total: 1, stuck: false });
  assert.deepEqual(tallies.get("d"), { nth: 1, total: 1, stuck: false });
  assert.equal(tallies.has("q"), false, "a QUIET roll is not a 1");

  assert.equal(tallyLabel(tallies.get("c")), null, "a lone 1 is the ordinary case and gets no count");
  assert.equal(tallyLabel(tallies.get("a")), "1st 1 this turn", "but the first of several is counted");
  assert.equal(tallyLabel(tallies.get("b")), "2nd 1 this turn");
  assert.equal(tallyLabel(null), null);
});

test("the tenth 1 marks every one of them stuck", async () => {
  const { troubleTallies, ordinal } = await load();
  const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "ada", "depths", i));
  const tallies = troubleTallies(rows);
  for (const r of rows) assert.equal(tallies.get(r.id).stuck, true);
  assert.equal(tallies.get("r9").nth, 10);
  assert.equal(troubleTallies(rows.slice(0, 9)).get("r8").stuck, false);

  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(21), "21st");
});
