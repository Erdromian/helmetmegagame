// node --test over db/lib/archive.js#feedRowShape — which face a feed row wears.
const test = require("node:test");
const assert = require("node:assert/strict");
const { feedRowShape } = require("../lib/archive");

const base = { seq: 1n, placeKey: "location:abc", characterId: "c1", characterName: "Sir Alder", content: "hi" };

test("a bare-faced row carries no path, so the client asks for their own face", () => {
  const row = feedRowShape({ ...base });
  assert.equal(row.avatarPath, null);
  assert.equal(row.name, "Sir Alder");
});

test("a masked row wears the frozen helm", () => {
  const row = feedRowShape({
    ...base,
    concealedAlias: "Young Man",
    presentedAvatarPath: "/assets/helms/silvermask.webp",
  });
  assert.equal(row.avatarPath, "/assets/helms/silvermask.webp");
  assert.equal(row.name, "Young Man");
});

test("a forced name wears the frozen plaque", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/B.webp" });
  assert.equal(row.avatarPath, "/assets/letters/B.webp");
});

test("a row from before the column keeps its secret rather than guessing", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Young Man" });
  assert.equal(row.avatarPath, "/assets/unknown.png");
});
