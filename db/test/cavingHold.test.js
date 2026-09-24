// The hold a Caving 1 puts on a caver for the rest of the turn
// (docs/systemdocs/CAVING.md §2c), and the stop ten of them put on them (§2e).
// Both are one query rather than a pure comparison, so prisma is stubbed down
// to the one call each function makes — which also pins the WHERE, since the
// whole rule is in it: this character, this zone, TROUBLE, in the turn that is
// still open.
const test = require("node:test");
const assert = require("node:assert");

const {
  cavingRestrictionsFor,
  cavingHoldFor,
  cavingPartyRestrictions,
  cavingHeldIds,
  CAVING_HOLD_REASON,
  CAVING_STUCK_REASON,
  CAVING_TROUBLE_CAP,
} = require("../lib/cavingPass");
const { resolveNeighbors, routesWithinZone } = require("../lib/locationGraph");

// `rows` is every TROUBLE row the stub holds; count() and findMany() both read it.
function stubRolls(rows) {
  const seen = [];
  return {
    seen,
    cavingRoll: {
      count: async ({ where }) => {
        seen.push(where);
        return rows.length;
      },
      findMany: async ({ where }) => {
        seen.push(where);
        return rows;
      },
    },
  };
}

const ones = (n, characterId = "char1") => Array.from({ length: n }, (_, i) => ({ id: `roll${i}`, characterId }));

test("a TROUBLE row in this zone on the open turn is the refusal", async () => {
  const db = stubRolls(ones(1));
  assert.equal(await cavingHoldFor(db, "char1", "depths"), CAVING_HOLD_REASON);
  // The whole rule is the WHERE. A QUIET row, a 1 rolled in some other zone, or
  // one from a turn already pushed must not come back from it — and NOT
  // resolvedAt: a GM's Mark resolved decides the encounter, but what was
  // decided only reaches the caver at the push, so it must not free them.
  assert.deepEqual(db.seen[0], {
    characterId: "char1",
    zoneId: "depths",
    kind: "TROUBLE",
    turn: { status: "OPEN" },
  });
});

test("no row means they may walk", async () => {
  assert.equal(await cavingHoldFor(stubRolls([]), "char1", "depths"), null);
  assert.deepEqual(await cavingRestrictionsFor(stubRolls([]), "char1", "depths"), { hold: null, stuck: null });
});

test("nowhere to be held from is not a hold", async () => {
  const db = stubRolls(ones(1));
  assert.equal(await cavingHoldFor(db, "char1", null), null);
  assert.equal(await cavingHoldFor(db, null, "depths"), null);
  assert.equal(db.seen.length, 0, "neither should have asked the database at all");
});

test("ten 1s this turn is the stop, and one query answers both", async () => {
  assert.equal(CAVING_TROUBLE_CAP, 10);
  const nine = stubRolls(ones(9));
  assert.deepEqual(await cavingRestrictionsFor(nine, "char1", "depths"), { hold: CAVING_HOLD_REASON, stuck: null });
  assert.equal(nine.seen.length, 1);

  const ten = stubRolls(ones(10));
  assert.deepEqual(await cavingRestrictionsFor(ten, "char1", "depths"), {
    hold: CAVING_HOLD_REASON,
    stuck: CAVING_STUCK_REASON,
  });
  assert.equal(ten.seen.length, 1);
  // The same WHERE as the hold — a stop is the hold's own rows counted higher, nothing new.
  assert.deepEqual(ten.seen[0], { characterId: "char1", zoneId: "depths", kind: "TROUBLE", turn: { status: "OPEN" } });

  // Well past it is still it.
  assert.equal((await cavingRestrictionsFor(stubRolls(ones(14)), "char1", "depths")).stuck, CAVING_STUCK_REASON);
});

test("the party question is one query, and an empty party asks nothing", async () => {
  const db = stubRolls([{ characterId: "b" }]);
  const held = await cavingHeldIds(db, ["a", "b"], "depths");
  assert.equal(held.has("b"), true);
  assert.equal(held.has("a"), false);
  assert.equal(db.seen.length, 1);

  const empty = stubRolls([{ characterId: "b" }]);
  assert.equal((await cavingHeldIds(empty, [], "depths")).size, 0);
  assert.equal(empty.seen.length, 0);
});

test("the party question tells a held follower from a stopped one", async () => {
  const db = stubRolls([...ones(1, "a"), ...ones(10, "b")]);
  const { held, stuck } = await cavingPartyRestrictions(db, ["a", "b", "c"], "depths");
  assert.deepEqual([...held].sort(), ["a", "b"]);
  assert.deepEqual([...stuck], ["b"], "stuck is a subset of held");
  assert.equal(db.seen.length, 1);
});

// --- The picker: a hold takes the ways out of the zone, leaves the level open; a stop takes them all ---
const ZONES = {
  depths: { sortOrder: 0, name: "depths", kind: "CAVE_LEVEL" },
  town: { sortOrder: 1, name: "town", kind: "SURFACE" },
};
const loc = (id, zoneId) => ({ id, zoneId, name: id, sortOrder: 0, zone: ZONES[zoneId] });

function stubGraph({ rolls }) {
  const seen = [];
  return {
    seen,
    locationLink: {
      // The same WHERE linksFor sends: every edge touching the one location.
      findMany: async ({ where }) => {
        const at = where.OR[0].aId;
        return [
          { aId: "tunnel", bId: "gallery", a: loc("tunnel", "depths"), b: loc("gallery", "depths") },
          { aId: "tunnel", bId: "road", a: loc("tunnel", "depths"), b: loc("road", "town") },
          { aId: "road", bId: "square", a: loc("road", "town"), b: loc("square", "town") },
        ].filter((link) => link.aId === at || link.bId === at);
      },
    },
    cavingRoll: {
      count: async ({ where }) => {
        seen.push(where);
        return rolls;
      },
    },
  };
}

const CAVER = { id: "char1", zoneId: "depths", tags: [] };

test("a held caver may still walk the level, but not out of it", async () => {
  const rows = await resolveNeighbors(stubGraph({ rolls: 1 }), CAVER, "tunnel");
  const byId = Object.fromEntries(rows.map((r) => [r.location.id, r]));

  assert.equal(byId.gallery.passable, true, "the next room along stays open");
  assert.equal(byId.gallery.refusal, null);

  assert.equal(byId.road.passable, false, "the way out is shut");
  assert.equal(byId.road.refusal, CAVING_HOLD_REASON);
  assert.equal(byId.road.listed, true); // shut, not gone — same shape a locked gate uses
});

test("with the roll resolved, the way out opens again", async () => {
  const rows = await resolveNeighbors(stubGraph({ rolls: 0 }), CAVER, "tunnel");
  for (const row of rows) {
    assert.equal(row.passable, true);
    assert.equal(row.refusal, null);
  }
});

test("ten 1s shut every way in the picker, the next room included, in their own words", async () => {
  const rows = await resolveNeighbors(stubGraph({ rolls: 10 }), CAVER, "tunnel");
  const byId = Object.fromEntries(rows.map((r) => [r.location.id, r]));
  assert.equal(byId.gallery.passable, false);
  assert.equal(byId.gallery.refusal, CAVING_STUCK_REASON);
  assert.equal(byId.road.passable, false);
  assert.equal(byId.road.refusal, CAVING_STUCK_REASON);
  assert.equal(byId.gallery.listed, true);
});

test("a surface picker never asks the Die", async () => {
  // Standing on the road in Town, one way leads underground. A 1 can only ever
  // be rolled in a CAVE_LEVEL zone, so there is nothing to look up.
  const db = stubGraph({ rolls: 10 });
  const rows = await resolveNeighbors(db, { id: "char1", zoneId: "town", tags: [] }, "square");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].passable, true);
  assert.equal(db.seen.length, 0);
});

// --- The walk: ten 1s and there is no walk at all ---
function stubWalk({ rolls }) {
  const seen = [];
  const places = [loc("tunnel", "depths"), loc("gallery", "depths"), loc("shaft", "depths")].map((p) => ({
    ...p,
    slug: p.id,
    description: null,
    indoors: false,
    attributes: {},
    retiredAt: null,
  }));
  const way = (aId, bId) => ({
    id: `${aId}~${bId}`, aId, bId, hidden: false, requiredTagSlug: null, modular: false, isOpen: true,
    keyed: false, onFoot: false, tightSqueeze: false, openUntil: null,
  });
  return {
    seen,
    locationLink: { findMany: async () => [way("tunnel", "gallery"), way("gallery", "shaft")] },
    location: { findMany: async ({ where }) => places.filter((l) => l.zoneId === where.zoneId) },
    characterTag: { findMany: async () => [] },
    cavingRoll: {
      count: async ({ where }) => {
        seen.push(where);
        return rolls;
      },
    },
  };
}

const WALKER = { id: "char1", locationId: "tunnel", zoneId: "depths", tags: [], heldUntil: null };
const KNOWN = new Set(["tunnel", "gallery", "shaft"]);

test("a held caver still gets the walk; a stopped one gets none", async () => {
  const held = stubWalk({ rolls: 3 });
  const routes = await routesWithinZone(held, WALKER, { known: KNOWN });
  assert.deepEqual(routes.map((r) => r.location.id).sort(), ["gallery", "shaft"]);

  const stuck = stubWalk({ rolls: 10 });
  assert.deepEqual(await routesWithinZone(stuck, WALKER, { known: KNOWN }), []);
  assert.equal(stuck.seen.length, 1, "asked once, up front");
});
