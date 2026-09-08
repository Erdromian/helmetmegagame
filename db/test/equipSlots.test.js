// node --test over db/lib/equipSlots.js — the equip-slot clash rule and the
// shared "is this resulting set wearable?" check both equipActions.js's
// per-unit toggle and tagOps.js's whole-holding batch ask before committing
// an equip. Pure functions, no Prisma, so every scenario below is a plain
// object literal rather than a live character.
const test = require("node:test");
const assert = require("node:assert/strict");
const { findSlotClash, describeSlotClash, checkEquipLimits } = require("../lib/equipSlots");

// A bare Tag shape — findSlotClash accepts Tag[] directly, and checkEquipLimits
// builds this shape internally off CharacterTag rows.
const tag = (name, { equipSlot = null, equipLayer = null } = {}) => ({ name, equipSlot, equipLayer });

// A CharacterTag-shaped row — what checkEquipLimits actually reads.
const row = (name, equippedQuantity, opts) => ({ equippedQuantity, tag: tag(name, opts) });

const HELM = { equipSlot: "HEAD", equipLayer: 3 };
const COIF = { equipSlot: "HEAD", equipLayer: 1 };
const HAT = { equipSlot: "HEAD", equipLayer: 4 };
const SHIELD = { equipSlot: "SHIELD" };
const BODY_1 = { equipSlot: "BODY", equipLayer: 1 };

// --- findSlotClash ----------------------------------------------------

test("findSlotClash: nothing equipped clashes with nothing", () => {
  assert.equal(findSlotClash([]), null);
});

test("findSlotClash: a non-array is treated as no clash rather than thrown", () => {
  assert.equal(findSlotClash(null), null);
  assert.equal(findSlotClash(undefined), null);
});

test("findSlotClash: unslotted tags never clash, however many there are", () => {
  const swords = Array.from({ length: 5 }, () => tag("Broadsword"));
  assert.equal(findSlotClash(swords), null);
});

test("findSlotClash: different slots never clash", () => {
  assert.equal(findSlotClash([tag("Helm", HELM), tag("Breastplate", BODY_1)]), null);
});

test("findSlotClash: the same slot, different layers, does not clash", () => {
  // A mail coif (HEAD 1) goes under a knight's helm (HEAD 3) — TAGS.md's own example.
  assert.equal(findSlotClash([tag("Mail Coif", COIF), tag("Helm", HELM)]), null);
});

test("findSlotClash: the same slot AND layer clashes, whatever the tags are", () => {
  const clash = findSlotClash([tag("Helm", HELM), tag("Bascinet", HELM)]);
  assert.deepEqual(clash, { a: tag("Bascinet", HELM), b: tag("Helm", HELM) });
});

test("findSlotClash: SHIELD has no layer, so two shields always clash", () => {
  const clash = findSlotClash([tag("Buckler", SHIELD), tag("Pavise", SHIELD)]);
  assert.ok(clash);
});

test("findSlotClash: the SAME tag twice clashes with itself", () => {
  // Two units of one stackable slotted tag (a hat, say) fighting over the
  // one slot it has — this is what checkEquipLimits's expansion produces.
  const hat = tag("Hat", HAT);
  const clash = findSlotClash([hat, hat]);
  assert.deepEqual(clash, { a: hat, b: hat });
});

test("findSlotClash: accepts CharacterTag rows (.tag) as well as bare Tags", () => {
  const clash = findSlotClash([{ tag: tag("Helm", HELM) }, { tag: tag("Bascinet", HELM) }]);
  assert.ok(clash);
});

// --- describeSlotClash --------------------------------------------------

test("describeSlotClash: names both tags and where they clash", () => {
  const msg = describeSlotClash({ a: tag("Helm", HELM), b: tag("Bascinet", HELM) });
  assert.equal(msg, "Helm and Bascinet can't both go on your head. ‡");
});

test("describeSlotClash: the same tag twice reads as a count, not a pair", () => {
  const hat = tag("Hat", HAT);
  const msg = describeSlotClash({ a: hat, b: hat });
  assert.equal(msg, "You can only have one Hat on your head at a time. ‡");
});

test("describeSlotClash: an unknown slot falls back to a plain 'there'", () => {
  const weird = tag("Mystery Gear", { equipSlot: "TAIL" });
  const msg = describeSlotClash({ a: weird, b: weird });
  assert.equal(msg, "You can only have one Mystery Gear there at a time. ‡");
});

// --- checkEquipLimits -----------------------------------------------------

test("checkEquipLimits: under the cap with no clash is fine", () => {
  const result = checkEquipLimits([row("Broadsword", 2), row("Shield", 1, SHIELD)], 10);
  assert.deepEqual(result, { equipped: 3, overCap: false, clash: null });
});

test("checkEquipLimits: exactly at the cap is still fine", () => {
  const result = checkEquipLimits([row("Broadsword", 5)], 5);
  assert.equal(result.overCap, false);
});

test("checkEquipLimits: one past the cap is refused", () => {
  const result = checkEquipLimits([row("Broadsword", 5), row("Hatchet", 1)], 5);
  assert.equal(result.overCap, true);
  assert.equal(result.equipped, 6);
});

test("checkEquipLimits: five units of an unslotted stackable tag spend five slots and never clash", () => {
  const result = checkEquipLimits([row("Broadsword", 5)], 10);
  assert.equal(result.equipped, 5);
  assert.equal(result.clash, null);
});

test("checkEquipLimits: two units of the same slotted stackable tag clash with themselves", () => {
  // A stack of 2 Hats, both equipped — the exact case that took manual
  // browser testing to find before this file existed.
  const result = checkEquipLimits([row("Hat", 2, HAT)], 10);
  assert.ok(result.clash);
  assert.equal(result.clash.a.name, "Hat");
});

test("checkEquipLimits: a clash is reported even while under the cap", () => {
  const result = checkEquipLimits([row("Helm", 1, HELM), row("Bascinet", 1, HELM)], 10);
  assert.equal(result.overCap, false);
  assert.ok(result.clash);
});

test("checkEquipLimits: a row with nothing equipped contributes no units and no clash", () => {
  const result = checkEquipLimits([row("Hat", 0, HAT), row("Hat", 0, HAT)], 10);
  assert.equal(result.equipped, 0);
  assert.equal(result.clash, null);
});

test("checkEquipLimits: an empty worn set is always fine", () => {
  assert.deepEqual(checkEquipLimits([], 0), { equipped: 0, overCap: false, clash: null });
});
