// THE RULE: a fire is heard only in a room that has one. It used to be keyed on the whole
// Location, so the Old Cock Inn crackled on its Street and its Balcony, and the Keep — which
// has no fire in any room — crackled everywhere, while the Throne Room's hearth and the
// Slums' Firepit were silent. A room is heard while Chat has it open, so the resolver takes
// the open place key and honours it only for a room at the Location the character stands in.
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

test("the Inn's Bar has the fire, and so does nothing else at the Inn", () => {
  assert.ok(hasFire(resolveAmbience(INN, "room:r2")));
  assert.ok(!hasFire(resolveAmbience(INN, "room:r1")), "the Street");
  assert.ok(!hasFire(resolveAmbience(INN, "room:r4")), "the Balcony");
  assert.ok(!hasFire(resolveAmbience(INN, "loc:town-7-id")), "the Location itself");
  assert.ok(!hasFire(resolveAmbience(INN, null)), "Chat never opened");
});

test("every room at the Inn still hears the Inn's song", () => {
  for (const key of ["room:r1", "room:r2", null]) {
    assert.ok(resolveAmbience(INN, key).pieces.some((p) => p.src.endsWith("/song_game.ogg")), key);
  }
});

test("the Keep has no fire anywhere", () => {
  const keep = { locationSlug: "fortress-4", zoneSlug: "fortress", indoors: true, rooms: { k: "fortress-4-1" } };
  assert.ok(!hasFire(resolveAmbience(keep, null)));
  assert.ok(!hasFire(resolveAmbience(keep, "room:k")));
});

test("the Throne Room's hearth and the Slums' Firepit are heard", () => {
  const court = { locationSlug: "fortress-3", zoneSlug: "fortress", indoors: true, rooms: { t: "fortress-3-1" } };
  const throne = resolveAmbience(court, "room:t");
  assert.ok(hasFire(throne));
  // Still the Court's own bed and winds, with the fire beside them.
  const plain = resolveAmbience(court, null);
  assert.ok(!hasFire(plain));
  for (const piece of plain.pieces) assert.ok(throne.pieces.includes(piece));
  assert.deepEqual(throne.spots, plain.spots);

  const slums = { locationSlug: "undertown-a", zoneSlug: "undertown", indoors: true, rooms: { f: "undertown-a-1" } };
  assert.ok(hasFire(resolveAmbience(slums, "room:f")));
});

test("a room left behind at another Location does not follow the character", () => {
  // Chat still has the Bar open, but they have walked to the Keep: the Bar's id is not in
  // this Location's rooms, so it is not heard.
  const keep = { locationSlug: "fortress-4", zoneSlug: "fortress", indoors: true, rooms: { k: "fortress-4-1" } };
  assert.ok(!hasFire(resolveAmbience(keep, "room:r2")));
  // An older payload with no rooms at all falls through the same way.
  const { rooms: _drop, ...noRooms } = INN;
  assert.ok(!hasFire(resolveAmbience(noRooms, "room:r2")));
});

test("what the listener IS still outranks the room", () => {
  assert.equal(resolveAmbience({ ...INN, impaired: true }, "room:r2").id, "impaired");
  assert.equal(resolveAmbience({ ...INN, moodTone: "bad" }, "room:r2").id, "town-low");
});

test("room pools are listed for the sound report", () => {
  const ids = new Set(ALL_PLACES.map((p) => p.id));
  for (const id of ["inn-bar", "throne-room", "firepit"]) assert.ok(ids.has(id), id);
});
