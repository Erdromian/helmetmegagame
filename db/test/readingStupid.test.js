const test = require("node:test");
const assert = require("node:assert");
const { readBlock } = require("../lib/reading");
const { canReadLetters } = require("../lib/bird");

const tags = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));

test("stupid overrides literate", () => {
  assert.strictEqual(readBlock(tags("literacy")), null);
  assert.notStrictEqual(readBlock(tags("literacy", "stupid")), null);
  assert.strictEqual(canReadLetters(tags("literacy", "stupid")), false);
});

test("slow overrides literate, the same way stupid does", () => {
  assert.notStrictEqual(readBlock(tags("literacy", "slow")), null);
  assert.strictEqual(canReadLetters(tags("literacy", "slow")), false);
});

test("slow alone still can't read — it isn't a substitute for literate", () => {
  assert.notStrictEqual(readBlock(tags("slow")), null);
  assert.strictEqual(canReadLetters(tags("slow")), false);
});
