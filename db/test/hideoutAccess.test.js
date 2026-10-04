// The Thanati hideout's door (docs/systemdocs/THANATI.md §3). A cultist
// converted mid-game holds `thanati` and nothing else — none of whatever key
// the hideout's room is locked with — so the faith itself has to open it, or
// the convert stands outside while the cult buys gear in there without them.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { accessibleRooms, allowedRoomIds, roomAccessKeys } = require("../lib/roomAccess");
const { addRoomGuest, removeRoomGuest } = require("../lib/roomGuests");

const HERE = "loc-1";
const HIDEOUT = {
  id: "room-hideout",
  name: "Hideout",
  kind: "PRIVATE",
  accessTagSlugs: ["boarded-door-key"],
  locationId: HERE,
  discordThreadId: null,
  location: { name: "Basements" },
};
const OTHER = { ...HIDEOUT, id: "room-other", name: "Winery" };

const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, age: 30, gender: "MAN", discordUserId: null, discordMirrored: false, concealed: false, locationId: HERE, tags: [] };
const convert = { ...base, id: "convert", name: "New Blood" };
const comrade = { ...base, id: "comrade", name: "Old Hand" };
const outsider = { ...base, id: "outsider", name: "Ann Vell" };
const people = [convert, comrade, outsider];
const HELD = { convert: ["thanati"], comrade: ["thanati"], outsider: [] };

function fakePrisma({ hideoutRoomId = HIDEOUT.id } = {}) {
  const models = {
    gameState: { findUnique: async () => ({ thanatiHideoutRoomId: hideoutRoomId }) },
    room: { findUnique: async ({ where }) => [HIDEOUT, OTHER].find((r) => r.id === where.id) ?? null },
    character: {
      findFirst: async ({ where }) => people.find((p) => p.id === where.id && p.status === where.status) ?? null,
      findUnique: async ({ where }) => people.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }) => people.filter((p) => p.locationId === where.locationId),
    },
    characterTag: {
      findMany: async ({ where }) => (HELD[where.characterId] ?? []).map((slug) => ({ equipped: false, tag: { slug } })),
      findFirst: async () => null,
    },
    acquaintance: { findMany: async () => [] },
    quest: { findMany: async () => [] },
    roomGuest: { findMany: async () => [], upsert: async () => ({}), deleteMany: async () => ({}) },
  };
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, groupBy: async () => [] };
  return new Proxy(models, { get: (target, key) => target[key] ?? empty });
}

test("a convert holding only the faith is let into the hideout, and only the hideout", async () => {
  const keys = await roomAccessKeys(fakePrisma(), convert.id);
  const open = accessibleRooms([HIDEOUT, OTHER], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  assert.deepEqual(open.map((r) => r.id), [HIDEOUT.id]);
});

test("nobody outside the faith is let in by it", async () => {
  const keys = await roomAccessKeys(fakePrisma(), outsider.id);
  assert.equal(accessibleRooms([HIDEOUT], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length, 0);
});

test("with no hideout set the faith opens nothing", async () => {
  const allowed = await allowedRoomIds(fakePrisma({ hideoutRoomId: null }), convert.id, new Set(["thanati"]));
  assert.equal(allowed.size, 0);
});

test("a convert inside the hideout may let somebody in, as a keyholder may", async () => {
  const res = await addRoomGuest(fakePrisma(), { actor: convert, roomId: HIDEOUT.id, characterId: outsider.id, byToken: true });
  assert.equal(res.ok, true, res.error);
});

test("a cultist cannot be shown out of the hideout", async () => {
  const res = await removeRoomGuest(fakePrisma(), { actor: comrade, roomId: HIDEOUT.id, characterId: convert.id, byToken: true });
  assert.equal(res.ok, false);
  assert.equal(res.error, "You can't remove them; they have a key.");
});
