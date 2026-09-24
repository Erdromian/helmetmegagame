// Where the portraits go. A face heads every RUN — one speaker's consecutive
// lines — not just the first line a speaker ever said in the scene. The rebuilt
// feed once compared `speakerKey`, which the server only sets on a hooded row,
// so a named-to-named change of speaker was invisible to it.

import assert from "node:assert/strict";
import test from "node:test";

import { RUN_GAP_MS, startsRun } from "../feedRuns.js";

const T0 = Date.parse("2026-09-23T12:00:00Z");
const at = (ms) => new Date(T0 + ms).toISOString();
const said = (characterId, offsetMs, extra = {}) => ({
  characterId,
  speakerKey: null,
  name: `Character ${characterId}`,
  source: "WEB",
  sentAt: at(offsetMs),
  ...extra,
});

function runStarts(rows) {
  return rows.map((row, i) => startsRun(i > 0 ? rows[i - 1] : null, row));
}

test("the first line of a scene starts a run", () => {
  assert.equal(startsRun(null, said("a", 0)), true);
});

test("one person talking in several messages is one run", () => {
  assert.deepEqual(runStarts([said("a", 0), said("a", 1000), said("a", 2000)]), [true, false, false]);
});

test("alternating speakers start a run on every change, named rows included", () => {
  const rows = [said("a", 0), said("b", 1000), said("a", 2000), said("a", 3000), said("b", 4000)];
  assert.deepEqual(runStarts(rows), [true, true, true, false, true]);
});

test("hooded rows group by speakerKey, and a hood is not the named speaker", () => {
  const hood = (key, ms) => ({ characterId: null, speakerKey: key, name: "Hooded Figure", alias: "Hooded Figure", source: "WEB", sentAt: at(ms) });
  assert.deepEqual(runStarts([hood("k1", 0), hood("k1", 1000), hood("k2", 2000), said("a", 3000)]), [true, false, true, true]);
});

test("a long silence starts a run from the same mouth", () => {
  assert.deepEqual(runStarts([said("a", 0), said("a", RUN_GAP_MS), said("a", 2 * RUN_GAP_MS + 1)]), [true, false, true]);
});

test("the world speaking breaks a run on both sides", () => {
  const system = (ms) => ({ characterId: null, speakerKey: null, name: null, source: "SYSTEM", sentAt: at(ms) });
  assert.deepEqual(runStarts([said("a", 0), system(1000), said("a", 2000)]), [true, true, true]);
});
