// Mentions across a room that opens onto several Locations (bot/src/lib/mentions.js,
// docs/systemdocs/PROXYING.md §6, MAP.md §2d).
//
// WHAT A FAILURE HERE MEANS. An @ typed in the Gate's Bridge thread reached nobody standing
// in the Town Gatehouse, though both were in the room and heard the line. And the DM a
// far-side reader did get linked to a thread under a channel they can't see.
const test = require("node:test");
const assert = require("node:assert/strict");

const { canHearPing, linkForReader } = require("../src/lib/mentions");

const GUILD = "guild-1";
const threads = [
  { channelId: "chan-gatehouse", threadId: "thread-home", locationId: "gatehouse", home: true },
  { channelId: "chan-bridge", threadId: "thread-bridge", locationId: "bridge", home: false },
];
const link = `https://discord.com/channels/${GUILD}/thread-home/msg-1`;

test("a reader on the side it was said keeps the link to the line", () => {
  assert.equal(
    linkForReader({ link, threads, originThreadId: "thread-home", readerLocationId: "gatehouse", guildId: GUILD }),
    link,
  );
});

test("a reader on the other side is sent to their own side's thread", () => {
  assert.equal(
    linkForReader({ link, threads, originThreadId: "thread-home", readerLocationId: "bridge", guildId: GUILD }),
    `https://discord.com/channels/${GUILD}/thread-bridge`,
  );
  // And the other way round: said on the Bridge, read at home.
  assert.equal(
    linkForReader({
      link: `https://discord.com/channels/${GUILD}/thread-bridge/msg-2`,
      threads,
      originThreadId: "thread-bridge",
      readerLocationId: "gatehouse",
      guildId: GUILD,
    }),
    `https://discord.com/channels/${GUILD}/thread-home`,
  );
});

test("any place with one thread keeps the link as it is", () => {
  assert.equal(linkForReader({ link, threads: [], originThreadId: "x", readerLocationId: "bridge", guildId: GUILD }), link);
  assert.equal(
    linkForReader({ link, threads: [threads[0]], originThreadId: "thread-home", readerLocationId: "bridge", guildId: GUILD }),
    link,
  );
});

test("no thread on the reader's side, or nothing to go on: the original link", () => {
  assert.equal(
    linkForReader({ link, threads, originThreadId: "thread-home", readerLocationId: "square", guildId: GUILD }),
    link,
  );
  assert.equal(linkForReader({ link, threads, originThreadId: "unknown", readerLocationId: "bridge", guildId: GUILD }), link);
  assert.equal(linkForReader({ link, threads, originThreadId: "thread-home", readerLocationId: null, guildId: GUILD }), link);
  assert.equal(linkForReader({ link, threads, originThreadId: "thread-home", readerLocationId: "bridge", guildId: null }), link);
  assert.equal(linkForReader({ link: null, threads, originThreadId: "thread-home", readerLocationId: "bridge", guildId: GUILD }), null);
});

test("outside a room, earshot is still the thread's own Location", async () => {
  const context = { locationId: "bridge", zoneId: "town", channelKind: null };
  assert.equal(await canHearPing({ locationId: "bridge", zoneId: "town" }, context, "loc:bridge"), true);
  assert.equal(await canHearPing({ locationId: "gatehouse", zoneId: "town" }, context, "loc:bridge"), false);
  // No place key at all (an older caller): the same Location rule.
  assert.equal(await canHearPing({ locationId: "gatehouse", zoneId: "town" }, context), false);
});
