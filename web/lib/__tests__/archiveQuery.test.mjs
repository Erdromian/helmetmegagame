// The /archive Day filter. It used to turn "Day N" into turns 2N-1 and 2N — the rule from when a turn was half a day —
// and so found the wrong rows at every turn length, 24 hours included. It now matches the day stamped on the row itself
// (ArchiveEntry.dayNumber, TURN-ENGINE.md), which is the only answer that holds when a day is one turn or four.

import assert from "node:assert/strict";
import test from "node:test";

import { archiveWhere, parseArchiveParams } from "../archiveQuery.js";

test("a Day filter matches the row's stamped day, never a turn number", () => {
  const where = archiveWhere("game-1", parseArchiveParams({ day: "3" }));
  assert.equal(where.dayNumber, 3);
  assert.equal(where.turnNumber, undefined);
});

test("no day, a zero or junk filters nothing by day", () => {
  for (const day of [undefined, "", "0", "-2", "soon"]) {
    const where = archiveWhere("game-1", parseArchiveParams(day === undefined ? {} : { day }));
    assert.equal(where.dayNumber, undefined, `day=${day}`);
  }
});
