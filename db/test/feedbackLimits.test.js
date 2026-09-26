// The Feedback composer's rate limit (db/lib/feedbackLimits.js). It replaced a
// flat three-minute cooldown that refused people their second bug report, so
// the first thing these pin down is that a handful of notes in a row go through.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FEEDBACK_BURST,
  FEEDBACK_WINDOW_MS,
  feedbackWaitMs,
  feedbackWaitMessage,
} = require("../lib/feedbackLimits");

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const MIN = 60 * 1000;

// `n` notes, one every `gapMs`, the newest `gapMs` ago.
const notes = (n, gapMs) => Array.from({ length: n }, (_, i) => new Date(NOW - (i + 1) * gapMs));

test("several notes in a row are not refused", () => {
  assert.equal(feedbackWaitMs([], NOW), 0);
  assert.equal(feedbackWaitMs(notes(1, 5 * 1000), NOW), 0);
  assert.equal(feedbackWaitMs(notes(FEEDBACK_BURST - 1, 5 * 1000), NOW), 0);
});

test("a full window waits for its oldest note to age out", () => {
  const times = notes(FEEDBACK_BURST, 30 * 1000); // oldest is BURST * 30s ago
  const oldest = NOW - FEEDBACK_BURST * 30 * 1000;
  assert.equal(feedbackWaitMs(times, NOW), oldest + FEEDBACK_WINDOW_MS - NOW);
  assert.equal(feedbackWaitMs(times, oldest + FEEDBACK_WINDOW_MS), 0);
});

test("notes older than the window do not count", () => {
  const stale = notes(FEEDBACK_BURST, 1000).map((d) => new Date(d.getTime() - FEEDBACK_WINDOW_MS));
  assert.equal(feedbackWaitMs(stale, NOW), 0);
});

test("order and type of the times do not matter", () => {
  const times = notes(FEEDBACK_BURST, 20 * 1000);
  const expected = feedbackWaitMs(times, NOW);
  assert.ok(expected > 0);
  assert.equal(feedbackWaitMs([...times].reverse(), NOW), expected);
  assert.equal(feedbackWaitMs(times.map((d) => d.getTime()), NOW), expected);
});

test("more rows than the cap (a race) still names the right note", () => {
  // Two sends that passed the check together leave BURST + 1 rows; the wait
  // runs until enough have aged out to be back under the cap.
  const times = notes(FEEDBACK_BURST + 1, MIN / 2);
  const sorted = times.map((d) => d.getTime()).sort((a, b) => a - b);
  assert.equal(feedbackWaitMs(times, NOW), sorted[1] + FEEDBACK_WINDOW_MS - NOW);
});

test("the refusal says how long, rounded up, never zero", () => {
  assert.match(feedbackWaitMessage(1), /in 1 minute\.$/);
  assert.match(feedbackWaitMessage(MIN), /in 1 minute\.$/);
  assert.match(feedbackWaitMessage(MIN + 1), /in 2 minutes\.$/);
  assert.match(feedbackWaitMessage(9.5 * MIN), /in 10 minutes\.$/);
});
