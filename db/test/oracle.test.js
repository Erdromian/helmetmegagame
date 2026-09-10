// The Oracle's pure halves. See docs/systemdocs/ORACLE.md.
//
// Only the parts that need no database and no provider: the audit filter, which
// decides what a model is allowed to see, and the editor reply parser, which has
// to survive whatever a small model actually returns. Those are the two places
// a quiet mistake would be expensive — a filter that lets the machine band
// through costs money on every turn, and a parser that throws costs the front
// page.

const test = require("node:test");
const assert = require("node:assert");

const { auditLinesFor, INCLUDED } = require("../lib/oracleAudit");
const { windowBetween } = require("../lib/oracleInput");
const { moveCutoffAt } = require("../lib/turnClock");
const { cutoffDecision } = require("../lib/oracleCutoff");
const { splitEditorReply, correspondentPrompt, editorPrompt } = require("../lib/oraclePrompts");

function namesFixture() {
  return {
    byCharacterId: new Map([["c2", "Bram Holt"]]),
    byDiscordUserId: new Map([["u1", "Ada Vance"]]),
  };
}

test("an included row renders with both sides and its details", () => {
  const lines = auditLinesFor(
    [{ actionType: "request_heal_character", actorDiscordUserId: "u1", targetCharacterId: "c2", details: { tagName: "Splint" } }],
    namesFixture(),
  );
  assert.deepStrictEqual(lines, ["heal_character | Ada Vance -> Bram Holt | tagName: Splint"]);
});

test("the machine band never reaches the model", () => {
  // The turn engine writes a row per character per pass. If these got through,
  // they would outnumber the moves by an order of magnitude and be paid for on
  // every turn.
  const machine = [
    "staged_message_created",
    "staged_push_resolved",
    "gm_dm_sent",
    "superadmin_turn_forced",
    "move_solve",
    "turn_advanced",
    "ooc_report_opened",
  ];
  const lines = auditLinesFor(
    machine.map((actionType) => ({ actionType, actorDiscordUserId: "u1", details: {} })),
    namesFixture(),
  );
  assert.deepStrictEqual(lines, []);
});

test("an unknown actionType is dropped rather than guessed at", () => {
  // INCLUDED is an allowlist on purpose: a new action is invisible until
  // somebody decides it is a story fact. A missing line reads as a quiet turn;
  // an unexpected one reads as a hallucination.
  const lines = auditLinesFor(
    [{ actionType: "request_invented_tomorrow", actorDiscordUserId: "u1", details: {} }],
    namesFixture(),
  );
  assert.deepStrictEqual(lines, []);
  assert.ok(!INCLUDED.has("request_invented_tomorrow"));
});

test("a once-per-turn row appears once across every zone", () => {
  const seen = new Set();
  const names = namesFixture();
  const row = { actionType: "hunger_resolved", actorDiscordUserId: "system", details: {} };

  const townLines = auditLinesFor([row], names, seen);
  const fortressLines = auditLinesFor([row], names, seen);

  assert.deepStrictEqual(townLines, ["turn | hunger_resolved"]);
  assert.deepStrictEqual(fortressLines, [], "the second zone must not repeat it");
});

test("shopping collapses to one line per character", () => {
  const lines = auditLinesFor(
    [
      { actionType: "request_add_tag", actorDiscordUserId: "u1", details: { tagName: "Rope" } },
      { actionType: "request_add_tag", actorDiscordUserId: "u1", details: { tagName: "Bread" } },
      { actionType: "request_remove_tag", actorDiscordUserId: "u1", details: { tagName: "Splint" } },
    ],
    namesFixture(),
  );
  assert.deepStrictEqual(lines, ["tags | Ada Vance | +Rope, +Bread, −Splint"]);
});

test("a quantity of one is not written", () => {
  const [line] = auditLinesFor(
    [{ actionType: "request_craft_tag", actorDiscordUserId: "u1", details: { tagName: "Bread", quantity: 1 } }],
    namesFixture(),
  );
  assert.ok(!line.includes("quantity"), line);

  const [many] = auditLinesFor(
    [{ actionType: "request_craft_tag", actorDiscordUserId: "u1", details: { tagName: "Bread", quantity: 3 } }],
    namesFixture(),
  );
  assert.ok(many.includes("quantity: 3"), many);
});

test("the editor's threads are split off the front page", () => {
  const { body, threads } = splitEditorReply(
    ["Front page.", "", "THREADS", "Gatehouse standoff | Ada holds the winch.", "- Marsh fever | Two dead."].join("\n"),
  );
  assert.strictEqual(body, "Front page.");
  assert.deepStrictEqual(threads, [
    { name: "Gatehouse standoff", state: "Ada holds the winch." },
    { name: "Marsh fever", state: "Two dead." },
  ]);
});

test("a reply with no THREADS block is all front page", () => {
  // The cost of a model ignoring the tail must be the threads rail, never the
  // front page.
  const { body, threads } = splitEditorReply("Just the front page, nothing else.");
  assert.strictEqual(body, "Just the front page, nothing else.");
  assert.deepStrictEqual(threads, []);
});

test("malformed thread lines are skipped, not thrown on", () => {
  const { threads } = splitEditorReply(["Body.", "THREADS", "no bar here", "Real | It stands."].join("\n"));
  assert.deepStrictEqual(threads, [{ name: "Real", state: "It stands." }]);
});

test("at most five threads are kept", () => {
  const many = ["Body.", "THREADS", ...Array.from({ length: 9 }, (_, i) => `T${i} | state`)].join("\n");
  assert.strictEqual(splitEditorReply(many).threads.length, 5);
});

test("a blank stored prompt falls back to the shipped default", () => {
  // A GM who cleared the textarea meant to reset it, not to ship a model no
  // instructions at all.
  assert.strictEqual(correspondentPrompt({ oracleCorrespondentPrompt: "   " }), correspondentPrompt({}));
  assert.strictEqual(editorPrompt({ oracleEditorPrompt: "" }), editorPrompt({}));
  assert.strictEqual(correspondentPrompt({ oracleCorrespondentPrompt: "Custom." }), "Custom.");
});

// The window, lock to lock. The Oracle runs at the Move cutoff, so a page can
// only see as far as its own cutoff, and the floor is the last turn that was
// actually WRITTEN rather than simply the last turn. Getting either wrong loses
// a day quietly, which is the expensive kind of wrong for a record.

// 13:00 Chicago on consecutive days: an ordinary turn, ending at the coming
// midnight and cutting off at 21:00.
const turnAt = (iso) => ({ startedAt: new Date(iso) });
const DAY_ONE = turnAt("2026-09-08T18:00:00Z");
const DAY_TWO = turnAt("2026-09-09T18:00:00Z");

test("an ordinary turn runs cutoff to cutoff", () => {
  const { from, to } = windowBetween(DAY_ONE, DAY_TWO);
  assert.strictEqual(to.getTime(), moveCutoffAt(DAY_TWO).getTime());
  assert.strictEqual(from.getTime(), moveCutoffAt(DAY_ONE).getTime());
  // Exactly a day apart, no gap and no overlap.
  assert.strictEqual(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000);
});

test("the first turn of a game is its own floor", () => {
  const { from, to } = windowBetween(null, DAY_ONE);
  assert.strictEqual(from.getTime(), DAY_ONE.startedAt.getTime());
  assert.strictEqual(to.getTime(), moveCutoffAt(DAY_ONE).getTime());
});

test("a short turn cannot pull the floor back before it began", () => {
  // A GM opening a turn at 23:00 gets an endsAt of midnight, so its DERIVED
  // cutoff is 21:00 — two hours before the turn existed. Anchored on that
  // unclamped, two pages would chronicle the same evening twice.
  const short = turnAt("2026-09-09T04:00:00Z"); // 23:00 Chicago on the 8th
  assert.ok(moveCutoffAt(short) < short.startedAt, "the premise: a cutoff before the start");
  const { from } = windowBetween(short, DAY_TWO);
  assert.strictEqual(from.getTime(), short.startedAt.getTime());
});

test("a skipped turn is covered by the next page, not lost", () => {
  // Anchoring on the previous turn would start day three at day two's 21:00 and
  // nobody would ever have written day two. The anchor is the last turn with a
  // page, so its whole day falls inside this window.
  const dayThree = turnAt("2026-09-10T18:00:00Z");
  const { from, to } = windowBetween(DAY_ONE, dayThree);
  assert.strictEqual(from.getTime(), moveCutoffAt(DAY_ONE).getTime());
  assert.strictEqual(to.getTime() - from.getTime(), 2 * 24 * 60 * 60 * 1000);
});

// When the Oracle fires. Every branch but one is a REFUSAL, and a refusal that
// fires by mistake costs a turn its page without saying anything.

test("it drafts once the cutoff has passed and settled", () => {
  const turn = DAY_TWO;
  const now = new Date(moveCutoffAt(turn).getTime() + 3 * 60 * 1000);
  assert.strictEqual(cutoffDecision(turn, { now }).draft, true);
});

test("it does not draft before the cutoff", () => {
  const turn = DAY_TWO;
  const now = new Date(moveCutoffAt(turn).getTime() - 60 * 1000);
  const { draft, reason } = cutoffDecision(turn, { now });
  assert.strictEqual(draft, false);
  assert.strictEqual(reason, "before the cutoff");
});

test("it keeps out of the minute the stage sweep holds", () => {
  // 21:00 exactly. The Makeshift Stage fires on that same minute, and the
  // Oracle opening seven model calls beside it is the contention the stage
  // sweep's own hours were chosen to avoid.
  const turn = DAY_TWO;
  const { draft, reason } = cutoffDecision(turn, { now: moveCutoffAt(turn) });
  assert.strictEqual(draft, false);
  assert.strictEqual(reason, "settling");
});

test("a frozen clock never reaches a cutoff", () => {
  const turn = DAY_TWO;
  const now = new Date(moveCutoffAt(turn).getTime() + 60 * 60 * 1000);
  assert.strictEqual(cutoffDecision(turn, { now, clockFrozen: true }).draft, false);
});

test("a turn that outlived its end is left to Run now", () => {
  // A missed advance cron. moveWindow reopens the window rather than leaving it
  // shut forever, so `locked` reads false again — which must not be mistaken
  // for "not yet".
  const turn = DAY_TWO;
  const now = new Date(moveCutoffAt(turn).getTime() + 5 * 60 * 60 * 1000);
  const { draft, reason } = cutoffDecision(turn, { now });
  assert.strictEqual(draft, false);
  assert.strictEqual(reason, "past the turn's end");
});

test("no open turn is an ordinary answer, not a fault", () => {
  assert.strictEqual(cutoffDecision(null, {}).draft, false);
});
