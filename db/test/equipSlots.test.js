// node --test over db/lib/equipSlots.js — the equip-slot clash rule, the hands
// count, and the shared "is this resulting set wearable?" check both
// equipActions.js's per-unit toggle and tagOps.js's whole-holding batch ask
// before committing an equip. Pure functions, no Prisma, so every scenario
// below is a plain object literal rather than a live character.
//
// findSlotClash/describeSlotClash are private now — findEquipProblem is the
// one public answer both write paths actually call, so everything here goes
// through it (or handsUsed/handsOf directly for the hands-only cases).
const test = require("node:test");
const assert = require("node:assert/strict");
const { WEAPON_HANDS, MAX_ACCESSORIES, handsOf, handsUsed, findEquipProblem } = require("../lib/equipSlots");

// A bare Tag shape — findEquipProblem accepts Tag[] directly, with no
// equippedQuantity, which counts as exactly one unit.
const tag = (name, { equipSlot = null, equipLayer = null, twoHanded = false } = {}) => ({
  name,
  equipSlot,
  equipLayer,
  twoHanded,
});

// A CharacterTag-shaped row — what the write paths actually select and pass.
const row = (name, equippedQuantity, opts) => ({ equippedQuantity, tag: tag(name, opts) });

const HELM = { equipSlot: "HEAD", equipLayer: 3 };
const COIF = { equipSlot: "HEAD", equipLayer: 1 };
const HAT = { equipSlot: "HEAD", equipLayer: 4 };
const BODY_1 = { equipSlot: "BODY", equipLayer: 1 };
const SWORD = { equipSlot: "WEAPON" };
const GREATSWORD = { equipSlot: "WEAPON", twoHanded: true };
const BADGE = { equipSlot: "ACCESSORY" };

// --- findEquipProblem: slot/layer clashes -------------------------------

test("findEquipProblem: nothing equipped is fine", () => {
  assert.equal(findEquipProblem([]), null);
});

test("findEquipProblem: a non-array is treated as nothing equipped rather than thrown", () => {
  assert.equal(findEquipProblem(null), null);
  assert.equal(findEquipProblem(undefined), null);
});

test("findEquipProblem: unslotted tags never clash, however many there are", () => {
  const badges = Array.from({ length: 5 }, () => tag("Badge"));
  assert.equal(findEquipProblem(badges), null);
});

test("findEquipProblem: different slots never clash", () => {
  assert.equal(findEquipProblem([tag("Helm", HELM), tag("Breastplate", BODY_1)]), null);
});

test("findEquipProblem: the same slot, different layers, does not clash", () => {
  // A mail coif (HEAD 1) goes under a knight's helm (HEAD 3) — TAGS.md's own example.
  assert.equal(findEquipProblem([tag("Mail Coif", COIF), tag("Helm", HELM)]), null);
});

test("findEquipProblem: the same slot AND layer clashes, whatever the tags are", () => {
  const msg = findEquipProblem([tag("Helm", HELM), tag("Bascinet", HELM)]);
  assert.equal(msg, "Bascinet and Helm can't both go on your head.");
});

test("findEquipProblem: accepts CharacterTag rows (.tag) as well as bare Tags", () => {
  assert.ok(findEquipProblem([{ tag: tag("Helm", HELM) }, { tag: tag("Bascinet", HELM) }]));
});

test("findEquipProblem: an unknown slot falls back to a plain 'there'", () => {
  const weird = { name: "Mystery Gear", equipSlot: "TAIL" };
  const msg = findEquipProblem([weird, weird]);
  assert.equal(msg, "You can only have one Mystery Gear there at a time.");
});

// --- findEquipProblem: destacking — equippedQuantity expands into units ---

test("findEquipProblem: two units of the same slotted stackable tag clash with themselves", () => {
  // A stack of 2 Hats, both equipped — the exact case that took manual
  // browser testing to find before this file existed.
  const msg = findEquipProblem([row("Hat", 2, HAT)]);
  assert.equal(msg, "You can only have one Hat on your head at a time.");
});

test("findEquipProblem: a row with nothing equipped contributes no units and no clash", () => {
  assert.equal(findEquipProblem([row("Hat", 0, HAT), row("Hat", 0, HAT)]), null);
});

test("findEquipProblem: five units of an unslotted stackable tag never clash on the slot rule", () => {
  assert.equal(findEquipProblem([row("Badge", 5)]), null);
});

// --- handsOf / handsUsed --------------------------------------------------

test("handsOf: a one-handed weapon costs one hand", () => {
  assert.equal(handsOf(tag("Broadsword", SWORD)), 1);
});

test("handsOf: a two-handed weapon costs two", () => {
  assert.equal(handsOf(tag("Greatsword", GREATSWORD)), 2);
});

test("handsOf: anything not a WEAPON costs no hands", () => {
  assert.equal(handsOf(tag("Helm", HELM)), 0);
});

test("handsUsed: sums hands across rows, expanding each by its equippedQuantity", () => {
  // Three swords from one stack is three hands, not one hand for "a stack".
  assert.equal(handsUsed([row("Broadsword", 3, SWORD)]), 3);
});

test("handsUsed: a bare Tag[] with no equippedQuantity counts each entry once", () => {
  assert.equal(handsUsed([tag("Broadsword", SWORD), tag("Helm", HELM)]), 1);
});

// --- findEquipProblem: hands overflow -------------------------------------

test("findEquipProblem: exactly WEAPON_HANDS worth of one-handers is fine", () => {
  assert.equal(WEAPON_HANDS, 4);
  assert.equal(findEquipProblem([row("Broadsword", 4, SWORD)]), null);
});

test("findEquipProblem: one sword past the hand cap is refused, naming only the excess", () => {
  const msg = findEquipProblem([row("Broadsword", 5, SWORD)]);
  assert.equal(msg, "Your hands are full: put away Broadsword before you take up anything else.");
});

test("findEquipProblem: a two-hander says so inline", () => {
  const msg = findEquipProblem([row("Broadsword", 3, SWORD), row("Greatsword", 1, GREATSWORD)]);
  assert.equal(
    msg,
    "Your hands are full: put away Greatsword (two hands) before you take up anything else.",
  );
});

test("findEquipProblem: repeated excess names collapse to a count", () => {
  // Six swords from one stack: four fit, two are excess.
  const msg = findEquipProblem([row("Broadsword", 6, SWORD)]);
  assert.equal(msg, "Your hands are full: put away Broadsword ×2 before you take up anything else.");
});

test("findEquipProblem: a slot clash is reported before a hands overflow", () => {
  // Two helms clash on the layer rule; hands never even get asked.
  const msg = findEquipProblem([tag("Helm", HELM), tag("Bascinet", HELM), row("Broadsword", 5, SWORD)]);
  assert.equal(msg, "Bascinet and Helm can't both go on your head.");
});

// --- findEquipProblem: accessory overflow ---------------------------------

test("findEquipProblem: exactly MAX_ACCESSORIES worth of trinkets is fine", () => {
  assert.equal(MAX_ACCESSORIES, 4);
  assert.equal(findEquipProblem([row("Badge", 4, BADGE)]), null);
});

test("findEquipProblem: one accessory past the cap is refused, naming only the excess", () => {
  const msg = findEquipProblem([row("Badge", 5, BADGE)]);
  assert.equal(msg, "You can keep 4 things about you: put away Badge.");
});

test("findEquipProblem: five units of one stackable accessory tag are five things about you, not one", () => {
  // The exact destacking gap this test guards: describeAccessoryOverflow
  // used to count CharacterTag ROWS, so a single stack with equippedQuantity
  // 5 read as "1 accessory" and never tripped the cap at all.
  const msg = findEquipProblem([row("Badge", 5, BADGE)]);
  assert.ok(msg);
  assert.match(msg, /put away Badge\./);
});

test("findEquipProblem: repeated excess accessory names collapse to a count", () => {
  const msg = findEquipProblem([row("Badge", 6, BADGE)]);
  assert.equal(msg, "You can keep 4 things about you: put away Badge ×2.");
});

test("findEquipProblem: accessories never clash on the slot rule, only overflow the cap", () => {
  const hat = tag("Hat", HAT);
  assert.equal(findEquipProblem([hat, row("Badge", 4, BADGE)]), null);
});

test("findEquipProblem: a hands overflow is reported before an accessory overflow", () => {
  const msg = findEquipProblem([row("Broadsword", 5, SWORD), row("Badge", 5, BADGE)]);
  assert.equal(msg, "Your hands are full: put away Broadsword before you take up anything else.");
});
