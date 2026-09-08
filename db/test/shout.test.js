// node --test over db/lib/shout.js — the distance ladder, and who gets named.
const test = require("node:test");
const assert = require("node:assert/strict");
const { shoutParts, shouterNameFor } = require("../lib/shout");

test("your own Location hears the words whole", () => {
  assert.equal(shoutParts("Run!", 0, null).text, "You hear someone shout: » Run!");
});

test("one hop away hears the words clear, with the direction", () => {
  assert.equal(shoutParts("Run!", 1, "the Gate").text, "You hear someone shout from the direction of the Gate: » Run!");
});

test("two hops away hears static of the same length", () => {
  const { text } = shoutParts("Run now", 2, "the Gate");
  assert.match(text, /^You hear someone shout from the direction of the Gate: » .{7}$/);
});

test("three hops away hears only that someone shouted, and which way", () => {
  assert.equal(shoutParts("Run!", 3, "the Gate").text, "You hear someone shout from the direction of the Gate.");
  assert.equal(shoutParts("Run!", 3, null).text, "You hear someone shout somewhere nearby.");
});

// ------------------------------------------------------------------ the name

test("your own Location is told who shouted", () => {
  assert.equal(
    shoutParts("Run!", 0, null, { shouterName: "Baroness Ophidia" }).text,
    "Baroness Ophidia shouts: » Run!",
  );
});

test("a hood shouts as the alias, article and all", () => {
  assert.equal(shoutParts("Run!", 0, null, { shouterName: "A young man" }).text, "A young man shouts: » Run!");
});

// The fallback contract: an identity that failed to load must leave the old
// anonymous line standing rather than printing "null shouts".
test("no name at distance 0 falls back to the anonymous line", () => {
  assert.equal(shoutParts("Run!", 0, null, {}).text, "You hear someone shout: » Run!");
  assert.equal(shoutParts("Run!", 0, null, { shouterName: null }).text, "You hear someone shout: » Run!");
});

// This is the guarantee the whole feature rests on: naming the shouter at
// distance 0 must not name them anywhere else, or a concealed character is
// unmasked across three hops of the map.
test("a name is ignored at every distance past your own", () => {
  assert.equal(
    shoutParts("Run!", 1, "the Gate", { shouterName: "Baroness Ophidia" }).text,
    "You hear someone shout from the direction of the Gate: » Run!",
  );
  for (const distance of [1, 2, 3]) {
    const { text } = shoutParts("Run!", distance, "the Gate", { shouterName: "Baroness Ophidia" });
    assert.doesNotMatch(text, /Ophidia/, `distance ${distance} leaked the name`);
  }
});

// ----------------------------------------------------------------- the walls

test("a soundproof room tells the room the walls ate it", () => {
  assert.equal(
    shoutParts("Run!", 0, null, { shouterName: "Baroness Ophidia", muffled: true }).text,
    "Baroness Ophidia shouts: » Run!, but it's muffled.",
  );
  assert.equal(
    shoutParts("Run!", 0, null, { muffled: true }).text,
    "You hear someone shout: » Run!, but it's muffled.",
  );
});

// Nothing past distance 0 exists when the room is soundproof, so the flag has
// nothing to say there — but it must not corrupt the line if it is passed.
test("muffled has no effect past your own Location", () => {
  assert.equal(
    shoutParts("Run!", 1, "the Gate", { muffled: true }).text,
    "You hear someone shout from the direction of the Gate: » Run!",
  );
});

// ------------------------------------------------------------- which name

// presentedIdentity() returns Title Case ("Young Man") because it doubles as a
// webhook username. Mid-sentence that reads as somebody actually called Young
// Man, so a hood takes aliasSubject()'s "A young man" instead. Pinned here so
// nobody "fixes" the divergence later.
test("a concealed shouter takes the lowercase alias, not the webhook name", () => {
  const character = { age: 20, gender: "MAN" };
  assert.equal(shouterNameFor(character, { name: "Young Man", concealed: true }), "A young man");
  assert.equal(shouterNameFor({ age: 60, gender: "WOMAN" }, { name: "Old Woman", concealed: true }), "An old woman");
});

test("an unconcealed shouter takes their own name, and a forced one takes the mask's", () => {
  const character = { age: 30, gender: "WOMAN" };
  assert.equal(shouterNameFor(character, { name: "Baroness Ophidia", concealed: false }), "Baroness Ophidia");
  assert.equal(shouterNameFor(character, { name: "Beast", concealed: false, forced: true }), "Beast");
});

test("no identity at all is no name at all", () => {
  assert.equal(shouterNameFor({ age: 30, gender: "MAN" }, null), null);
  assert.equal(shouterNameFor({}, { name: "", concealed: false }), null);
});
