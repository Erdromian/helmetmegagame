// The relay between the threads of a room that opens onto several Locations
// (bot/src/lib/roomRelay.js, db/lib/roomSides.js). relayPlan is the pure half:
// which threads a line is copied into.
//
// WHAT A FAILURE HERE MEANS. A copy posted back into the thread it came from is
// every line twice; a row meant for one reader copied to a whole thread is a
// telephone's private voice read out at a counter.
const test = require("node:test");
const assert = require("node:assert/strict");

const { relayPlan } = require("../src/lib/roomRelay");

const targets = [
  { channelId: "chan-merchant", threadId: "thread-home", locationId: "merchant", home: true },
  { channelId: "chan-slums", threadId: "thread-slums", locationId: "slums", home: false },
];
const row = (over = {}) => ({
  id: "row-1",
  placeKey: "room:counter",
  kind: "MESSAGE",
  source: "WEB",
  characterId: "ada",
  discordChannelId: null,
  onlyCharacterId: null,
  exceptCharacterId: null,
  ...over,
});
const threads = (plan) => plan.map((t) => t.threadId);

test("a web line goes home through the outbox, and to every side from here", () => {
  assert.deepEqual(threads(relayPlan(row(), targets)), ["thread-slums"]);
});

test("a Discord line is copied everywhere but the thread it was said in", () => {
  assert.deepEqual(
    threads(relayPlan(row({ source: "DISCORD", discordChannelId: "thread-slums" }), targets)),
    ["thread-home"],
  );
  assert.deepEqual(
    threads(relayPlan(row({ source: "DISCORD", discordChannelId: "thread-home" }), targets)),
    ["thread-slums"],
  );
});

test("the game's own scenery is posted home by its poster and relayed to the sides", () => {
  assert.deepEqual(threads(relayPlan(row({ source: "SYSTEM", characterId: null }), targets)), ["thread-slums"]);
});

test("nothing is relayed for a room with one thread, a non-room place, or a line meant for one reader", () => {
  assert.deepEqual(relayPlan(row(), targets.slice(0, 1)), []);
  assert.deepEqual(relayPlan(row({ placeKey: "loc:merchant" }), targets), []);
  assert.deepEqual(relayPlan(row({ onlyCharacterId: "ada" }), targets), []);
  assert.deepEqual(relayPlan(row({ exceptCharacterId: "ada" }), targets), []);
  assert.deepEqual(relayPlan(row({ kind: "TRAVEL" }), targets), []);
  assert.deepEqual(relayPlan(row({ source: "DISCORD", discordChannelId: null }), targets), []);
});
