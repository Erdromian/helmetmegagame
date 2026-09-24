// A room party (db/lib/parties.js#resolveParty) against the door every room in
// the game shares (db/lib/roomAccess.js#accessibleRooms). The party's own
// `kind` is "room" for every room, so it has to be mapped to the Room's own
// kind before the door can see a private one — web/lib/transferReach.js once
// handed the party straight over and every private stash opened for anybody
// standing at its Location.
const test = require("node:test");
const assert = require("node:assert/strict");

const { partyRoom } = require("../lib/parties");
const { accessibleRooms } = require("../lib/roomAccess");

// What resolveParty returns for a room, trimmed to what the door reads.
const vault = { kind: "room", id: "r1", name: "Vault", roomKind: "PRIVATE", accessTagSlugs: ["vault-key"], locationId: "loc" };
const none = new Set();
const opens = (party, slugs = none, guests = none, allowed = none) =>
  accessibleRooms([partyRoom(party)], slugs, guests, allowed).length === 1;

test("a private room party opens only for a key, a guest row or a quest allowance", () => {
  assert.equal(opens(vault), false);
  assert.equal(opens(vault, new Set(["vault-key"])), true);
  assert.equal(opens(vault, none, new Set(["r1"])), true);
  assert.equal(opens(vault, none, none, new Set(["r1"])), true);
  assert.equal(opens(vault, new Set(["lantern"]), new Set(["r2"])), false);
});

test("a public room party opens for everybody", () => {
  assert.equal(opens({ ...vault, roomKind: "PUBLIC", accessTagSlugs: [] }), true);
});

test("the bug this guards: the party itself reads as a public room", () => {
  // Kept as a record of why partyRoom exists. If accessibleRooms ever learns
  // to read `roomKind` itself, this is the assertion that says so.
  assert.equal(accessibleRooms([vault], none, none, none).length, 1);
});

test("a character party is not a room", () => {
  assert.equal(partyRoom({ kind: "character", id: "c1" }), null);
  assert.equal(partyRoom(null), null);
});
