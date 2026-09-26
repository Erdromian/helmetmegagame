// Two Discord readouts built for a player on a phone: the links under a
// traveller's "Moved to" (db/lib/syncZones/bodies.js#arrivalLinksLine), and
// /storage's list of every stash where they stand
// (db/lib/roomStash.js#formatLocationStorage). Also pins the pinned anchor's
// Public Rooms line, which now shares its link builder with the first — the
// anchor is hashed, so any change to its text re-edits every Location's pin.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnchorBody, publicRoomLinks, arrivalLinksLine } = require("../lib/syncZones/bodies");
const { formatLocationStorage } = require("../lib/roomStash");

const ROOMS = [
  { kind: "PUBLIC", discordThreadId: "t2", sortOrder: 2 },
  { kind: "PRIVATE", discordThreadId: "t9", sortOrder: 0 },
  { kind: "PUBLIC", discordThreadId: null, sortOrder: 3 },
  { kind: "PUBLIC", discordThreadId: "t1", sortOrder: 1 },
];

test("public room links: public rooms with a thread, in authored order", () => {
  assert.equal(publicRoomLinks(ROOMS), "<#t1> | <#t2>");
  assert.equal(publicRoomLinks([]), "");
});

test("the anchor's Public Rooms line is unchanged", () => {
  const location = { name: "Square", description: "An open clearing." };
  assert.equal(
    buildAnchorBody(location, ROOMS),
    "**Square**\n-# An open clearing.\n**Public Rooms**: <#t1> | <#t2>",
  );
  assert.equal(buildAnchorBody(location, []), "**Square**\n-# An open clearing.\n**Public Rooms**: none");
});

test("arrival links: the channel, then its public rooms", () => {
  assert.equal(arrivalLinksLine({ discordChannelId: "c1" }, ROOMS), "-# <#c1> · Rooms: <#t1> | <#t2>");
});

test("arrival links: a place with no public rooms still links its channel", () => {
  assert.equal(arrivalLinksLine({ discordChannelId: "c1" }, [ROOMS[1]]), "-# <#c1>");
});

test("arrival links: nothing when the place has no channel", () => {
  assert.equal(arrivalLinksLine({ discordChannelId: null }, ROOMS), null);
  assert.equal(arrivalLinksLine(null, ROOMS), null);
});

const stack = (slug, name, quantity) => ({ quantity, tag: { slug, name } });

test("storage: every room under its label, then where to move things", () => {
  const text = formatLocationStorage("Square", [
    { label: "<#t1>", room: { tags: [stack("resources", "Resources", 15), stack("lantern", "Lantern", 1)] }, hidden: 2 },
    { label: "**Cellar**", room: { tags: [] }, hidden: 0 },
  ]);
  assert.equal(
    text,
    [
      "**Storage at Square**",
      "<#t1>",
      "-# 15 ⬢ | **Tags**: Lantern",
      "-# 2 things are hidden here.",
      "**Cellar**",
      "-# Nothing is stored here.",
      "-# Nothing is hidden here.",
      "-# Putting things in or taking them out is Transfer, on the web.",
    ].join("\n"),
  );
});

test("storage: a place with no rooms says so", () => {
  assert.equal(
    formatLocationStorage("Road", []),
    "**Storage at Road**\n-# There are no rooms here to keep anything in.",
  );
});
