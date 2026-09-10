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
