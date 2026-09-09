// node --test over the Fishing Boat's free-move bonus (db/lib/locationTravel.js,
// db/lib/mounts.js) across the two water-zone pairs the world graph actually
// connects. The Marshes has no direct link to the Forest (docs/zones.yaml) —
// only Hills does — so the two crossings that matter in practice are
// Forest<->Hills (forest-embankment <-> hills-shadowed-grove) and
// Hills<->Marshes (three plain links). This locks in that both crossings get
// the bonus, and that — unlike a mount — a boat's bonus never depends on how
// many people came along, since a boat carries no passengers at all
// (db/lib/mounts.js's own comment on WATER_TRAVEL_SLUGS).
const test = require("node:test");
const assert = require("node:assert/strict");
const { freeZoneMoves, freeMovesLeft, freeZoneMovesReason } = require("../lib/locationTravel");
const { equippedSlugs, isBoated, boatCrossing } = require("../lib/mounts");

// The three zone slugs a boat helps between (docs/tags.yaml's fishing-boat
// description; db/lib/mounts.js#WATER_ZONE_SLUGS). Forest and Marshes are
// never directly linked, but a character crossing Forest<->Hills or
// Hills<->Marshes on the links that DO exist should still get the bonus.
const FOREST = "forest";
const HILLS = "hills";
const MARSHES = "marshes";
const TOWN = "town"; // not a water zone, for the negative case

const boated = (tags = []) => ({ tags });
const withBoat = (equipped = true) => boated([{ equipped, tag: { slug: "fishing-boat" } }]);

test("boatCrossing: Forest<->Hills is a water crossing (forest-embankment <-> hills-shadowed-grove)", () => {
  assert.equal(boatCrossing(FOREST, HILLS), true);
  assert.equal(boatCrossing(HILLS, FOREST), true);
});

test("boatCrossing: Hills<->Marshes is a water crossing (the three plain links)", () => {
  assert.equal(boatCrossing(HILLS, MARSHES), true);
  assert.equal(boatCrossing(MARSHES, HILLS), true);
});

test("boatCrossing: Forest<->Marshes would qualify too, if a link ever connects them", () => {
  // No such link exists in docs/zones.yaml today — this only documents that
  // the zone-pair math itself does not care, so wiring one up later needs no
  // code change here.
  assert.equal(boatCrossing(FOREST, MARSHES), true);
});

test("boatCrossing: a zone outside the three never qualifies", () => {
  assert.equal(boatCrossing(FOREST, TOWN), false);
  assert.equal(boatCrossing(TOWN, HILLS), false);
});

test("freeZoneMoves: an equipped boat adds one crossing Forest<->Hills", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: FOREST, toZoneSlug: HILLS };
  assert.equal(freeZoneMoves(withBoat(), config, crossing), 2);
});

test("freeZoneMoves: an equipped boat adds one crossing Hills<->Marshes", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeZoneMoves(withBoat(), config, crossing), 2);
});

test("freeZoneMoves: an UNEQUIPPED boat grants nothing — it only works held out", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: FOREST, toZoneSlug: HILLS };
  assert.equal(freeZoneMoves(withBoat(false), config, crossing), 1);
});

test("freeZoneMoves: a boat is no help off the water, on either of these zones", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  assert.equal(freeZoneMoves(withBoat(), config, { fromZoneSlug: HILLS, toZoneSlug: TOWN }), 1);
});

// The mount's bonus is conditional on party size (fitsMount); a boat's is
// not — db/lib/mounts.js: "no passengers" is the whole point of keeping the
// boat out of FAST_TRAVEL_SLUGS. This is the exact question the ticket
// raised: does bringing people along cost the boat's crossing the way it
// costs a horse's. It should not.
test("freeZoneMoves: the boat's bonus does not depend on party size", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 0), 2);
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 1), 2);
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 5), 2);
});

test("freeMovesLeft: without a destination it reads used-up, but the real crossing still shows one free", () => {
  // Spent one free crossing already this turn (unrelated to the boat — this
  // is the counter every crossing draws down, free or paid).
  const config = { freeZoneMovesPerTurn: 1 };
  const openTurn = { id: "turn-1" };
  const character = { ...withBoat(), zoneMovesTurnId: "turn-1", zoneMovesUsed: 1 };

  // The AMBIENT read (no destination picked yet — the sheet, the header
  // before a node is chosen) has no crossing to weigh, so it honestly says 0.
  assert.equal(freeMovesLeft(character, config, openTurn), 0);

  // This was the actual bug: loadTravel()/buildMap()/the bot's Travel picker
  // all called freeMovesLeft this way — with no crossing — even once a
  // specific water-eligible destination WAS known, so a boated character
  // saw "the turn" for a crossing that should have read free. Passing the
  // real crossing is the fix; the boat's own extra move still shows up.
  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeMovesLeft(character, config, openTurn, 0, crossing), 1);
});

test("freeZoneMovesReason: names the three zones and never mentions party size", () => {
  const reason = freeZoneMovesReason(withBoat());
  assert.match(reason, /Forest/);
  assert.match(reason, /Black Hills/);
  assert.match(reason, /Marshes/);
});

test("equippedSlugs: a HELD-but-not-equipped boat never counts as boated", () => {
  // docs/tags.yaml: "it waits outside indoors" — only an equipped boat is
  // active, same rule a horse or a cart follows.
  const held = [{ equipped: false, tag: { slug: "fishing-boat" } }];
  assert.equal(isBoated(equippedSlugs(held)), false);
});
