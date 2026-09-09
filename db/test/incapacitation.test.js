const test = require("node:test");
const assert = require("node:assert");
const {
  ACT,
  SPEAK,
  SHOUT,
  blockerFor,
  slugsBlocking,
} = require("../lib/incapacitation");

// The seam, not the table. These assert the three distinctions the game
// actually turns on, so a later edit to RESTRICTIONS that collapses two of
// them fails here rather than in a channel.

const held = (...slugs) => slugs.map((slug) => ({ slug, name: slug }));

test("Mute takes the yell and leaves the voice", () => {
  assert.equal(blockerFor(held("mute"), SPEAK), null);
  assert.equal(blockerFor(held("mute"), ACT), null);
  assert.equal(blockerFor(held("mute"), SHOUT)?.slug, "mute");
});

test("SPEAK implies SHOUT, and never the other way round", () => {
  assert.equal(blockerFor(held("paralyzed"), SPEAK)?.slug, "paralyzed");
  assert.equal(blockerFor(held("paralyzed"), SHOUT)?.slug, "paralyzed");
});

test("a hostage can still yell for help", () => {
  assert.equal(blockerFor(held("bound"), ACT)?.slug, "bound");
  assert.equal(blockerFor(held("bound"), SPEAK), null);
  assert.equal(blockerFor(held("bound"), SHOUT), null);
});

test("Catatonic never blocks speech, or the tag seals itself shut", () => {
  // db/lib/catatonicDeathPass.js kills for inactivity, and talking is what
  // lifts the tag. Gate it and the player can never get out.
  assert.equal(blockerFor(held("catatonic-afk"), SPEAK), null);
  assert.equal(blockerFor(held("catatonic-afk"), SHOUT), null);
});

test("blockerFor reads both tag shapes", () => {
  // Callers arrive through different includes: some hand down
  // { tag: { slug } } rows, the fallback query hands down bare ones.
  assert.equal(blockerFor([{ tag: { slug: "mute", name: "Mute" } }], SHOUT)?.name, "Mute");
  assert.equal(blockerFor([{ slug: "mute" }], SHOUT)?.name, "mute");
});

test("VOICE_SLUGS gets the superset it is built from", () => {
  // db/lib/say.js builds its one query off slugsBlocking(SHOUT). Too narrow
  // and a silenced character talks; too wide and Mute goes mute again.
  const shout = slugsBlocking(SHOUT);
  const speak = slugsBlocking(SPEAK);
  assert.ok(shout.includes("mute"));
  assert.ok(shout.includes("paralyzed"));
  assert.ok(!speak.includes("mute"));
  assert.ok(speak.includes("paralyzed"));
  assert.ok(speak.every((slug) => shout.includes(slug)));
});
