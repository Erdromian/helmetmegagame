// The guard on chat's own two marks — quoted speech and ||spoilers|| — and on
// the escape that keeps a {kind:payload} token in one piece.
//
// WHAT A FAILURE HERE MEANS. `remark-parse` builds the whole inline tree before
// any plugin runs, so a paragraph reaches remarkChat already cut into siblings
// wherever a `*star*`, a `` `tick` ``, a `~~tilde~~` or a `[link](…)` sits. For
// a long time every one of these passes used mdast-util-find-and-replace, which
// sees ONE text node at a time, so `he said "*get out*"` was never tinted and
// `||a *hidden* word||` was never hidden. Players write with emphasis
// constantly, so that was most quotes and most spoilers.
//
// The trees below are the shapes remark ACTUALLY produces — they were taken off
// a real `unified().use(remarkParse).use(CHAT_PLUGINS)` run, not invented. That
// is the contract: if remark ever changes what it hands over, these stop
// describing reality and the passes need re-checking against a live parse.
//
// Loaded with `import()` rather than required: these are ESM files in another
// workspace. chatRuns.js and tokenEscape.js import nothing at all, and
// remarkChat.js imports only chatRuns.js, so no bundler and no build step is
// involved — the same trick discordMarkup.test.js uses to read across.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const COMPONENTS = path.join(__dirname, "..", "..", "web", "app", "components");
const load = (file) => import(pathToFileURL(path.join(COMPONENTS, file)).href);

const text = (value) => ({ type: "text", value });
const emphasis = (value) => ({ type: "emphasis", children: [text(value)] });
const paragraph = (...children) => ({ type: "root", children: [{ type: "paragraph", children }] });

// The shape of a transformed tree, as one readable string:
//   he said span.speech["get out"]
function shape(node) {
  if (node.type === "text") return JSON.stringify(node.value);
  if (node.type === "inlineCode") return `code(${JSON.stringify(node.value)})`;
  const name = node.data?.hName ?? node.type;
  const className = node.data?.hProperties?.className;
  const kids = (node.children ?? []).map(shape).join(" ");
  return `${className ? `${name}.${className}` : name}[${kids}]`;
}

async function run(tree) {
  const { default: remarkChat } = await load("remarkChat.js");
  remarkChat()(tree);
  return shape(tree.children[0]);
}

test("a quote keeps the formatting inside it", async () => {
  // `he said "*get out*" and left`
  const tree = paragraph(text('he said "'), emphasis("get out"), text('" and left'));
  assert.equal(
    await run(tree),
    'paragraph["he said " span.speech["\\"" emphasis["get out"] "\\""] " and left"]',
  );
});

test("a spoiler keeps the formatting inside it, and drops its bars", async () => {
  // `||the *password* is rosebud||`
  const tree = paragraph(text("||the "), emphasis("password"), text(" is rosebud||"));
  assert.equal(
    await run(tree),
    'paragraph[chatspoiler.chat-spoiler["the " emphasis["password"] " is rosebud"]]',
  );
});

test("plain text still matches, and a curly pair counts", async () => {
  assert.equal(
    await run(paragraph(text('he said "get out" and left'))),
    'paragraph["he said " span.speech["\\"get out\\""] " and left"]',
  );
  assert.equal(await run(paragraph(text("“hush”"))), 'paragraph[span.speech["“hush”"]]');
  assert.equal(await run(paragraph(text("||secret||"))), 'paragraph[chatspoiler.chat-spoiler["secret"]]');
});

test("a run that should not match, does not", async () => {
  // An opening mark followed by a space is punctuation, not speech, and a
  // closing mark that never comes must not swallow the rest of the line. Both
  // leave the text split around the lone mark, which renders identically.
  assert.equal(
    await run(paragraph(text('he said " nothing here'))),
    'paragraph["he said \\"" " nothing here"]',
  );
  assert.equal(
    await run(paragraph(text('an unclosed " quote'))),
    'paragraph["an unclosed \\"" " quote"]',
  );
  // Nothing between the marks is two marks, not a quote.
  assert.equal(await run(paragraph(text('"" empty'))), 'paragraph["\\"" "\\"" " empty"]');
  // A soft break inside, and a run past the 400-character cap.
  assert.equal(await run(paragraph(text('"two\nlines"'))), 'paragraph["\\"" "two\\nlines\\""]');
  // Past the 400-character cap, a quote gives up rather than reaching further.
  const long = "x".repeat(420);
  assert.equal(
    await run(paragraph(text(`"${long}"`))),
    `paragraph["\\"" ${JSON.stringify(`${long}"`)}]`,
  );
});

test("code is left alone, on both passes", async () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "inlineCode", value: '"not a quote" ||not hidden||' }] }] };
  assert.equal(await run(tree), 'paragraph[code("\\"not a quote\\" ||not hidden||")]');
});

test("a quote wraps a resolved token whole, and nests with a spoiler", async () => {
  // `"a quote with a {char:…} in it"` — the token pass runs FIRST now, so the
  // mention is already a childless node by the time the quote is found. That is
  // the whole reason the order could be flipped (markdownPlugins.js).
  const token = { type: "richToken", data: { hName: "richtoken", hProperties: { kind: "char", payload: "cmtt1|Ada" } }, children: [] };
  assert.equal(
    await run(paragraph(text('"a quote with a '), token, text(' in it"'))),
    'paragraph[span.speech["\\"a quote with a " richtoken[] " in it\\""]]',
  );

  assert.equal(
    await run(paragraph(text('||a spoiler with a "quote" in it||'))),
    'paragraph[chatspoiler.chat-spoiler["a spoiler with a " span.speech["\\"quote\\""] " in it"]]',
  );
});

test("a quote written inside emphasis is found there", async () => {
  // `*she said "no"*` — the quote lives on the emphasis's own children.
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "emphasis", children: [text('she said "no"')] }] }] };
  assert.equal(await run(tree), 'paragraph[emphasis["she said " span.speech["\\"no\\""]]]');
});

test("a token's payload is escaped, not parsed", async () => {
  const { default: escape } = await load("tokenEscape.js");

  // Every mark a name or a price can carry. Without this the paragraph is cut
  // mid-token and the reader gets a raw `{char:cmtt…` with an italic beside it.
  assert.equal(escape("{char:cmtt1|Bob *the Blade* Marley}"), "{char:cmtt1\\|Bob \\*the Blade\\* Marley}");
  assert.equal(escape("{tag:foo|My _Custom_ Tag}"), "{tag:foo\\|My \\_Custom\\_ Tag}");
  assert.equal(escape("{info:costs `5` gold}"), "{info:costs \\`5\\` gold}");

  // Idempotent — nothing promises this runs exactly once.
  const once = escape("{char:cmtt1|Bob *the Blade* Marley}");
  assert.equal(escape(once), once);

  // Text that is not a token is left exactly as written.
  assert.equal(escape("no tokens *here*"), "no tokens *here*");
  assert.equal(escape("a {not a token} b"), "a {not a token} b");

  // A token shown as syntax, between backticks, keeps its bar bare — a
  // backslash would be visible in the thing somebody is demonstrating.
  assert.equal(escape("`{char:cmtt1|Ada}` shown as syntax"), "`{char:cmtt1|Ada}` shown as syntax");
});
