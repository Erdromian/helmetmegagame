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

const words = (text) => text.split(" ");

test("about three words in four are scrambled, each on its own roll", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  const text = "Meet me at the old mill before dawn";
  let lost = 0;
  let total = 0;
  let partly = 0;
  for (let i = 0; i < 500; i++) {
    const out = words(scrambleText(state, `item:${i}`, text).text);
    const kept = out.filter((w, j) => w === words(text)[j]).length;
    lost += out.length - kept;
    total += out.length;
    if (kept > 0 && kept < out.length) partly++;
  }
  const share = lost / total;
  assert.ok(share > 0.72 && share < 0.78, `expected about 0.75, got ${share}`);
  // Most memories come back partly legible, not all or nothing.
  assert.ok(partly > 400, `expected most items partly legible, got ${partly}`);
});

test("a memory that kept every word comes back untouched, chips and all", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  let kept = 0;
  for (let i = 0; i < 200; i++) {
    const out = scrambleText(state, `k${i}`, "{char:cl9abc|Marrow}");
    if (!out.scrambled) {
      assert.equal(out.text, "{char:cl9abc|Marrow}");
      kept++;
    }
  }
  assert.ok(kept > 20 && kept < 80, `expected about 50 kept, got ${kept}`);
});

test("each digit of a PIN rolls on its own", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  const perDigit = [0, 0, 0, 0];
  let lost = 0;
  for (let i = 0; i < 1000; i++) {
    const out = scrambleText(state, `pin:${i}`, "4821", { eachChar: true });
    assert.match(out.text, /^[0-9]{4}$/);
    [..."4821"].forEach((d, j) => {
      // A garbled digit can land on itself one time in ten; count what changed.
      if (out.text[j] !== d) {
        perDigit[j]++;
        lost++;
      }
    });
  }
  // 75% rolled, less the one in ten that garble back to the same digit.
  const share = lost / 4000;
  assert.ok(share > 0.64 && share < 0.71, `expected about 0.675, got ${share}`);
  for (const n of perDigit) assert.ok(n > 600 && n < 750, `every position rolls, got ${perDigit}`);
  // Without eachChar the whole PIN is one word, so it is kept or lost whole.
  let whole = 0;
  for (let i = 0; i < 400; i++) {
    const out = scrambleText(state, `pin:${i}`, "4821");
    if (!out.scrambled) whole++;
  }
  assert.ok(whole > 70 && whole < 130, `expected about 100 kept whole, got ${whole}`);
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
  let found = 0;
  for (let i = 0; i < 50; i++) {
    const out = scrambleText(state, `k${i}`, "Ada, 42 - ok!");
    assert.match(out.text, /^[A-Z][a-z]{2}, [0-9]{2} - [a-z]{2}!$/);
    if (out.scrambled) found++;
  }
  assert.ok(found > 0, "some key scrambles");
});

test("an apostrophe inside a word keeps the word whole", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  for (let i = 0; i < 50; i++) {
    const out = scrambleText(state, `k${i}`, "they'll go").text;
    // One roll for "they'll": its two halves are kept or lost together.
    const [head, tail] = out.split(" ")[0].split("'");
    assert.equal(head === "they", tail === "ll", out);
  }
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

test("an entry's fields roll on their own, and an item is scrambled if any word was lost", () => {
  const state = scrambleState({ characterId: "c1", tags: [CONCUSSED], dayNumber: 4 });
  const shown = scrambleEntry(state, { id: "e1", name: "Marrow Kell", roleText: "Sheriff", notes: "" });
  assert.equal(shown.scrambled.notes, false); // nothing to lose
  assert.equal(shown.anyScrambled, shown.scrambled.name || shown.scrambled.roleText);
  let splits = 0;
  for (let i = 0; i < 100; i++) {
    const out = scrambleFields(state, `journal:${i}`, { title: "Plans", body: "Meet at the inn." });
    const titleLost = out.title !== "Plans";
    const bodyLost = out.body !== "Meet at the inn.";
    assert.equal(out.scrambled, titleLost || bodyLost);
    if (titleLost !== bodyLost) splits++;
  }
  // The title and the body no longer share one roll.
  assert.ok(splits > 0, "some item keeps one field and loses the other");
});
