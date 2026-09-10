// What lights a channel in the places column.
//
// WHAT A FAILURE HERE MEANS. This predicate is the whole unread mark on
// /chat, and both ways of getting it wrong are silent.
//
// Too NARROW and the column goes dark: it used to require a row in a
// conversation or a mention of you by name, which meant ordinary roleplay in
// a Room moved nothing — and a GM, who is in GM mode precisely because they
// have no character, had no token and sat in no conversations, so nothing
// ever lit and the only way to find a scene was to open every channel in
// turn. That is the bug this replaced, and `selfId` being null must keep
// working.
//
// Too WIDE and the mark stops meaning anything: CHAT.md's own account of the
// first version is that lighting up for scenery — somebody lifting a stamp
// off a table — is what made people ignore it. `source: "SYSTEM"` is the
// game talking to itself, and is the one thing held back.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isNotableRow } = require("../../web/app/(app)/chat/feedStore.js");

const ME = "char-me";
const THEM = "char-them";
const PLACE = "loc:the-square";

// Only the fields the predicate reads.
function row(over = {}) {
  return { source: "WEB", characterId: THEM, content: "Hello.", ...over };
}

test("somebody speaking lights the place", () => {
  assert.equal(isNotableRow(PLACE, row(), ME), true);
});

test("a line proxied out of Discord counts exactly as a typed one", () => {
  // Both faces write to the same table; a scene happening on Discord must
  // light the same channel it would have lit on the web.
  assert.equal(isNotableRow(PLACE, row({ source: "DISCORD" }), ME), true);
});

test("the game talking to itself does not", () => {
  // A gate crossing, a smell in a Location, a turn banner.
  assert.equal(isNotableRow(PLACE, row({ source: "SYSTEM", characterId: null }), ME), false);
});

test("your own words are not news", () => {
  assert.equal(isNotableRow(PLACE, row({ characterId: ME }), ME), false);
});

test("a GM with no character still sees speech", () => {
  // THE REGRESSION THIS FILE EXISTS FOR. A null selfId used to return false
  // on the first line, so every place came back unlit for the one person
  // reading all of them.
  assert.equal(isNotableRow(PLACE, row(), null), true);
  assert.equal(isNotableRow(PLACE, row(), undefined), true);
  // And scenery stays quiet for them too, or the fix trades one useless
  // column for another.
  assert.equal(isNotableRow(PLACE, row({ source: "SYSTEM", characterId: null }), null), false);
});

test("a conversation row and a mention still light, without being special-cased", () => {
  // Both used to be their own arm of the rule. Speech subsumes them: a
  // conversation row is a person speaking, and so is a mention. If either
  // ever stops lighting, the widening has been undone somewhere.
  assert.equal(isNotableRow("conv:abc", row(), ME), true);
  assert.equal(isNotableRow(PLACE, row({ content: `hey {char:${ME}} over here` }), ME), true);
});

test("a row with no author is not assumed to be scenery", () => {
  // Scenery is identified by `source`, never by a missing characterId — a
  // proxied line that never resolved to a character is still somebody
  // speaking, and the server-side query has to agree (feedAccess.js spells
  // its exclusion with an explicit null arm for this reason).
  assert.equal(isNotableRow(PLACE, row({ characterId: null }), ME), true);
});

test("nothing at all lights nothing", () => {
  assert.equal(isNotableRow(PLACE, null, ME), false);
  assert.equal(isNotableRow(PLACE, undefined, ME), false);
});
