// The chat's edit box draws a line the way the feed does: emotes in italics,
// quoted speech tinted (web/app/components/chatEditRuns.js). These pin that
// it finds the same speech the server counts (db/lib/speech.js) and the same
// emphasis remark renders, and that the runs always add back up to the text —
// the textarea over them holds that text, so a lost character is a caret that
// sits off its letter. Loaded with `import()` since it is an ESM file in
// another workspace.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spokenRanges, spokenSpans } = require("../lib/speech");

const FILE = path.join(__dirname, "..", "..", "web", "app", "components", "chatEditRuns.js");
const load = async () => (await import(pathToFileURL(FILE).href)).default;

// One readable string per run: `/…/` for an emote, `"…"` for speech.
function shape(runs) {
  return runs
    .map((r) => {
      if (r.speech && r.emote) return `/[${r.text}]/`;
      if (r.speech) return `[${r.text}]`;
      if (r.emote) return `/${r.text}/`;
      return r.text;
    })
    .join("|");
}

test("spokenRanges covers each quote with its marks, and spokenSpans still strips them", () => {
  const text = 'He said "get out" and “go” now.';
  assert.deepEqual(spokenRanges(text), [
    { start: 8, end: 17 },
    { start: 22, end: 26 },
  ]);
  assert.deepEqual(spokenSpans(text), ["get out", "go"]);
});

test("spokenRanges keeps the server's rules: no quote opening onto a space, none across a line, none in code", () => {
  assert.deepEqual(spokenRanges('a 6" board " and more'), []);
  assert.deepEqual(spokenRanges('"one\ntwo"'), []);
  assert.deepEqual(spokenRanges('`"not"` but "yes"'), [{ start: 12, end: 17 }]);
});

test("an emote and a quote each get their own look", async () => {
  const editRuns = await load();
  assert.equal(
    shape(editRuns('*nods at the door* "Hello there," she says. *then waits*')),
    '/*nods at the door*/| |["Hello there,"]| she says. |/*then waits*/',
  );
});

test("a quote inside an emote is both", async () => {
  const editRuns = await load();
  assert.equal(shape(editRuns('*mutters "go away" to himself*')), '/*mutters /|/["go away"]/|/ to himself*/');
});

test("underscores emote too, but not inside a bare link", async () => {
  const editRuns = await load();
  assert.equal(shape(editRuns("_sighs_")), "/_sighs_/");
  assert.equal(shape(editRuns("see https://a.example/b_c_d")), "see https://a.example/b_c_d");
});

test("bold and plain text are left as typed", async () => {
  const editRuns = await load();
  assert.equal(shape(editRuns("**Nobody** leaves.")), "**Nobody** leaves.");
});

test("the runs always join back into the text", async () => {
  const editRuns = await load();
  const samples = [
    "",
    "plain",
    '*a* "b" *c "d" e* f',
    '"unclosed *half',
    'line one\n"line two"\n\n*three*\n',
    '> quoted\n- list *item*\n`"code"`',
  ];
  for (const text of samples) {
    assert.equal(
      editRuns(text)
        .map((r) => r.text)
        .join(""),
      text,
    );
  }
});
