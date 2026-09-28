// The /archive filters (web/lib/archiveQuery.js, ARCHIVE.md §5).
//
// The Day filter used to turn "Day N" into turns 2N-1 and 2N — the rule from when a turn was half a day —
// and so found the wrong rows at every turn length, 24 hours included. It matches the day stamped on the row itself
// (ArchiveEntry.dayNumber, TURN-ENGINE.md), which is the only answer that holds when a day is one turn or four.

import assert from "node:assert/strict";
import test from "node:test";

import {
  archivePageWhere,
  archiveParamsToQuery,
  archiveWhere,
  parseArchiveParams,
  parseRoomKey,
  roomKey,
  searchParamsObject,
} from "../archiveQuery.js";

// The clause in `where.AND` that constrains `field`, or undefined.
const clause = (where, field) => where.AND.find((c) => field in c);

test("a Day filter matches the row's stamped day, never a turn number", () => {
  const where = archiveWhere("game-1", parseArchiveParams({ day: "3" }));
  assert.deepEqual(clause(where, "dayNumber").dayNumber, { gte: 3, lte: 3 });
  assert.equal(clause(where, "turnNumber"), undefined);
});

test("no day, a zero or junk filters nothing by day", () => {
  for (const day of [undefined, "", "0", "-2", "soon"]) {
    const where = archiveWhere("game-1", parseArchiveParams(day === undefined ? {} : { day }));
    assert.equal(clause(where, "dayNumber"), undefined, `day=${day}`);
  }
});

test("a day range, either end open, and backwards is turned round", () => {
  const range = (p) => clause(archiveWhere("g", parseArchiveParams(p)), "dayNumber")?.dayNumber;
  assert.deepEqual(range({ from: "2", to: "5" }), { gte: 2, lte: 5 });
  assert.deepEqual(range({ from: "4" }), { gte: 4 });
  assert.deepEqual(range({ to: "4" }), { lte: 4 });
  assert.deepEqual(range({ from: "5", to: "2" }), { gte: 2, lte: 5 });
});

test("several values are OR within a filter and AND across filters", () => {
  const f = parseArchiveParams({
    zone: ["Town", "Caves"],
    room: [roomKey("Town", "Tavern"), roomKey(null, "Ada's Party")],
    character: ["c1", "c2"],
  });
  const where = archiveWhere("g", f);
  assert.deepEqual(clause(where, "zoneName").zoneName, { in: ["Town", "Caves"] });
  assert.deepEqual(clause(where, "characterId").characterId, { in: ["c1", "c2"] });
  const rooms = where.AND.find((c) => c.OR?.some((o) => "threadName" in o));
  assert.deepEqual(rooms.OR, [
    { zoneName: "Town", threadName: "Tavern" },
    { zoneName: null, threadName: "Ada's Party" },
  ]);
});

test("a single value still reads, the way Next hands it over", () => {
  const f = parseArchiveParams({ zone: "Town", character: "c1" });
  assert.deepEqual(f.zones, ["Town"]);
  assert.deepEqual(f.characters, ["c1"]);
});

test("a room key survives a room name with the separator in it", () => {
  // Split at the FIRST |: a zone name never holds one, a room name might.
  assert.deepEqual(parseRoomKey(roomKey("Town", "Rat | Crown")), { zoneName: "Town", threadName: "Rat | Crown" });
  assert.equal(parseRoomKey("no separator"), null);
  assert.equal(parseRoomKey("Town|"), null);
});

test("actions are hidden unless asked for, in both views", () => {
  const kinds = (p) => JSON.stringify(archiveWhere("g", parseArchiveParams(p)).AND);
  // Speech names the kinds it wants, so leaving ACTION off that list is enough.
  assert.doesNotMatch(kinds({}), /ACTION/);
  // Everything names none, so it has to say so.
  assert.match(kinds({ show: "all" }), /"not":"ACTION"/);

  assert.match(kinds({ actions: "1" }), /"kind":"ACTION"/);
  assert.doesNotMatch(kinds({ actions: "1", show: "all" }), /ACTION/);
});

test("Speech survives the cursor: a scroll past the first screen keeps both", () => {
  const f = parseArchiveParams({});
  const where = archivePageWhere("g", f, "2026-09-01T00:00:00.000Z|abc");
  const ors = where.AND.filter((c) => c.OR);
  // One OR is Speech (by kind), the other is the cursor (by sentAt).
  assert.equal(ors.length, 2);
  assert.ok(ors.some((c) => c.OR.some((o) => o.kind === "TURN_START")));
  assert.ok(ors.some((c) => c.OR.some((o) => "sentAt" in o)));
});

test("the query string round-trips every repeated value", () => {
  const f = parseArchiveParams({ zone: ["Town", "Caves"], room: [roomKey("Town", "Tavern")], actions: "1", from: "2" });
  const qs = archiveParamsToQuery(f);
  const back = parseArchiveParams(searchParamsObject(new URLSearchParams(qs)));
  assert.deepEqual(back.zones, ["Town", "Caves"]);
  assert.deepEqual(back.rooms, [roomKey("Town", "Tavern")]);
  assert.equal(back.actions, true);
  assert.equal(back.from, 2);
  // Defaults stay out of the link.
  assert.doesNotMatch(archiveParamsToQuery(parseArchiveParams({})), /show|order|actions/);
});
