// The hold a Caving 1 puts on a caver for the rest of the turn
// (docs/systemdocs/CAVING.md §2c), the stop a result of severity 10 puts on
// them (§2e), and the turn lock that shuts the caves and only the caves — all from
// Bascinet's Caving.docx. The Die's rules are one query rather than a pure
// comparison, so prisma is stubbed down to the one call each function makes —
// which also pins the WHERE, since the whole rule is in it: this character,
// TROUBLE, in the turn that is still open, in any zone.
const test = require("node:test");
const assert = require("node:assert");

const {
  cavingRestrictionsFor,
  cavingRefusalFor,
  cavingPartyRestrictions,
  standingZoneKind,
  CAVING_HOLD_REASON,
  CAVING_STUCK_REASON,
  CAVING_TROUBLE_CAP,
} = require("../lib/cavingPass");
const { resolveNeighbors, routesWithinZone } = require("../lib/locationGraph");
const { travelLockReason, lockedTravelSentence, CAVING_TRAVEL_LOCKED } = require("../lib/turnGate");

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

test("a 1 on the open turn, in any zone, is the hold", async () => {
  const db = stubRolls(ones(1));
  assert.deepEqual(await cavingRestrictionsFor(db, "char1", "CAVE_LEVEL"), { hold: CAVING_HOLD_REASON, stuck: null });
  // The whole rule is the WHERE. A QUIET row, or one from a turn already pushed,
  // must not come back from it — and NOT resolvedAt: a GM's Mark resolved
  // decides the encounter, but what was decided only reaches the caver at the
  // push, so it must not free them. No zone either: a 1 in the Caves still
  // counts once they are down in the Depths (Caving.docx).
  assert.deepEqual(db.seen[0], { characterId: "char1", kind: "TROUBLE", turn: { status: "OPEN" } });
});

test("no row means they may walk", async () => {
  assert.deepEqual(await cavingRestrictionsFor(stubRolls([]), "char1", "CAVE_LEVEL"), { hold: null, stuck: null });
});

test("on the surface the Die has nothing to say, and is not asked", async () => {
  const db = stubRolls(ones(10));
  assert.deepEqual(await cavingRestrictionsFor(db, "char1", "SURFACE"), { hold: null, stuck: null });
  assert.deepEqual(await cavingRestrictionsFor(db, "char1", null), { hold: null, stuck: null });
  assert.deepEqual(await cavingRestrictionsFor(db, null, "CAVE_LEVEL"), { hold: null, stuck: null });
  assert.equal(db.seen.length, 0, "none of these should have asked the database at all");
});

test("severity 10 is the stop, and one query answers both", async () => {
  assert.equal(CAVING_TROUBLE_CAP, 10);
  const nine = stubRolls(ones(9));
  assert.deepEqual(await cavingRestrictionsFor(nine, "char1", "CAVE_LEVEL"), { hold: CAVING_HOLD_REASON, stuck: null });
  assert.equal(nine.seen.length, 1);

  const ten = stubRolls(ones(10));
  assert.deepEqual(await cavingRestrictionsFor(ten, "char1", "CAVE_LEVEL"), {
    hold: CAVING_HOLD_REASON,
    stuck: CAVING_STUCK_REASON,
  });
  assert.equal(ten.seen.length, 1);

  // Well past it is still it.
  assert.equal((await cavingRestrictionsFor(stubRolls(ones(14)), "char1", "CAVE_LEVEL")).stuck, CAVING_STUCK_REASON);
});

test("the stop says what Caving.docx says", () => {
  assert.equal(
    CAVING_STUCK_REASON,
    "You are too worn out to keep going, best to hunker down and prepare for whatever evil awaits.",
  );
});

test("a move is refused by the stop anywhere, by the hold only on the way up", () => {
  const held = { hold: CAVING_HOLD_REASON, stuck: null };
  assert.equal(cavingRefusalFor(held, "CAVE_LEVEL"), null, "the Caves and the Depths stay open to each other");
  assert.equal(cavingRefusalFor(held, "SURFACE"), CAVING_HOLD_REASON);
  const stuck = { hold: CAVING_HOLD_REASON, stuck: CAVING_STUCK_REASON };
  assert.equal(cavingRefusalFor(stuck, "CAVE_LEVEL"), CAVING_STUCK_REASON);
  assert.equal(cavingRefusalFor(stuck, "SURFACE"), CAVING_STUCK_REASON);
  assert.equal(cavingRefusalFor({ hold: null, stuck: null }, "SURFACE"), null);
});

test("the party question is one query, and an empty party or the surface asks nothing", async () => {
  const db = stubRolls([{ characterId: "b" }]);
  const { held } = await cavingPartyRestrictions(db, ["a", "b"], "CAVE_LEVEL");
  assert.equal(held.has("b"), true);
  assert.equal(held.has("a"), false);
  assert.equal(db.seen.length, 1);
  assert.deepEqual(db.seen[0], { characterId: { in: ["a", "b"] }, kind: "TROUBLE", turn: { status: "OPEN" } });

  const empty = stubRolls([{ characterId: "b" }]);
  assert.equal((await cavingPartyRestrictions(empty, [], "CAVE_LEVEL")).held.size, 0);
  assert.equal((await cavingPartyRestrictions(empty, ["b"], "SURFACE")).held.size, 0);
  assert.equal(empty.seen.length, 0);
});

test("the party question tells a held follower from a stopped one", async () => {
  const db = stubRolls([...ones(1, "a"), ...ones(10, "b")]);
  const { held, stuck } = await cavingPartyRestrictions(db, ["a", "b", "c"], "CAVE_LEVEL");
  assert.deepEqual([...held].sort(), ["a", "b"]);
  assert.deepEqual([...stuck], ["b"], "stuck is a subset of held");
  assert.equal(db.seen.length, 1);
});

test("standingZoneKind uses what is loaded, and reads Zone only when it must", async () => {
  let reads = 0;
  const db = {
    zone: {
      findUnique: async ({ where }) => {
        reads += 1;
        return where.id === "depths" ? { kind: "CAVE_LEVEL" } : null;
      },
    },
  };
  assert.equal(await standingZoneKind(db, { zone: { kind: "SURFACE" }, zoneId: "depths" }), "SURFACE");
  assert.equal(await standingZoneKind(db, { location: { zone: { kind: "CAVE_LEVEL" } } }), "CAVE_LEVEL");
  assert.equal(reads, 0);
  assert.equal(await standingZoneKind(db, { zoneId: "depths" }), "CAVE_LEVEL");
  assert.equal(await standingZoneKind(db, {}), null);
  assert.equal(reads, 1);
});

// --- The picker: a hold takes the ways up to the surface, leaves the caves open; a stop takes them all ---
const ZONES = {
  caves: { sortOrder: 0, name: "caves", kind: "CAVE_LEVEL" },
  depths: { sortOrder: 1, name: "depths", kind: "CAVE_LEVEL" },
  town: { sortOrder: 2, name: "town", kind: "SURFACE" },
};
const loc = (id, zoneId) => ({ id, zoneId, name: id, sortOrder: 0, zone: ZONES[zoneId] });

// A running game whose open turn is inside its lock window: a 24-hour turn started 23 hours ago, ending
// in one. `reads()` counts how often the turn was asked for.
function lockedClock() {
  const hour = 60 * 60 * 1000;
  let reads = 0;
  return {
    reads: () => reads,
    models: {
      turn: {
        findFirst: async () => {
          reads += 1;
          return {
            id: "t1",
            number: 1,
            status: "OPEN",
            turnLengthHours: 24,
            startedAt: new Date(Date.now() - 23 * hour),
            endsAt: new Date(Date.now() + hour),
          };
        },
      },
      gameConfig: { findUnique: async () => ({ gameMode: "PERSISTENT", autoTurnAdvanceDisabled: false }) },
      gameState: { findUnique: async () => ({ phase: "RUNNING" }) },
    },
  };
}

function stubGraph({ rolls, locked = false }) {
  const seen = [];
  const clock = locked ? lockedClock() : null;
  return {
    seen,
    turnReads: () => clock?.reads() ?? 0,
    locationLink: {
      // The same WHERE linksFor sends: every edge touching the one location.
      findMany: async ({ where }) => {
        const at = where.OR[0].aId;
        return [
          { aId: "tunnel", bId: "gallery", a: loc("tunnel", "depths"), b: loc("gallery", "depths") },
          { aId: "tunnel", bId: "ledge", a: loc("tunnel", "depths"), b: loc("ledge", "caves") },
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
    // No ring on anybody's finger (db/lib/roomAccess.js#wornRingTokens).
    characterTag: { findFirst: async () => null },
    // In the lock window only when `locked`.
    ...(clock?.models ?? {}),
  };
}

const CAVER = { id: "char1", zoneId: "depths", tags: [] };
const byLocation = (rows) => Object.fromEntries(rows.map((r) => [r.location.id, r]));

test("a held caver may still walk the caves, up and down, but not out of them", async () => {
  const byId = byLocation(await resolveNeighbors(stubGraph({ rolls: 1 }), CAVER, "tunnel"));

  assert.equal(byId.gallery.passable, true, "the next room along stays open");
  assert.equal(byId.gallery.refusal, null);
  assert.equal(byId.ledge.passable, true, "so does the way up to the Caves");

  assert.equal(byId.road.passable, false, "the way to the surface is shut");
  assert.equal(byId.road.refusal, CAVING_HOLD_REASON);
  assert.equal(byId.road.listed, true); // shut, not gone — same shape a locked gate uses
});

test("with no 1 this turn, every way is open", async () => {
  for (const row of await resolveNeighbors(stubGraph({ rolls: 0 }), CAVER, "tunnel")) {
    assert.equal(row.passable, true);
    assert.equal(row.refusal, null);
  }
});

test("severity 10 shuts every way in the picker, the next room included, in its own words", async () => {
  const byId = byLocation(await resolveNeighbors(stubGraph({ rolls: 10 }), CAVER, "tunnel"));
  for (const id of ["gallery", "ledge", "road"]) {
    assert.equal(byId[id].passable, false, id);
    assert.equal(byId[id].refusal, CAVING_STUCK_REASON, id);
  }
  assert.equal(byId.gallery.listed, true);
});

test("a surface picker never asks the Die", async () => {
  // Standing in the square in Town. The Die only speaks to somebody standing
  // underground, so there is nothing to look up.
  const db = stubGraph({ rolls: 10 });
  const rows = await resolveNeighbors(db, { id: "char1", zoneId: "town", tags: [] }, "square");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].passable, true);
  assert.equal(db.seen.length, 0);
});

// --- The lock: only a way with a cave at either end shuts, in Caving.docx's sentence ---
test("the lock's sentence is Caving.docx's, and only for a way that touches the caves", () => {
  assert.equal(CAVING_TRAVEL_LOCKED, "It is too close to the turn push, wait till next turn to move in the caves.");
  assert.equal(lockedTravelSentence("SURFACE", "CAVE_LEVEL"), CAVING_TRAVEL_LOCKED, "into the caves");
  assert.equal(lockedTravelSentence("CAVE_LEVEL", "SURFACE"), CAVING_TRAVEL_LOCKED, "out of the caves");
  assert.equal(lockedTravelSentence("CAVE_LEVEL", "CAVE_LEVEL"), CAVING_TRAVEL_LOCKED, "about the caves");
  assert.equal(lockedTravelSentence("SURFACE", "SURFACE"), null);
  assert.equal(lockedTravelSentence(null, null), null);
});

test("travelLockReason shuts the caves in the lock and leaves the surface open", async () => {
  const db = stubGraph({ rolls: 0, locked: true });
  assert.equal(await travelLockReason(db, { fromZoneKind: "SURFACE", intoZoneKind: "CAVE_LEVEL" }), CAVING_TRAVEL_LOCKED);
  assert.equal(await travelLockReason(db, { fromZoneKind: "CAVE_LEVEL", intoZoneKind: "SURFACE" }), CAVING_TRAVEL_LOCKED);
  assert.equal(await travelLockReason(db, { fromZoneKind: "CAVE_LEVEL", intoZoneKind: "CAVE_LEVEL" }), CAVING_TRAVEL_LOCKED);
  assert.equal(await travelLockReason(db, { fromZoneKind: "SURFACE", intoZoneKind: "SURFACE" }), null);
  assert.equal(await travelLockReason(db), null);
  assert.equal(db.turnReads(), 3, "a surface walk never asks for the turn");
  const open = stubGraph({ rolls: 0 });
  assert.equal(await travelLockReason(open, { fromZoneKind: "CAVE_LEVEL", intoZoneKind: "CAVE_LEVEL" }), null, "no lock, no sentence");
});

test("in the lock a caver's every way shuts, the way up to Town included", async () => {
  const byId = byLocation(await resolveNeighbors(stubGraph({ rolls: 0, locked: true }), CAVER, "tunnel"));
  for (const row of Object.values(byId)) {
    assert.equal(row.passable, false, row.location.id);
    assert.equal(row.refusal, CAVING_TRAVEL_LOCKED, row.location.id);
  }
});

test("in the lock the surface stays open, all but the way down", async () => {
  const db = stubGraph({ rolls: 0, locked: true });
  const byId = byLocation(await resolveNeighbors(db, { id: "char1", zoneId: "town", tags: [] }, "road"));
  assert.equal(byId.square.passable, true);
  assert.equal(byId.square.refusal, null);
  assert.equal(byId.tunnel.passable, false, "the way down into the caves");
  assert.equal(byId.tunnel.refusal, CAVING_TRAVEL_LOCKED);

  const square = stubGraph({ rolls: 0, locked: true });
  const rows = await resolveNeighbors(square, { id: "char1", zoneId: "town", tags: [] }, "square");
  assert.equal(rows[0].passable, true);
  assert.equal(square.turnReads(), 0, "no cave in sight, so the lock is never asked");
});

// --- The walk: severity 10 and there is no walk at all ---
function stubWalk({ rolls, locked = false, zoneId = "depths" }) {
  const seen = [];
  const places = [loc("tunnel", zoneId), loc("gallery", zoneId), loc("shaft", zoneId)].map((p) => ({
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
    characterTag: { findMany: async () => [], findFirst: async () => null },
    cavingRoll: {
      count: async ({ where }) => {
        seen.push(where);
        return rolls;
      },
    },
    ...(locked ? lockedClock().models : {}),
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

test("in the lock there is no walk in the caves, and the surface walk is still offered", async () => {
  assert.deepEqual(await routesWithinZone(stubWalk({ rolls: 0, locked: true }), WALKER, { known: KNOWN }), []);

  const town = stubWalk({ rolls: 0, locked: true, zoneId: "town" });
  const routes = await routesWithinZone(town, { ...WALKER, zoneId: "town" }, { known: KNOWN });
  assert.deepEqual(routes.map((r) => r.location.id).sort(), ["gallery", "shaft"]);
});
