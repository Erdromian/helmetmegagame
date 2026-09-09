// node --test over the Discord chunker. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkMessage, DISCORD_MESSAGE_LIMIT } = require("../lib/chunkText");

test("short text is one chunk, untouched", () => {
  assert.deepEqual(chunkMessage("hello\n\nworld"), ["hello\n\nworld"]);
});

test("paragraphs pack together and split on blank lines", () => {
  const a = "a".repeat(1200);
  const b = "b".repeat(1200);
  const c = "c".repeat(300);
  assert.deepEqual(chunkMessage(`${a}\n\n${b}\n\n${c}`), [a, `${b}\n\n${c}`]);
});

test("a long single-newline roster never cuts inside a line", () => {
  const lines = [];
  for (let i = 0; i < 120; i += 1) lines.push(`Player${i} as Character ${i}, Some Role ✝ turn ${i}`);
  const text = `**Game Ended**\n\n**Who was who**\n${lines.join("\n")}`;
  const chunks = chunkMessage(text);
  assert.ok(chunks.length > 1);
  const seen = [];
  for (const chunk of chunks) {
    assert.ok(chunk.length <= DISCORD_MESSAGE_LIMIT);
    for (const line of chunk.split("\n")) if (line) seen.push(line);
  }
  // Every original line survives whole, in order, with nothing invented.
  const original = text.split("\n").filter(Boolean);
  assert.deepEqual(seen, original);
});

test("a single line over the cap is still hard-split", () => {
  const long = "x".repeat(3000);
  const chunks = chunkMessage(`intro\n${long}`);
  assert.deepEqual(chunks, ["intro", "x".repeat(2000), "x".repeat(1000)]);
});
