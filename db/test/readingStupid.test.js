const test = require("node:test");
const assert = require("node:assert");
const { readBlock } = require("../lib/reading");
const { canReadLetters } = require("../lib/bird");

const tags = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));

test("stupid overrides literate", () => {
  assert.strictEqual(readBlock(tags("literate")), null);
  assert.notStrictEqual(readBlock(tags("literate", "stupid")), null);
  assert.strictEqual(canReadLetters(tags("literate", "stupid")), false);
});

test("slow overrides literate, the same way stupid does", () => {
  assert.notStrictEqual(readBlock(tags("literate", "slow")), null);
  assert.strictEqual(canReadLetters(tags("literate", "slow")), false);
});

test("slow alone still can't read — it isn't a substitute for literate", () => {
  assert.notStrictEqual(readBlock(tags("slow")), null);
  assert.strictEqual(canReadLetters(tags("slow")), false);
});
