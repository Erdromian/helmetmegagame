const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatTurnPost,
  splitTurnPost,
  formatSessionPost,
  formatEndPost,
  splitEndPost,
} = require("../lib/turnPostText");

// The round trip is the whole contract: what db/lib/gameChannel.js writes into
// ArchiveEntry.content is what the feed's block renderer reads back out of it.
test("a turn post round-trips its stamp and its note", () => {
  const content = formatTurnPost({
    number: 14,
    day: 7,
    date: "September 27th, 2026",
    clock: "This turn ends at <t:1758999600:t>.",
    note: "Snow on the road.\n\nAnd more of it coming.",
  });
  assert.deepEqual(splitTurnPost(content), {
    number: "14",
    day: "7",
    date: "September 27th, 2026",
    // The Discord timestamp tag survives: it is what makes a stored clock read
    // in the reader's own timezone (web/app/components/remarkDiscord.js).
    clock: "This turn ends at <t:1758999600:t>.",
    plate: "",
    note: "Snow on the road.\n\nAnd more of it coming.",
  });
});

test("a turn with no note is header only, and still parses", () => {
  const content = formatTurnPost({ number: 1, day: 1, date: "April 21st, 1098", clock: "Ends soon." });
  assert.equal(content.includes("\n\n"), false);
  assert.equal(splitTurnPost(content).note, "");
});

// The fallback that matters: a row this module never wrote must still render as
// something a person can read, rather than as an empty block.
test("plain prose comes back as a body with no fields", () => {
  assert.deepEqual(splitTurnPost("just some words"), {
    number: "",
    day: "",
    date: "",
    clock: "",
    plate: "",
    note: "just some words",
  });
});

test("an empty or absent row parses instead of throwing", () => {
  assert.equal(splitTurnPost("").note, "");
  assert.equal(splitTurnPost(null).note, "");
  assert.equal(splitEndPost(undefined).facts, "");
});

// A session line is the sentence alone: it draws as a plain subtext row, so
// anything else stored beside it would be printed at the reader.
test("a session post is the sentence and nothing else", () => {
  assert.equal(formatSessionPost({ open: true }), "The game is in session.");
  assert.equal(formatSessionPost({ open: false }), "The game is no longer in session.");
});

test("the epilogue splits its facts, its closing note and its roster", () => {
  const content = formatEndPost({
    facts: "It lasted 9 days, 18 turns.",
    note: "Well played, all of you.",
    sections: [{ title: "Who was who", lines: ["pubfries as Solomon Baker, Smith"] }],
  });
  const parts = splitEndPost(content);
  assert.equal(parts.facts, "It lasted 9 days, 18 turns.");
  assert.equal(parts.note, "Well played, all of you.");
  assert.equal(parts.body, "**Who was who**\n\n- pubfries as Solomon Baker, Smith");
});

test("an epilogue with no closing note keeps its roster whole", () => {
  const parts = splitEndPost(
    formatEndPost({ facts: "It lasted a day.", sections: [{ title: "Who was who", lines: ["Nobody."] }] }),
  );
  assert.equal(parts.note, "");
  assert.equal(parts.body.startsWith("**Who was who**"), true);
});
