// THE RULE: the fire is not ambience anywhere. `newfireloop.ogg` used to be a bed on the
// whole Old Cock Inn and the whole Keep, and then on the rooms with a fire written into
// them (the Inn's Bar, the Throne Room, the Firepit). It is far too intense for any of
// them, so it is kept for a fire that is out of control (docs/sounds.yaml, `needs`).
//
// A room is heard while Chat has it open, so the resolver takes the open place key and
// honours it only for a room at the Location the character stands in. BY_ROOM is empty
// now, so every room hears its Location.
//
// placeAmbience.js imports nothing, so it loads from plain Node (scripts/audio/sound-report.mjs
// does the same).

import assert from "node:assert/strict";
import test from "node:test";

const { resolveAmbience, ALL_PLACES } = await import("../../app/components/placeAmbience.js");

const hasFire = (pool) => pool.pieces.some((p) => p.src.endsWith("/newfireloop.ogg"));

// What web/lib/gamePhase.js#standingFor hands the client, trimmed to what matters here.
const INN = {
  locationSlug: "town-7",
  zoneSlug: "town",
  indoors: true,
  attributes: ["haven", "kitchen"],
  rooms: { r1: "town-7-1", r2: "town-7-2", r4: "town-7-4" },
};

test("no pool anywhere plays the fire", () => {
  for (const pool of ALL_PLACES) {
    assert.ok(!hasFire(pool), pool.id);
    assert.ok(!pool.spots.some((p) => p.src.endsWith("/newfireloop.ogg")), pool.id);
  }
});

test("every room at the Inn hears the Inn's song, the Bar included", () => {
  for (const key of ["room:r1", "room:r2", "room:r4", "loc:town-7-id", null]) {
    const pool = resolveAmbience(INN, key);
    assert.equal(pool.id, "inn", key);
    assert.ok(pool.pieces.some((p) => p.src.endsWith("/song_game.ogg")), key);
  }
});

test("the Throne Room and the Firepit hear their Location", () => {
  const court = { locationSlug: "fortress-3", zoneSlug: "fortress", indoors: true, rooms: { t: "fortress-3-1" } };
  assert.equal(resolveAmbience(court, "room:t").id, resolveAmbience(court, null).id);

  const slums = { locationSlug: "undertown-a", zoneSlug: "undertown", indoors: true, rooms: { f: "undertown-a-1" } };
  assert.equal(resolveAmbience(slums, "room:f").id, resolveAmbience(slums, null).id);
});

test("a room left behind at another Location does not follow the character", () => {
  // Chat still has the Inn's Bar open, but they have walked to the Keep.
  const keep = { locationSlug: "fortress-4", zoneSlug: "fortress", indoors: true, rooms: { k: "fortress-4-1" } };
  assert.equal(resolveAmbience(keep, "room:r2").id, "keep");
  // An older payload with no rooms at all falls through the same way.
  const { rooms: _drop, ...noRooms } = INN;
  assert.equal(resolveAmbience(noRooms, "room:r2").id, "inn");
});

test("what the listener IS still outranks the room", () => {
  assert.equal(resolveAmbience({ ...INN, impaired: true }, "room:r2").id, "impaired");
  assert.equal(resolveAmbience({ ...INN, moodTone: "bad" }, "room:r2").id, "town-low");
});
