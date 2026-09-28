// Signet rings (docs/systemdocs/RINGS.md): what a worn ring opens, what it
// seals, and how a seat's `ring:` block is read. The rules are pure, so they
// are pinned here without a database; the minting and the infoterminal's PIN
// are exercised end to end against a local clone instead.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accessSlugsOf,
  wornRing,
  ringAccessFor,
  spawnRingShape,
  ringDescription,
  initialsOf,
} = require("../lib/rings");
const { parseRing } = require("../lib/syncRoles");
const { isSeal, sealLabel } = require("../lib/paper");
const { findEquipProblem, EQUIP_SLOTS } = require("../lib/equipSlots");
const { RING_TEXT } = require("../lib/ringText");

const ring = (over = {}) => ({
  slug: "custom-ring-x",
  name: "Signet Ring (A.V.)",
  ringOfCharacterId: "c1",
  ringRegisteredAt: new Date(),
  ringAccessSlugs: ["barons-key", "tower-key"],
  equipSlot: "FINGER",
  ...over,
});

test("a worn, registered ring adds its doors to what you hold", () => {
  const slugs = accessSlugsOf([{ equipped: true, tag: ring() }, { equipped: false, tag: { slug: "paper" } }]);
  assert.ok(slugs.has("barons-key"));
  assert.ok(slugs.has("tower-key"));
  assert.ok(slugs.has("paper"));
});

test("a ring in a pocket opens nothing", () => {
  const slugs = accessSlugsOf([{ equipped: false, tag: ring() }]);
  assert.ok(!slugs.has("barons-key"));
});

test("an unregistered ring opens nothing, worn or not", () => {
  const slugs = accessSlugsOf([{ equipped: true, tag: ring({ ringRegisteredAt: null }) }]);
  assert.ok(!slugs.has("barons-key"));
  assert.equal(wornRing([{ equipped: true, tag: ring({ ringRegisteredAt: null }) }])?.slug, "custom-ring-x");
});

test("a ring's doors are the union of its seats', sorted", () => {
  const roles = [
    { slug: "baron", ringAccessSlugs: ["tower-key", "barons-key"] },
    { slug: "hand", ringAccessSlugs: ["hands-key", "tower-key"] },
  ];
  assert.deepEqual(ringAccessFor(["baron", "hand"], roles), ["barons-key", "hands-key", "tower-key"]);
  assert.deepEqual(ringAccessFor([], roles), []);
});

test("only an office's own ring seals; a plain ring leaves no seal", () => {
  const office = spawnRingShape(
    {
      ringSealOffice: "Merchant",
      ringSealMark: "Bears his initials, {initials}.",
      ringName: "Merchant's Signet Ring",
      ringDescription: "Its face bears {initials}.",
    },
    "A.V.",
  );
  assert.equal(office.name, "Merchant's Signet Ring");
  assert.equal(office.description, "Its face bears A.V.");
  assert.equal(office.sealMark, "Bears his initials, A.V.");
  assert.equal(office.sealOffice, "Merchant");
  assert.ok(isSeal({ ...office, ringOfCharacterId: "c1" }));
  assert.equal(sealLabel(office), "Merchant");

  const plain = spawnRingShape({ ringSealOffice: null }, "A.V.");
  assert.equal(plain.sealMark, null);
  assert.equal(plain.sealOffice, null);
  assert.ok(!isSeal(plain));
});

test("a plain ring's description follows its registration", () => {
  assert.ok(ringDescription({ initials: "A.V.", registered: false }).includes(RING_TEXT.ringUnregistered));
  assert.ok(!ringDescription({ initials: "A.V.", registered: true }).includes(RING_TEXT.ringUnregistered));
  assert.ok(ringDescription({ initials: "A.V.", registered: true, office: true }).includes(RING_TEXT.ringSealless));
});

test("initials", () => {
  assert.equal(initialsOf("Aurel Vane"), "A.V.");
  assert.equal(initialsOf("Gribb"), "G.");
  assert.equal(initialsOf("  "), null);
});

test("a character's initials leave out the honorific and the title", () => {
  const knight = { name: 'Sir Aurel "the Bold" Vane', honorific: "Sir", firstName: "Aurel", title: "the Bold", lastName: "Vane" };
  assert.equal(initialsOf(knight), "A.V.");
  assert.equal(initialsOf({ name: 'Lady Gribb "Ironhand"', honorific: "Lady", firstName: "Gribb", title: "Ironhand", lastName: null }), "G.");
  // A row selected without the name parts falls back to the whole name.
  assert.equal(initialsOf({ name: "Aurel Vane" }), "A.V.");
});

test("the finger holds one ring and blocks nothing else", () => {
  assert.ok(EQUIP_SLOTS.includes("FINGER"));
  const gloves = { name: "Armored Gloves", equipSlot: "ACCESSORY" };
  const sword = { name: "Sword", equipSlot: "WEAPON" };
  assert.equal(findEquipProblem([ring(), gloves, sword]), null);
  assert.ok(findEquipProblem([ring(), ring({ name: "Signet Ring (B.W.)" })]));
});

test("a seat's ring: block reads, and an office ring needs all four of its keys", () => {
  assert.deepEqual(parseRing({}, "bum"), {
    ringSpawns: false,
    ringAccessSlugs: [],
    ringSealOffice: null,
    ringSealMark: null,
    ringName: null,
    ringDescription: null,
    ringAuthorisedBy: null,
  });
  assert.equal(parseRing({ ring: { opens: [], authorised_by: "barons-scepter" } }, "baron").ringAuthorisedBy, "barons-scepter");
  const baron = parseRing(
    {
      ring: {
        spawns: true,
        opens: ["barons-key", "barons-key", "tower-key"],
        seal_office: "Baron",
        seal_mark: "A raven.",
        name: "Baron's Signet Ring",
        description: "Gold.",
      },
    },
    "baron",
  );
  assert.equal(baron.ringSpawns, true);
  assert.deepEqual(baron.ringAccessSlugs, ["barons-key", "tower-key"]);
  assert.equal(baron.ringSealOffice, "Baron");
  assert.throws(() => parseRing({ ring: { seal_office: "Baron", seal_mark: "A raven." } }, "baron"), /all of/);
  assert.throws(() => parseRing({ ring: { unsmithable: true } }, "baron"), /unknown key/);
});
