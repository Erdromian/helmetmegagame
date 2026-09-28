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
  activeArchiveFilters,
  archiveWhere,
  locationKey,
  parseArchiveParams,
  parseLocationKey,
  parseRoomKey,
  prunePlaces,
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
    location: [locationKey("Town", "Old Town"), locationKey("Caves", "Hollow")],
    room: [roomKey("Town", "Old Town", "Tavern"), roomKey(null, null, "Ada's Party")],
    character: ["c1", "c2"],
  });
  const where = archiveWhere("g", f);
  assert.deepEqual(clause(where, "zoneName").zoneName, { in: ["Town", "Caves"] });
  assert.deepEqual(clause(where, "characterId").characterId, { in: ["c1", "c2"] });
  const locations = where.AND.find((c) => c.OR?.some((o) => "locationName" in o && !("threadName" in o)));
  assert.deepEqual(locations.OR, [
    { zoneName: "Town", locationName: "Old Town" },
    { zoneName: "Caves", locationName: "Hollow" },
  ]);
  const rooms = where.AND.find((c) => c.OR?.some((o) => "threadName" in o));
  assert.deepEqual(rooms.OR, [
    { zoneName: "Town", locationName: "Old Town", threadName: "Tavern" },
    { zoneName: null, locationName: null, threadName: "Ada's Party" },
  ]);
});

test("a single value still reads, the way Next hands it over", () => {
  const f = parseArchiveParams({ zone: "Town", character: "c1" });
  assert.deepEqual(f.zones, ["Town"]);
  assert.deepEqual(f.characters, ["c1"]);
});

test("a room key survives a room name with the separator in it", () => {
  // Only the last part may hold one: zone and Location names never do, a room name might.
  assert.deepEqual(parseRoomKey(roomKey("Town", "Old Town", "Rat | Crown")), {
    zoneName: "Town",
    locationName: "Old Town",
    threadName: "Rat | Crown",
  });
  assert.equal(parseRoomKey("no separator"), null);
  assert.equal(parseRoomKey("Town|Old Town|"), null);
  assert.deepEqual(parseLocationKey(locationKey("Town", "Old Town")), { zoneName: "Town", locationName: "Old Town" });
  assert.equal(parseLocationKey("Town|"), null);
});

test("places narrow downward, and a change above drops what it leaves outside", () => {
  const pub = locationKey("Town", "Old Town");
  const hollow = locationKey("Caves", "Hollow");
  const tavern = roomKey("Town", "Old Town", "Tavern");
  const cellar = roomKey("Town", "Square", "Cellar");
  const den = roomKey("Caves", "Hollow", "Den");
  const party = roomKey(null, null, "Ada's Party");
  const all = { locations: [pub, hollow], rooms: [tavern, cellar, den, party] };

  // Nothing picked above: everything stays.
  assert.deepEqual(prunePlaces({ zones: [], locations: [], rooms: all.rooms }).rooms, all.rooms);
  // A zone keeps its own Locations, and (with no Location picked) its own rooms.
  assert.deepEqual(prunePlaces({ zones: ["Town"], locations: [], rooms: all.rooms }).rooms, [tavern, cellar]);
  assert.deepEqual(prunePlaces({ zones: ["Town"], ...all }).locations, [pub]);
  // A Location keeps only its own rooms, over the zone.
  assert.deepEqual(prunePlaces({ zones: ["Town"], ...all }).rooms, [tavern]);
  assert.deepEqual(prunePlaces({ zones: [], ...all }).rooms, [tavern, den]);
});

test("taking a zone chip off takes its Locations and rooms with it", () => {
  const f = parseArchiveParams({
    zone: ["Town", "Caves"],
    location: [locationKey("Town", "Old Town")],
    room: [roomKey("Town", "Old Town", "Tavern")],
  });
  const chip = activeArchiveFilters(f).find((c) => c.key === "zone:Town");
  assert.deepEqual(chip.clear, { zone: ["Caves"], location: [], room: [] });
  // The last zone going leaves nothing above, so the Location stays.
  const one = parseArchiveParams({ zone: "Town", location: locationKey("Town", "Old Town") });
  assert.deepEqual(activeArchiveFilters(one).find((c) => c.key === "zone:Town").clear.location, [locationKey("Town", "Old Town")]);
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
  const f = parseArchiveParams({
    zone: ["Town", "Caves"],
    location: [locationKey("Town", "Old Town"), locationKey("Caves", "Hollow")],
    room: [roomKey("Town", "Old Town", "Tavern")],
    actions: "1",
    from: "2",
  });
  const qs = archiveParamsToQuery(f);
  const back = parseArchiveParams(searchParamsObject(new URLSearchParams(qs)));
  assert.deepEqual(back.zones, ["Town", "Caves"]);
  assert.deepEqual(back.locations, [locationKey("Town", "Old Town"), locationKey("Caves", "Hollow")]);
  assert.deepEqual(back.rooms, [roomKey("Town", "Old Town", "Tavern")]);
  assert.equal(back.actions, true);
  assert.equal(back.from, 2);
  // Defaults stay out of the link.
  assert.doesNotMatch(archiveParamsToQuery(parseArchiveParams({})), /show|order|actions/);
});
