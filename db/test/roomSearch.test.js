// The pure half of searching a room (db/lib/roomSearch.js, SEARCH.md §9).
// Three things worth pinning, none of which a player can check because the
// die is never shown: that the reveal is the person search's rule applied to
// STACKS (one hidden thing needs a modified 6, four give one up on a 2); that
// the modifier table is CLOSED and Night Vision only counts underground; and
// that the refusal ladder refuses in the order it claims to, since a refusal
// costs no ration and a ration is spent by anything past it.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROOM_SEARCH_MODIFIERS,
  roomSearchModifiers,
  roomSearchTotal,
  hiddenStacks,
  roomSearchOutcome,
  roomSearchReadout,
  roomSearchRefusal,
} = require("../lib/roomSearch");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug, name: slug } }));
const row = (slug, hiddenQuantity, name = slug) => ({ id: `rt-${slug}`, tagId: `t-${slug}`, hiddenQuantity, tag: { slug, name } });
// A deterministic rng that always picks the first remaining row.
const first = () => 0;

test("the modifier table is closed and small", () => {
  assert.deepEqual(
    ROOM_SEARCH_MODIFIERS.map(([slug]) => slug),
    ["eagle-eyes", "hallucinating", "night-vision", "wasted", "tipsy"],
  );
});

test("Eagle Eyes is +2, Hallucinating −2, and drink never sums", () => {
  assert.deepEqual(roomSearchModifiers(held("eagle-eyes")), [{ label: "Eagle Eyes", value: 2 }]);
  assert.deepEqual(roomSearchModifiers(held("hallucinating")), [{ label: "Hallucinating", value: -2 }]);
  assert.deepEqual(roomSearchModifiers(held("tipsy", "wasted")), [{ label: "Wasted", value: -2 }]);
  assert.deepEqual(roomSearchModifiers(held("hungry", "clumsy", "stealth")), []);
});

test("Night Vision counts only underground", () => {
  assert.deepEqual(roomSearchModifiers(held("night-vision")), []);
  assert.deepEqual(roomSearchModifiers(held("night-vision"), { underground: true }), [{ label: "Night Vision", value: 1 }]);
});

test("the modified die stays on the face of a d6", () => {
  assert.equal(roomSearchTotal(6, [{ value: 2 }]), 6);
  assert.equal(roomSearchTotal(1, [{ value: -2 }]), 1);
  assert.equal(roomSearchTotal(4, [{ value: -2 }]), 2);
});

test("one hidden stack comes up only on a 6; four give one up on a 2", () => {
  const one = [row("black-powder", 1)];
  assert.deepEqual([1, 2, 3, 4, 5].map((die) => roomSearchOutcome({ die, hidden: one, rng: first }).found.length), [0, 0, 0, 0, 0]);
  assert.equal(roomSearchOutcome({ die: 6, hidden: one, rng: first }).found.length, 1);
  const four = [row("a", 1), row("b", 1), row("c", 1), row("d", 1)];
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((die) => roomSearchOutcome({ die, hidden: four, rng: first }).found.length), [0, 1, 2, 2, 3, 4]);
});

test("Eagle Eyes lifts a 4 to a find against a single stack", () => {
  const one = [row("black-powder", 1)];
  const mods = roomSearchModifiers(held("eagle-eyes"));
  assert.equal(roomSearchOutcome({ die: 4, modifiers: mods, hidden: one, rng: first }).found.length, 1);
  assert.equal(roomSearchOutcome({ die: 3, modifiers: mods, hidden: one, rng: first }).found.length, 0);
});

test("a found stack comes out whole, and ⬢ print as a figure", () => {
  const hidden = [row("resources", 8), row("obol", 14, "Obol")];
  const { found } = roomSearchOutcome({ die: 6, hidden, rng: first });
  assert.equal(found.length, 2);
  assert.equal(roomSearchReadout({ roomName: "Fishing Hut", found }), "You search the Fishing Hut. You find: 8 ⬢, Obol ×14.");
  assert.equal(roomSearchReadout({ roomName: "Fishing Hut", found: [] }), "You search the Fishing Hut and find nothing.");
});

test("hiddenStacks reads only what is under the floor", () => {
  const tags = [{ hiddenQuantity: 0, quantity: 3 }, { hiddenQuantity: 2, quantity: 0 }, { quantity: 1 }];
  assert.equal(hiddenStacks(tags).length, 1);
});

test("the refusal ladder: dead, gone, elsewhere, locked out, no turn, blocked, blind, then go", () => {
  const room = { id: "r", locationId: "L" };
  const me = (over = {}) => ({ id: "c", status: "ALIVE", locationId: "L", tags: [], ...over });
  const turn = { id: "t" };
  assert.equal(roomSearchRefusal(me({ status: "DEAD" }), room, { turn }), "You can't do that right now.");
  assert.equal(roomSearchRefusal(me(), null, { turn }), "That room is gone.");
  assert.equal(roomSearchRefusal(me({ locationId: "M" }), room, { turn }), "You're not here.");
  assert.equal(roomSearchRefusal(me(), room, { admitted: false, turn }), "You can't get in there.");
  assert.equal(roomSearchRefusal(me(), room, { turn: null }), "No turn is open.");
  assert.equal(roomSearchRefusal(me({ tags: held("blind") }), room, { turn }), "You can't see.");
  assert.equal(roomSearchRefusal(me(), room, { turn }), null);
});
