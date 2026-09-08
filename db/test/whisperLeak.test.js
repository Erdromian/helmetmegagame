// node --test over db/lib/whisperLeak.js — the ladder, the fragment window,
// the normalising and the join. Run with `npm test --workspace=db`.
// Nothing here touches Prisma; the rng is injected so the static is pinned.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  leakLine,
  fragmentCountFor,
  FRAGMENT_MIN_WORDS,
  FRAGMENT_MAX_WORDS,
  FRAGMENT_MAX_CHARS,
  MESSAGE_WEIGHT_CAP,
  SEPARATOR,
} = require("../lib/whisperLeak");

// A generator of `n` words, so a test can hit a ladder tier exactly.
const words = (n, stem = "word") =>
  Array.from({ length: n }, (_, i) => `${stem}${i}`).join(" ");

// rng that never garbles: muffle keeps a character when rng() >= fraction,
// and 0.999 clears every fraction the game uses. Fragment selection still
// works off it, always landing on the first choice.
const clear = () => 0.999;

test("the ladder tiers", () => {
  assert.equal(fragmentCountFor(0), 0);
  assert.equal(fragmentCountFor(1), 1);
  assert.equal(fragmentCountFor(79), 1);
  assert.equal(fragmentCountFor(80), 2);
  assert.equal(fragmentCountFor(199), 2);
  assert.equal(fragmentCountFor(200), 3);
  assert.equal(fragmentCountFor(449), 3);
  assert.equal(fragmentCountFor(450), 4);
  assert.equal(fragmentCountFor(899), 4);
  assert.equal(fragmentCountFor(900), 5);
  assert.equal(fragmentCountFor(1799), 5);
  assert.equal(fragmentCountFor(1800), 6);
  assert.equal(fragmentCountFor(100000), 6);
});

test("nothing to overhear returns null", () => {
  assert.equal(leakLine([], { rng: clear }), null);
  assert.equal(leakLine(["   ", ""], { rng: clear }), null);
  assert.equal(leakLine(null, { rng: clear }), null);
});

test("a short window leaks one fragment", () => {
  const line = leakLine([words(20)], { rng: clear });
  assert.equal(line.includes(SEPARATOR), false);
  assert.ok(line.split(/\s+/).length <= FRAGMENT_MAX_WORDS);
});

test("a message shorter than the floor leaks whole", () => {
  assert.equal(leakLine(["run now"], { rng: clear }), "run now");
});

test("fragments always sit inside the word window", () => {
  // A real rng, many draws: every fragment of a long message must be in range.
  for (let i = 0; i < 200; i += 1) {
    const line = leakLine([words(300)], {});
    for (const fragment of line.split(SEPARATOR)) {
      const n = fragment.trim().split(/\s+/).length;
      assert.ok(
        n >= FRAGMENT_MIN_WORDS && n <= FRAGMENT_MAX_WORDS,
        `fragment of ${n} words: ${fragment}`,
      );
    }
  }
});

test("the fragment count follows the total across every message", () => {
  // 3 messages x 80 words = 240 words, tier 3.
  const line = leakLine([words(80, "a"), words(80, "b"), words(80, "c")], { rng: clear });
  assert.equal(line.split(SEPARATOR).length, 3);
});

test("the separator survives ungarbled", () => {
  const line = leakLine([words(80, "a"), words(80, "b"), words(80, "c")], {});
  assert.equal(line.split(SEPARATOR).length, 3);
});

test("mentions and custom emoji never reach the pool", () => {
  const line = leakLine(["<@123456789012345678> <#987654321> <:skull:42> hello there friend"], {
    rng: clear,
  });
  assert.equal(line, "hello there friend");
});

test("garbling replaces most of the text but keeps the shape", () => {
  const line = leakLine(["alpha bravo charlie delta echo"], { rng: () => 0 });
  // rng 0 is below every fraction, so every non-space character goes.
  assert.match(line, /^[░▒▓]+( [░▒▓]+)*$/);
  // rng 0 also picks the shortest window, so it is the first four words.
  assert.equal(line.split(" ").length, FRAGMENT_MIN_WORDS);
  assert.deepEqual(
    line.split(" ").map((w) => w.length),
    [5, 5, 7, 5],
  );
});

test("a short pool does not leak the same fragment repeatedly", () => {
  // 120 words is tier 2, from one message with only a few distinct windows.
  const line = leakLine([words(120)], {});
  const [first, second] = line.split(SEPARATOR);
  assert.notEqual(first, second);
});

test("an archived attachment placeholder is not speech and never leaks", () => {
  // The spelling proxy.js#attachmentPlaceholders actually writes, on its own
  // line, either alone or under the words that came with it.
  assert.equal(leakLine(["[image]"], { rng: clear }), null);
  assert.equal(leakLine(["[attachment]", "[image]"], { rng: clear }), null);
  assert.equal(
    leakLine(["meet me by the well\n[image]"], { rng: clear }),
    "meet me by the well",
  );
});

test("emphasis marks are stripped rather than garbled", () => {
  assert.equal(leakLine(["**meet** me _by_ the well"], { rng: clear }), "meet me by the well");
});

test("a message with no whitespace cannot leak whole", () => {
  // A pasted blob is one "word", so the word rules alone would return all of
  // it — and 1900 characters is a message Discord refuses, which would cost
  // the room the name line too.
  const blob = "A".repeat(1900);
  assert.ok(Array.from(leakLine([blob], { rng: clear })).length <= FRAGMENT_MAX_CHARS);
});

test("a non-spaced script gets a window, not the whole message", () => {
  const jp = "今日の夜、門は開いています。誰も見ていません。急いでください。";
  for (let i = 0; i < 50; i += 1) {
    const line = leakLine([jp], {});
    assert.ok(
      Array.from(line).length < Array.from(jp).length,
      `leaked the whole message: ${line}`,
    );
  }
});

test("the whole line stays well inside Discord's limit", () => {
  // Six fragments is the top of the ladder; nothing may approach 2000 chars.
  const heavy = Array.from({ length: 60 }, () => words(40)).join(" ");
  for (let i = 0; i < 50; i += 1) {
    assert.ok(Array.from(leakLine([heavy], {})).length <= 600);
  }
});

test("a wall of pasted text cannot drown the conversation around it", () => {
  const junk = Array(2000).fill("junk").join(" ");
  const real = "the marshal keeps his keys in the drawer under the ledger";
  // Capped weight: the junk counts for MESSAGE_WEIGHT_CAP, not 2000, so the
  // ladder stays low and the real message keeps a real share of the draw.
  // The ladder reads 80 + 10, not 2010, so the paste does not turn a quiet
  // window into a six-fragment one.
  assert.equal(fragmentCountFor(MESSAGE_WEIGHT_CAP + 10), 2);

  // And the real message keeps a real share of the draw. A line free of junk
  // needs BOTH fragments to come from it: about (10/90)^2, so ~25 in 2000.
  // Uncapped it would be (10/2010)^2 — about one line in twenty thousand —
  // so this bar separates the two by orders of magnitude without being flaky.
  let clean = 0;
  for (let i = 0; i < 2000; i += 1) {
    if (!leakLine([junk, real], {}).includes("j")) clean += 1;
  }
  assert.ok(clean > 5, `only ${clean}/2000 lines free of the paste`);
});

test("surrogate pairs are muffled whole, never split into lone halves", () => {
  const line = leakLine(["meet me 👨 by the well at dawn"], { rng: () => 0 });
  assert.equal(line.includes("�"), false);
  for (const ch of line) assert.ok(/[░▒▓\s]/.test(ch), `stray unit: ${ch}`);
});
