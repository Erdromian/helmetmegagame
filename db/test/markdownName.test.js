// A Lavish meal is named "*Caviar*", and a name printed into Markdown lost
// its asterisks to emphasis. markdownName escapes it; the shared formatters
// that print a held thing's name into a DM or a room line go through it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { markdownName } = require("../lib/markdownName");
const { decorateMealName } = require("../lib/meals");
const { formatManifest, formatStack } = require("../lib/roomStash");
const { hungerDm } = require("../lib/hunger");

const CAVIAR = decorateMealName("LAVISH", "Caviar");

test("a Lavish name keeps its asterisks", () => {
  assert.equal(CAVIAR, "*Caviar*");
  assert.equal(markdownName(CAVIAR), "\\*Caviar\\*");
});

test("an ordinary name is untouched", () => {
  assert.equal(markdownName("Meat Pie"), "Meat Pie");
  assert.equal(markdownName("+Scones+"), "+Scones+");
  assert.equal(markdownName("Adder's Bite (2)"), "Adder's Bite (2)");
  assert.equal(markdownName(null), "");
});

test("escaping twice is the same as once", () => {
  assert.equal(markdownName(markdownName(CAVIAR)), markdownName(CAVIAR));
});

test("the stash and hand-over formatters escape the name", () => {
  assert.equal(formatStack(CAVIAR, 2), "\\*Caviar\\* ×2");
  assert.equal(formatManifest([{ tagName: CAVIAR, quantity: 1 }], 3), "\\*Caviar\\* and 3 ⬢");
});

test("the auto-eat DM escapes the name", () => {
  const dm = hungerDm({ kinds: ["autoAte"], ate: [{ slug: "lavish-meal", name: CAVIAR, count: 1 }] });
  assert.match(dm, /your \\\*Caviar\\\*/);
});
