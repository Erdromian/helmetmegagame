// node --test over the between-sessions gate (docs/systemdocs/SESSIONS.md §5).
//
// The policy has exactly two moving parts and they are easy to get backwards: an ACT is shut between sittings no matter
// what, and TALKING is shut only when a GM has turned "Allow roleplaying in between sessions" off. Everything below is
// one of those two sentences.

const test = require("node:test");
const assert = require("node:assert");

const { gateFor } = require("../lib/betweenSessions");
const { GATE_MESSAGES } = require("../lib/turnGate");

const OPEN = { sessionOpenedAt: new Date("2026-09-16T20:00:00Z") };
const SHUT = { sessionOpenedAt: null };
const SESSIONS = { gameMode: "SESSIONS", roleplayBetweenSessions: true };
const SESSIONS_SILENT = { gameMode: "SESSIONS", roleplayBetweenSessions: false };

test("a Persistent game is never gated, whichever way the knob is set", () => {
  for (const config of [{ gameMode: "PERSISTENT" }, { gameMode: "PERSISTENT", roleplayBetweenSessions: false }]) {
    assert.equal(gateFor(config, SHUT).ok, true);
    assert.equal(gateFor(config, SHUT, { acting: false }).ok, true);
  }
  // A config that never got the column reads as Persistent, and fails OPEN — a half-configured game locks nobody out.
  assert.equal(gateFor({}, {}).ok, true);
  assert.equal(gateFor(null, null).ok, true);
});

test("inside a session nothing is gated", () => {
  assert.equal(gateFor(SESSIONS, OPEN).ok, true);
  assert.equal(gateFor(SESSIONS_SILENT, OPEN).ok, true);
  assert.equal(gateFor(SESSIONS_SILENT, OPEN, { acting: false }).ok, true);
});

test("between sittings an act is refused and talking is not", () => {
  const act = gateFor(SESSIONS, SHUT);
  assert.equal(act.ok, false);
  assert.equal(act.reason, "NOT_IN_SESSION");
  assert.equal(act.message, GATE_MESSAGES.NOT_IN_SESSION);

  assert.equal(gateFor(SESSIONS, SHUT, { acting: false }).ok, true);
});

test("with roleplay off the freeze is total", () => {
  assert.equal(gateFor(SESSIONS_SILENT, SHUT).ok, false);
  const talk = gateFor(SESSIONS_SILENT, SHUT, { acting: false });
  assert.equal(talk.ok, false);
  assert.equal(talk.message, GATE_MESSAGES.NOT_IN_SESSION);
});

test("acting is the default, so a caller that forgets the option gets the strict answer", () => {
  assert.equal(gateFor(SESSIONS, SHUT, {}).ok, false);
  assert.equal(gateFor(SESSIONS, SHUT).ok, false);
});

test("a missing roleplay column reads as ON, matching the schema default", () => {
  assert.equal(gateFor({ gameMode: "SESSIONS" }, SHUT, { acting: false }).ok, true);
  assert.equal(gateFor({ gameMode: "SESSIONS" }, SHUT).ok, false);
});
