// node --test over the `slot: top` lock clause (DESIRES.md §3): the Thanati's
// lock claims the first Desire slot and is the only lock read there, and the
// Thanati Leader stays locked in every slot.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { evaluateDesireCatalog, describeDesireLocks } = require("../lib/desireGates");
const { normalizeDesireLocks, validateDesireLocks } = require("../lib/desireShapes");

const tagsMaster = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8"));
const locksOf = (slug) => normalizeDesireLocks(tagsMaster.tags[slug].desires.locks);

const thanati = { id: "t1", slug: "thanati", name: "Thanati", desireLocks: locksOf("thanati") };
const leader = { id: "t2", slug: "thanati-leader", name: "Thanati Leader", desireLocks: locksOf("thanati-leader") };
const depressed = { id: "t3", slug: "depressed", name: "Depressed", desireLocks: [{ all: true }] };
const alcoholic = {
  id: "t4",
  slug: "alcoholic",
  name: "Alcoholic",
  desireLocks: [{ all: true, exceptFamilies: ["alcohol"], slot: "bottom" }],
};

const CULT = { id: "d1", slug: "cult", tier: 2, families: ["thanati"] };
const ROMANCE = { id: "d2", slug: "romance", tier: 2, families: ["romance"] };
const DRINK = { id: "d3", slug: "drink", tier: 1, families: ["alcohol"] };

function evaluate(heldTags, desireSlots = 2) {
  const { visible } = evaluateDesireCatalog({
    templates: [CULT, ROMANCE, DRINK],
    heldTags,
    hiddenTagIds: new Set(),
    roleSlug: null,
    history: [],
    openTurnNumber: 1,
    desireSlots,
  });
  return new Map(visible.map((e) => [e.template.slug, e]));
}

test("the grammar accepts slot: top and still refuses anything else", () => {
  validateDesireLocks(normalizeDesireLocks([{ all: true, slot: "top" }]), { slug: "test", families: new Set() });
  assert.throws(
    () => validateDesireLocks(normalizeDesireLocks([{ all: true, slot: "middle" }]), { slug: "test", families: new Set() }),
    /only supported scopes/,
  );
});

test("an operative's first slot is the cult's, and every other slot is free", () => {
  const byslug = evaluate([thanati]);
  assert.equal(byslug.get("cult").state, "available");
  assert.deepEqual(byslug.get("cult").slotLocks, [null, null]);
  assert.equal(byslug.get("romance").state, "available");
  assert.deepEqual(byslug.get("romance").slotLocks, ["Locked by Thanati", null]);
});

test("the leader is locked to the cult in every slot", () => {
  const byslug = evaluate([thanati, leader]);
  assert.deepEqual(byslug.get("cult").slotLocks, [null, null]);
  assert.equal(byslug.get("romance").state, "locked");
});

test("no other lock reaches the first slot, a whole-catalog one included", () => {
  const byslug = evaluate([thanati, depressed]);
  assert.equal(byslug.get("cult").state, "available");
  assert.deepEqual(byslug.get("cult").slotLocks, [null, "Locked by Depressed"]);
  // Shut in the first slot by Thanati and in the second by Depressed.
  assert.equal(byslug.get("romance").state, "locked");
});

test("with one slot the Thanati claim beats an Addiction's bottom slot", () => {
  const byslug = evaluate([thanati, alcoholic], 1);
  assert.deepEqual(byslug.get("cult").slotLocks, [null]);
  assert.deepEqual(byslug.get("drink").slotLocks, ["Locked by Thanati"]);
});

test("the sheet's lock notes say which slot each lock reaches", () => {
  const notes = describeDesireLocks([thanati, depressed]);
  assert.match(notes[0], /^Thanati shuts your first Desire slot to everything outside .*, whatever else you hold\.$/);
  assert.equal(notes[1], "Depressed shuts your other Desire slots to everything.");
  assert.equal(describeDesireLocks([depressed])[0], "Depressed shuts every Desire.");
});
