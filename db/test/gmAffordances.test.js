// What a GM is shown at a Location (db/lib/placeAffordances.js#gmAffordancesAt):
// every fixture there, whatever key its door asks for. The GM column draws
// these as buttons that open a preview and send nothing, so a fixture missing
// here is one a GM cannot look at — and four of them used to be: anything in a
// keyed room, quest Interact, Request Passage and the Charon's Launch.
const test = require("node:test");
const assert = require("node:assert/strict");
const { gmAffordancesAt } = require("../lib/placeAffordances");

const GATEHOUSE = { id: "loc-gatehouse", name: "Town Gatehouse", slug: "town-1", attributes: {} };
const BRIDGE = { id: "loc-bridge", name: "Bridge", slug: "bridge", attributes: {} };
const SQUARE = { id: "loc-square", name: "Square", slug: "town-2", attributes: {} };
const DEN = { id: "loc-den", name: "Den", slug: "undertown-9", attributes: {} };
const BASEMENT = { id: "loc-basement", name: "Basement", slug: "undertown-8", attributes: {} };
const CHARON = { id: "loc-charon", name: "The Charon", slug: "fortress-6", attributes: {} };
const LOCATIONS = [GATEHOUSE, BRIDGE, SQUARE, DEN, BASEMENT, CHARON];

function room(fields) {
  return {
    kind: "PUBLIC",
    accessTagSlugs: [],
    questId: null,
    phone: null,
    vendingMachine: false,
    sortOrder: 0,
    sides: [],
    ...fields,
  };
}

const ROOMS = [
  // Locked behind the gatehouse key, and holding the Black Hills lever.
  room({ id: "r-controls", name: "Gate Controls", slug: "town-1-2", locationId: GATEHOUSE.id, kind: "PRIVATE", accessTagSlugs: ["gatehouse-key"] }),
  // The Gate, homed on the Gatehouse and opening onto the Bridge.
  room({
    id: "r-gate",
    name: "The Gate",
    slug: "town-1-1",
    locationId: GATEHOUSE.id,
    kind: "PRIVATE",
    accessTagSlugs: ["gatehouse-key"],
    sides: [{ id: "side-gate", locationId: BRIDGE.id, kind: "PUBLIC", accessTagSlugs: [] }],
  }),
  // The Gatehouse Window, homed on the Gatehouse and opening onto the Square.
  room({
    id: "r-window",
    name: "Gatehouse Window",
    slug: "town-1-4",
    locationId: GATEHOUSE.id,
    sides: [{ id: "side-window", locationId: SQUARE.id, kind: "PUBLIC", accessTagSlugs: [] }],
  }),
  // A private room with a phone, and a GM-staged quest room.
  room({ id: "r-office", name: "Office", slug: "town-1-9", locationId: GATEHOUSE.id, kind: "PRIVATE", accessTagSlugs: ["nobody-has-this"], phone: "Office" }),
  room({ id: "r-quest", name: "Odd Door", slug: "quest-1", locationId: GATEHOUSE.id, questId: "q-1" }),
  // The Exactor's desk, which works the Den's basement shutters.
  room({ id: "r-desk", name: "Exactor's Office", slug: "undertown-9-3", locationId: DEN.id, kind: "PRIVATE", accessTagSlugs: ["exactor"] }),
  // The Charon's Cockpit, on the ground.
  room({ id: "r-cockpit", name: "Cockpit", slug: "fortress-6-1", locationId: CHARON.id, kind: "PRIVATE", accessTagSlugs: ["charon-seat"] }),
];

function link(id, a, b, fields = {}) {
  return { id, aId: a.id, bId: b.id, a, b, modular: false, isOpen: false, keyed: false, requiredTagSlug: null, ...fields };
}

const LINKS = [
  link("l-gate", BRIDGE, SQUARE, { modular: true, isOpen: false }),
  link("l-shutters", DEN, BASEMENT, { modular: true, isOpen: true }),
  link("l-keyed", GATEHOUSE, SQUARE, { keyed: true, requiredTagSlug: "postern-key" }),
];

// Just enough Prisma for the read: a location, the rooms that open onto it,
// its links, the remote lever's link and where the bomb is. Every write
// method is missing on purpose, so a GM read that tried one would throw.
function stubPrisma({ nukeRoomId = null } = {}) {
  return {
    location: { findUnique: async ({ where }) => LOCATIONS.find((l) => l.id === where.id) ?? null },
    room: {
      findMany: async ({ where }) => {
        const at = where.AND[0].OR[0].locationId;
        return ROOMS.filter((r) => r.locationId === at || r.sides.some((s) => s.locationId === at));
      },
    },
    // The other sides of the rooms homed at one Location.
    roomSide: {
      findMany: async ({ where }) =>
        ROOMS.filter((r) => r.locationId === where.room.locationId).flatMap((r) =>
          r.sides.map((s) => ({ roomId: r.id, locationId: s.locationId })),
        ),
    },
    locationLink: {
      findMany: async ({ where }) => {
        const at = where.OR?.[0]?.aId;
        // linksFor names the Location; remoteLink names the lever's two ends.
        if (at) return LINKS.filter((l) => l.aId === at || l.bId === at);
        return LINKS.filter((l) => l.modular);
      },
    },
    gameState: { findUnique: async () => ({ nukeRoomId }) },
  };
}

const ids = (list) => list.map((entry) => `${entry.id}${entry.roomId ? `@${entry.roomId}` : ""}`);

test("a GM sees every fixture in a keyed room, the lever and the quest's Interact", async () => {
  const list = await gmAffordancesAt(stubPrisma({ nukeRoomId: "r-office" }), GATEHOUSE.id);
  const got = ids(list);
  for (const want of [
    "processRequests@r-controls",
    "createDocuments@r-controls",
    "gateLever@r-controls",
    "submitDocumentation@r-gate",
    "phone@r-office",
    "nuke@r-office",
    "questInteract@r-quest",
  ]) {
    assert.ok(got.includes(want), `${want} missing from ${got.join(", ")}`);
  }
  const lever = list.find((entry) => entry.id === "gateLever");
  assert.equal(lever.linkId, "l-gate");
});

test("a GM sees a keyed door without holding its tag", async () => {
  const list = await gmAffordancesAt(stubPrisma(), GATEHOUSE.id);
  const keyed = list.find((entry) => entry.kind === "keyed");
  assert.ok(keyed, "no keyed door");
  assert.equal(keyed.linkId, "l-keyed");
  assert.equal(keyed.farName, "Square");
});

test("from the Bridge, a GM sees Request Passage on the Gate's outside", async () => {
  const got = ids(await gmAffordancesAt(stubPrisma(), BRIDGE.id));
  assert.ok(got.includes("requestPassage@r-gate"), got.join(", "));
  assert.ok(got.includes("submitDocumentation@r-gate"), got.join(", "));
  // The lever is on the Gatehouse's wall, not the Bridge's.
  assert.ok(!got.some((id) => id.startsWith("gateLever")), got.join(", "));
});

// A GM's room is always read at its home, the Gatehouse, where Request Passage
// never is — so the Gate and the Window borrow it from their outsides.
test("at the Gatehouse, a GM sees Request Passage on the Gate and the Window, read from outside", async () => {
  const list = await gmAffordancesAt(stubPrisma(), GATEHOUSE.id);
  for (const [roomId, outside] of [
    ["r-gate", BRIDGE],
    ["r-window", SQUARE],
  ]) {
    const passage = list.filter((entry) => entry.id === "requestPassage" && entry.roomId === roomId);
    assert.equal(passage.length, 1, ids(list).join(", "));
    assert.equal(passage[0].atLocationId, outside.id);
  }
  // The Gate's terminal is on both sides of it: listed once, from home.
  const docs = list.filter((entry) => entry.id === "submitDocumentation");
  assert.equal(docs.length, 1);
  assert.equal(docs[0].atLocationId, undefined);
  // Only the far side's ROOM buttons come back, never its Location's.
  const borrowed = list.filter((entry) => entry.atLocationId);
  assert.deepEqual(ids(borrowed).sort(), ["requestPassage@r-gate", "requestPassage@r-window"]);
});

test("the far side's own list borrows nothing back", async () => {
  const got = ids(await gmAffordancesAt(stubPrisma(), BRIDGE.id));
  assert.equal(got.filter((id) => id === "requestPassage@r-gate").length, 1, got.join(", "));
  assert.ok(!got.includes("search@r-gate"), got.join(", "));
});

test("a watchtower's gate shows with nobody holding the key to the tower", async () => {
  const list = await gmAffordancesAt(stubPrisma(), DEN.id);
  const gate = list.find((entry) => entry.kind === "gate");
  assert.ok(gate, ids(list).join(", "));
  assert.equal(gate.linkId, "l-shutters");
  assert.equal(gate.label, "Close Shutters");
});

test("the Charon's Launch shows on the ground", async () => {
  const got = ids(await gmAffordancesAt(stubPrisma(), CHARON.id));
  assert.ok(got.includes("charonLaunch@r-cockpit"), got.join(", "));
  assert.ok(got.includes("charonLeave"), got.join(", "));
});

test("no Location, no list", async () => {
  assert.deepEqual(await gmAffordancesAt(stubPrisma(), null), []);
  assert.deepEqual(await gmAffordancesAt(stubPrisma(), "loc-gone"), []);
});
