// node --test over db/lib/gambitModifier.js. This file had no coverage until
// the mood rework, and it is the one place where a missed argument goes wrong
// SILENTLY: the Afraid and Panicking penalties used to be read off tag slugs
// and are now read off Character.mood, so a call site that forgets to pass
// (or select) `mood` quietly hands somebody back a penalty they should be
// carrying. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { gambitModifiers, gambitModifierTotal, formatGambitModifiers } = require("../lib/gambitModifier");

const hungry = [{ tag: { slug: "hungry" } }];

test("the two bottom mood bands are the only ones that cost dice", () => {
  assert.equal(gambitModifierTotal([], { mood: -90 }), -2);
  assert.equal(gambitModifierTotal([], { mood: -82 }), -2);
  assert.equal(gambitModifierTotal([], { mood: -70 }), -1);
  assert.equal(gambitModifierTotal([], { mood: -64 }), -1);
  assert.equal(gambitModifierTotal([], { mood: -63.99 }), 0);
});

test("a good mood is flavour — Content, Pleased and Happy roll the same", () => {
  for (const mood of [0, 10, 28, 46, 64]) {
    assert.equal(gambitModifierTotal([], { mood }), 0, `mood ${mood} should not modify a Gambit`);
  }
});

test("the band is NAMED, so the confirm DM can say why", () => {
  assert.deepEqual(gambitModifiers([], { mood: -70 }), [{ label: "Afraid", value: -1 }]);
  assert.deepEqual(gambitModifiers([], { mood: -90 }), [{ label: "Panicking", value: -2 }]);
  assert.deepEqual(gambitModifiers([], { mood: 50 }), []);
});

test("hunger sums on top of the mood, and scales with the streak", () => {
  assert.equal(gambitModifierTotal(hungry, { hungerStreak: 1, mood: 0 }), -1);
  assert.equal(gambitModifierTotal(hungry, { hungerStreak: 3, mood: 0 }), -3);
  assert.equal(gambitModifierTotal(hungry, { hungerStreak: 3, mood: -90 }), -5);
  // Holding the tag with no streak recorded still costs the first point.
  assert.equal(gambitModifierTotal(hungry, { mood: 0 }), -1);
  // Not holding it costs nothing, whatever the streak says.
  assert.equal(gambitModifierTotal([], { hungerStreak: 4, mood: 0 }), 0);
});

test("a bare Tag[] works as well as the CharacterTag[] shape", () => {
  assert.equal(gambitModifierTotal([{ slug: "hungry" }], { hungerStreak: 2, mood: 0 }), -2);
});

test("no mood argument means Fine, which is the silent failure worth naming", () => {
  // Documented, not endorsed: every call site must pass and select `mood`.
  assert.equal(gambitModifierTotal([], {}), 0);
  assert.equal(gambitModifierTotal([]), 0);
});

test("the breakdown formats with a real minus sign, as the bot rolls it", () => {
  assert.equal(formatGambitModifiers(gambitModifiers(hungry, { hungerStreak: 2, mood: -90 })), "−2 Hungry −2 Panicking");
});
