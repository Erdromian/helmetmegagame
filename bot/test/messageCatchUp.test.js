// node --test over bot/src/lib/messageCatchUp.js — the two decisions the
// recovery pass turns on. Everything else in that module is Discord I/O and is
// verified by hand against a real guild (docs/systemdocs/PROXYING.md).
//
// --test-force-exit is not optional here: bot/src/lib/channels.js registers a
// five-minute setInterval at module load, so requiring anything that reaches it
// keeps the event loop alive forever.
const test = require("node:test");
const assert = require("node:assert/strict");
const { selectMissed, recoveryKind, REPOST_WINDOW_MS } = require("../src/lib/messageCatchUp");

const CHANNEL = "111";
const now = 1_700_000_000_000;

// The shape selectMissed reads off a discord.js Message.
function msg(id, at, extra = {}) {
  return { id, createdTimestamp: at, author: { bot: false, id: "u1" }, ...extra };
}

test("a message the bot never proxied is picked up", () => {
  const out = selectMissed([msg("1", now - 60_000)], { channelId: CHANNEL, settleBefore: now });
  assert.equal(out.length, 1);
});

// The bot's own posts and the character reposts are already handled — picking
// either one up would proxy the proxy.
test("bot posts and webhook reposts are left alone", () => {
  const out = selectMissed(
    [
      msg("1", now - 60_000, { author: { bot: true, id: "b" } }),
      msg("2", now - 60_000, { webhookId: "wh" }),
      msg("3", now - 60_000, { system: true }),
      msg("4", now - 60_000),
    ],
    { channelId: CHANNEL, settleBefore: now },
  );
  assert.deepEqual(out.map((m) => m.id), ["4"]);
});

// A thread's opening message carries the thread's own id. Deleting it destroys
// the whole thread, so this filter is the difference between recovering a line
// and losing a room.
test("the thread's own starter message is never touched", () => {
  const out = selectMissed([msg(CHANNEL, now - 60_000), msg("9", now - 60_000)], {
    channelId: CHANNEL,
    settleBefore: now,
  });
  assert.deepEqual(out.map((m) => m.id), ["9"]);
});

// By the time the pass runs the gateway is live again, so the newest few
// seconds may be in messageCreate's hands right now. Both of us proxying one
// message would post it twice.
test("messages newer than the settle line are left to the live handler", () => {
  const out = selectMissed([msg("1", now - 2_000), msg("2", now - 60_000)], {
    channelId: CHANNEL,
    settleBefore: now - 10_000,
  });
  assert.deepEqual(out.map((m) => m.id), ["2"]);
});

test("a recovered scene comes back in the order it was said", () => {
  const out = selectMissed([msg("c", now - 10_000), msg("a", now - 90_000), msg("b", now - 50_000)], {
    channelId: CHANNEL,
    settleBefore: now,
  });
  assert.deepEqual(out.map((m) => m.id), ["a", "b", "c"]);
});

// The split: inside the window it goes back in the room, outside it the words
// are kept but the room is left alone.
test("the repost window splits on two hours", () => {
  assert.equal(recoveryKind(now - 1_000, now), "repost");
  assert.equal(recoveryKind(now - (REPOST_WINDOW_MS - 60_000), now), "repost");
  assert.equal(recoveryKind(now - REPOST_WINDOW_MS, now), "repost");
  assert.equal(recoveryKind(now - (REPOST_WINDOW_MS + 60_000), now), "file");
});
