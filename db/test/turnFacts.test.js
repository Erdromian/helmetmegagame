// The one clock sentence a turn announcement carries (db/turnCalendar.js#turnFacts), and the property that matters most:
// a stopped clock never quotes a time.
//
// The bug this guards: Restart Game used to mint Turn 1 and announce it, so #turns carried "Day 1, Turn 1" with a live
// <t:…:R> countdown for a game nobody had started, in a guild with no characters in it. A turn row always has an `endsAt`,
// so nothing about the row itself can tell you whether that time means anything — only the phase can.

const test = require("node:test");
const assert = require("node:assert/strict");

const { turnFacts } = require("../turnCalendar");

// A 24-hour turn, opened well before its end, so the running case has both a lock and a cutoff to print.
const TURN = {
  number: 1,
  dayNumber: 1,
  startedAt: new Date("2026-09-16T05:00:00Z"),
  endsAt: new Date("2026-09-17T05:00:00Z"),
  turnLengthHours: 24,
};

test("a running clock prints both times", () => {
  const { clock } = turnFacts(TURN, {});
  assert.match(clock, /This turn ends at <t:\d+:t>/);
  assert.match(clock, /Moves must be sent by <t:\d+:t>/);
});

test("a game that has not started says so, and quotes no time at all", () => {
  for (const phase of ["LOBBY", "CLOSED"]) {
    const { clock } = turnFacts(TURN, { clockFrozen: true, frozenReason: "NOT_RUNNING", phase });
    assert.equal(clock, "The game hasn't started yet.");
    assert.ok(!clock.includes("<t:"), `${phase} must not count down to anything`);
  }
});

test("a game that is over is not a game that has not started", () => {
  // End Game reposts the console for the still-open turn (web/app/(app)/gm/dev/gameActions.js#endGame), so both ends of a
  // game arrive here wearing the same NOT_RUNNING. Telling the epilogue it hasn't started would be worse than the
  // countdown this replaced.
  const { clock } = turnFacts(TURN, { clockFrozen: true, frozenReason: "NOT_RUNNING", phase: "ENDED" });
  assert.equal(clock, "The game is over.");
  assert.ok(!clock.includes("<t:"));
});

test("out of session is unchanged, and still outranks the lock", () => {
  const { clock } = turnFacts(TURN, { clockFrozen: true, frozenReason: "NOT_IN_SESSION" });
  assert.equal(clock, "The game isn't in session.");
  assert.ok(!clock.includes("<t:"));
});

test("the day and date are facts about the turn, not about the clock", () => {
  // Day 1 is April 21st, 1098 whatever the game is doing — only the clock sentence changes.
  const running = turnFacts(TURN, {});
  const lobby = turnFacts(TURN, { clockFrozen: true, frozenReason: "NOT_RUNNING", phase: "LOBBY" });
  assert.equal(lobby.day, running.day);
  assert.equal(lobby.date, running.date);
  assert.equal(lobby.date, "April 21st, 1098");
});
