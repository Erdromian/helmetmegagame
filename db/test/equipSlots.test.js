// db/lib/equipSlots.js: what cannot be worn together. Locks down the collapsed
// slot model — HEAD is one thing, BODY is Mail under Over — since the rule is
// enforced after the write and a mistake here reads to a player as an
// unrelated equip being refused.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LAYER_NAMES,
  LAYERED_SLOTS,
  findSlotClash,
  findEquipProblem,
  describeEquipFit,
  MAX_ACCESSORIES,
  isLockedOn,
  NOT_LOCKED_ON_WHERE,
} = require("../lib/equipSlots");

const head = (name) => ({ tag: { name, equipSlot: "HEAD", equipLayer: null } });
const body = (name, equipLayer) => ({ tag: { name, equipSlot: "BODY", equipLayer } });

test("a head holds exactly one thing", () => {
  assert.equal(findSlotClash([head("Mail Coif")]), null);
  const clash = findSlotClash([head("Mail Coif"), head("Hood")]);
  assert.ok(clash, "a coif and a hood no longer stack");
  assert.match(findEquipProblem([head("Mail Coif"), head("Hood")]), /can't both go on your head/);
});

test("HEAD is not a layered slot, so nothing can claim a layer in it", () => {
  assert.equal(LAYERED_SLOTS.has("HEAD"), false);
  assert.equal(LAYER_NAMES.HEAD, undefined);
});

test("armour goes over clothes, but two of either do not", () => {
  // Mail (1) under Over (2) is the whole point of keeping two body layers.
  assert.equal(findSlotClash([body("Black Robes", 1), body("Breastplate", 2)]), null);
  assert.ok(findSlotClash([body("Black Robes", 1), body("Vestments", 1)]));
  assert.ok(findSlotClash([body("Breastplate", 2), body("Plate Armor", 2)]));
});

test("the body has two layers and they are named for what a player is doing", () => {
  assert.deepEqual(LAYER_NAMES.BODY, ["Mail", "Over"]);
});

test("a stack equipped twice clashes with itself — two hats are two hats", () => {
  const hats = [{ equippedQuantity: 2, tag: { name: "Hat", equipSlot: "HEAD", equipLayer: null } }];
  assert.match(findEquipProblem(hats), /only have one Hat on your head/);
});

test("a shopper is told where a thing sits by name, not by layer number", () => {
  assert.equal(describeEquipFit({ equipSlot: "BODY", equipLayer: 2 }), "Body · Over");
  assert.equal(describeEquipFit({ equipSlot: "HEAD", equipLayer: null }), "Head");
});

// The locked bomb collar (docs/systemdocs/COLLAR.md): an ACCESSORY the wearer
// never chose, so it is not one of their four.
const accessory = (name, slug = null) => ({ tag: { name, slug, equipSlot: "ACCESSORY", equipLayer: null } });
const collar = () => accessory("Bomb Collar (Locked)", "bomb-collar-locked");

test("a locked-on accessory is known by slug alone", () => {
  assert.equal(isLockedOn(collar().tag), true);
  assert.equal(isLockedOn(collar()), true, "accepts the CharacterTag shape too");
  assert.equal(isLockedOn(accessory("Sheriff's Badge", "sheriffs-badge").tag), false);
  assert.equal(isLockedOn(null), false);
});

test("a collar marked with a glyph is locked on too, and its loose twin is not", () => {
  assert.equal(isLockedOn(accessory("Bomb Collar Ж (Locked)", "custom-collar-locked-11").tag), true);
  assert.equal(isLockedOn(accessory("Bomb Collar Ж", "custom-collar-loose-11").tag), false);
});

test("the death unequip's SQL filter skips both spellings of a shut collar", () => {
  assert.deepEqual(NOT_LOCKED_ON_WHERE.slug, { notIn: ["bomb-collar-locked"] });
  assert.deepEqual(NOT_LOCKED_ON_WHERE.NOT, [{ slug: { startsWith: "custom-collar-locked-" } }]);
});

test("the collar does not spend one of the four accessory cells", () => {
  const four = Array.from({ length: MAX_ACCESSORIES }, (_, i) => accessory(`Trinket ${i + 1}`, `trinket-${i + 1}`));
  assert.equal(findEquipProblem(four), null);
  assert.equal(findEquipProblem([...four, collar()]), null, "collared with full pockets is not an overflow");
  assert.match(findEquipProblem([...four, accessory("Spectacles", "spectacles")]), /put away Spectacles/);
  // And a fifth trinket on top of a collar names the trinket, never the collar.
  const problem = findEquipProblem([collar(), ...four, accessory("Spectacles", "spectacles")]);
  assert.match(problem, /Spectacles/);
  assert.doesNotMatch(problem, /Collar/);
});
