// Concussed and Amnesiac scramble what /memories shows (db/lib/memoryScramble.js,
// docs/systemdocs/MEMORIES.md §5). Pure, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scrambleState,
  scrambleText,
  scrambleEntry,
  scrambleFields,
  RESCRAMBLE_DAYS,
} = require("../lib/memoryScramble");

const CONCUSSED = { acquiredAt: new Date("2026-09-20T10:00:00Z"), tag: { slug: "concussed" } };
const SWORD = { acquiredAt: new Date("2026-09-01T10:00:00Z"), tag: { slug: "sword" } };

test("nothing is scrambled without a scrambling tag", () => {
  const state = scrambleState({ characterId: "c1", tags: [SWORD], dayNumber: 4 });
  assert.equal(state.active, false);
  assert.deepEqual(scrambleText(state, "k", "Marrow Kell"), { text: "Marrow Kell", scrambled: false });
});

test("about three items in four are scrambled", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  let scrambled = 0;
  for (let i = 0; i < 2000; i++) if (scrambleText(state, `item:${i}`, "Some words").scrambled) scrambled++;
  assert.ok(scrambled > 1400 && scrambled < 1600, `expected about 1500, got ${scrambled}`);
});

test("the same memory scrambles the same way every time", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  const again = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(scrambleText(state, `k${i}`, "Marrow Kell"), scrambleText(again, `k${i}`, "Marrow Kell"));
  }
});

test("a scrambled text keeps its shape: case, digits, spaces and punctuation", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  let found = null;
  for (let i = 0; i < 50 && !found; i++) {
    const out = scrambleText(state, `k${i}`, "Ada, 42 - ok!");
    if (out.scrambled) found = out.text;
  }
  assert.ok(found, "some key scrambles");
  assert.match(found, /^[A-Z][a-z]{2}, [0-9]{2} - [a-z]{2}!$/);
  assert.notEqual(found, "Ada, 42 - ok!");
});

test("the fog shifts every few days, and holds still between", () => {
  const seeds = [0, 1, 2, 3, 4, 5].map((day) => scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: day }).seed);
  assert.equal(RESCRAMBLE_DAYS, 3);
  assert.equal(seeds[0], seeds[2]);
  assert.notEqual(seeds[2], seeds[3]);
  assert.equal(seeds[3], seeds[5]);
});

test("a fresh concussion scrambles differently from the last one", () => {
  const later = { ...CONCUSSED, acquiredAt: new Date("2026-09-22T10:00:00Z") };
  const a = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 }).seed;
  const b = scrambleState({ characterId: "c1", tags: [later], dayNumber: 4 }).seed;
  assert.notEqual(a, b);
});

test("a chip is flattened before it is garbled, so no id survives", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  for (let i = 0; i < 30; i++) {
    const out = scrambleText(state, `k${i}`, "Ask {char:cl9abc|Marrow} now");
    if (out.scrambled) assert.ok(!out.text.includes("cl9abc") && !out.text.includes("{"), out.text);
  }
});

test("an entry's fields roll on their own, and a multi-field item rolls once", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  const shown = scrambleEntry(state, { id: "e1", name: "Marrow Kell", roleText: "Sheriff", notes: "" });
  assert.equal(shown.scrambled.notes, false); // nothing to lose
  assert.equal(shown.anyScrambled, shown.scrambled.name || shown.scrambled.roleText);
  for (let i = 0; i < 30; i++) {
    const out = scrambleFields(state, `journal:${i}`, { title: "Plans", body: "Meet at the inn." });
    if (out.scrambled) {
      assert.notEqual(out.title, "Plans");
      assert.notEqual(out.body, "Meet at the inn.");
    } else {
      assert.equal(out.title, "Plans");
      assert.equal(out.body, "Meet at the inn.");
    }
  }
});
