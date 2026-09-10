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
const { windowBetween, linkCharacterTokens } = require("../lib/oracleInput");
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

// Names are resolved before they are stored (ORACLE.md §5), and a name that
// resolves to nobody must lose its braces rather than become a live link to the
// wrong person.

const ROSTER = [
  { id: "cmt00000000000000000000a", name: "Bram Holt" },
  { id: "cmt00000000000000000000b", name: "Adeliz" },
];

test("a full name becomes a canonical mention", () => {
  assert.strictEqual(
    linkCharacterTokens("{char:Bram Holt} went north.", ROSTER),
    "{char:cmt00000000000000000000a|Bram Holt} went north.",
  );
});

test("a mononym is a name, not an id", () => {
  // Adeliz is letters with no spaces, which is also exactly what a cuid looks
  // like to a shape test. Checked in the wrong order, a one-word character name
  // is mistaken for an id that is already resolved and handed back pointing at
  // nobody — so the one name a GM most wants to click never links.
  assert.strictEqual(
    linkCharacterTokens("{char:Adeliz} arrived.", ROSTER),
    "{char:cmt00000000000000000000b|Adeliz} arrived.",
  );
});

test("an id the model echoed back is left alone", () => {
  const already = "{char:cmt00000000000000000000a} went north.";
  assert.strictEqual(linkCharacterTokens(already, ROSTER), already);
});

test("an invented person loses the braces", () => {
  assert.strictEqual(linkCharacterTokens("{char:Nobody At All} waited.", ROSTER), "Nobody At All waited.");
});

// Three actions the Oracle used to be blind to, and the two renderer rules
// they needed.

const AUDIT_NAMES = {
  byDiscordUserId: new Map([["u1", "Ada Vance"]]),
  byCharacterId: new Map([["c1", "Ada Vance"], ["c2", "Bram Holt"]]),
};

test("a hood coming OFF is reported, not swallowed", () => {
  // `concealed: false` is the event, not an absent flag. Every other false
  // detail is skipped as noise, so without an exception the line read
  // "conceal_toggled | Ada Vance" whichever way the hood went.
  const off = auditLinesFor(
    [{ actionType: "character_conceal_toggled", actorDiscordUserId: "u1", targetCharacterId: "c1", details: { concealed: false } }],
    AUDIT_NAMES,
    new Set(),
  );
  assert.match(off.join("\n"), /concealed: false/);
});

test("a flag that merely failed to apply is still noise", () => {
  const line = auditLinesFor(
    [{ actionType: "request_heal_character", actorDiscordUserId: "u1", targetCharacterId: "c2", details: { tagName: "Splint", moodApplied: false } }],
    AUDIT_NAMES,
    new Set(),
  );
  assert.doesNotMatch(line.join("\n"), /moodApplied/);
});

test("acting on yourself is written once, not twice", () => {
  const line = auditLinesFor(
    [{ actionType: "request_disguise_self", actorDiscordUserId: "u1", targetCharacterId: "c1", details: { tagName: "Disguised (Terra Pointaseau)" } }],
    AUDIT_NAMES,
    new Set(),
  );
  assert.doesNotMatch(line.join("\n"), /Ada Vance -> Ada Vance/);
  assert.match(line.join("\n"), /Disguised \(Terra Pointaseau\)/);
});

test("the intercom carries what it said", () => {
  const line = auditLinesFor(
    [{ actionType: "intercom_broadcast", actorDiscordUserId: "u1", targetCharacterId: "c1", details: { body: "Send me a letter by bird.", zonesReached: 4 } }],
    AUDIT_NAMES,
    new Set(),
  );
  assert.match(line.join("\n"), /Send me a letter by bird\./);
});

// The token cap, and the one failure that arrives looking like a success. A
// model that runs into max_tokens returns a 200 carrying a well-formed string
// of exactly the right shape — so nothing downstream can tell a page that was
// cut off mid-sentence from one that finished, and it gets stored, read as the
// account of the turn, and fed to the next three turns' writers as fact.

const { complete, OracleError } = require("../lib/oracleClient");

const PROVIDER_CONFIG = {
  oracleApiKey: "k",
  oracleModel: "m",
  oracleBaseUrl: "https://example.invalid/v1",
};

// One canned chat-completion, and a count of how many times it was asked for —
// the count is half the point, since a truncation must not be retried.
function stubProvider(finishReason) {
  const calls = { n: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.n += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: finishReason, message: { content: "A page." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("a page cut off at the cap is an error, not a page", async () => {
  const stub = stubProvider("length");
  try {
    await assert.rejects(
      () => complete(PROVIDER_CONFIG, { system: "s", user: "u", maxTokens: 40 }),
      (err) => err instanceof OracleError && /40-token cap/.test(err.message),
    );
    // And asked for exactly once: the same request truncates the same way, so a
    // retry only spends the money twice.
    assert.equal(stub.calls.n, 1);
  } finally {
    stub.restore();
  }
});

test("a page that finished is returned untouched", async () => {
  const stub = stubProvider("stop");
  try {
    const result = await complete(PROVIDER_CONFIG, { system: "s", user: "u", maxTokens: 40 });
    assert.equal(result.text, "A page.");
    assert.equal(result.truncated, false);
  } finally {
    stub.restore();
  }
});

// Test connection budgets sixteen tokens for one word, so a chatty model runs
// past it every time. That must not read as a broken key.
test("the connection test tolerates its own tiny budget", async () => {
  const stub = stubProvider("length");
  try {
    const result = await complete(PROVIDER_CONFIG, { system: "s", user: "u", maxTokens: 16, allowTruncated: true });
    assert.equal(result.text, "A page.");
    assert.equal(result.truncated, true);
  } finally {
    stub.restore();
  }
});

// The threads separator, now that the prompts ask for headings above it. A page
// laid out with ### sections is the new normal shape, and the parser has to find
// the block underneath one — while a THREADS line that the model decorated as a
// heading must NOT match, which is why the editor prompt spells out that the
// line carries the bare word and nothing else.

test("the threads block survives a page written with headings", () => {
  const reply = [
    "Three zones moved on the same thing.",
    "",
    "### Across the zones",
    "",
    "The **garrison hand-out** put arms in eleven hands.",
    "",
    "THREADS",
    "Garrison hand-out | Eleven Cerberi are newly armed.",
    "Godflesh | Still moving south.",
  ].join("\n");

  const { body, threads } = splitEditorReply(reply);
  assert.match(body, /### Across the zones/);
  assert.doesNotMatch(body, /THREADS/);
  assert.equal(threads.length, 2);
  assert.equal(threads[0].name, "Garrison hand-out");
});

test("a THREADS line dressed as a heading is not the separator", () => {
  const { body, threads } = splitEditorReply("The turn.\n\n### THREADS\nA | B");
  assert.equal(threads.length, 0);
  assert.match(body, /### THREADS/);
});
