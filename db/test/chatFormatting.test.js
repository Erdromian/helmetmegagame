// The guard on chat's own two marks — quoted speech and ||spoilers|| — and on
// the escape that keeps a {kind:payload} token in one piece. `remark-parse`
// builds the whole inline tree before any plugin runs, cutting a paragraph
// into siblings around any `*star*`/`` `tick` ``/`~~tilde~~`/`[link](…)`; the
// old mdast-util-find-and-replace passes saw one text node at a time, so
// emphasis broke most quotes and spoilers. The trees below are the shapes
// remark ACTUALLY produces off a real run, not invented — if remark changes
// what it hands over, re-check against a live parse. Loaded with `import()`
// since these are ESM files in another workspace.
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

test("any quote mark closes a quote, whichever way it faces", async () => {
  // A phone types an opening “ after a dash, so a cut-off line ends on one.
  assert.equal(await run(paragraph(text("“Wait-“ he said"))), 'paragraph[span.speech["“Wait-“"] " he said"]');
  assert.equal(await run(paragraph(text('"Wait-" he said'))), 'paragraph[span.speech["\\"Wait-\\""] " he said"]');
  assert.equal(await run(paragraph(text("”Backwards”"))), 'paragraph[span.speech["”Backwards”"]]');
  assert.equal(await run(paragraph(text("„Hallo“"))), 'paragraph[span.speech["„Hallo“"]]');
});

test("a quote holding only a token or code is still a quote", async () => {
  const token = { type: "richToken", data: { hName: "richtoken", hProperties: { kind: "char", payload: "cmtt1|Ada" } }, children: [] };
  assert.equal(await run(paragraph(text('"'), token, text('"'))), 'paragraph[span.speech["\\"" richtoken[] "\\""]]');
  assert.equal(
    await run(paragraph(text('"'), { type: "inlineCode", value: "x" }, text('"'))),
    'paragraph[span.speech["\\"" code("x") "\\""]]',
  );
});

test("a run that should not match, does not", async () => {
  assert.equal(await run(paragraph(text('he said " nothing here'))), 'paragraph["he said \\" nothing here"]');
  assert.equal(await run(paragraph(text('an unclosed " quote'))), 'paragraph["an unclosed \\" quote"]');
  assert.equal(await run(paragraph(text('"" empty'))), 'paragraph["\\"\\" empty"]');
});

test("speech has no length cap, but a spoiler still does", async () => {
  const long = "x".repeat(5000);
  assert.equal(
    await run(paragraph(text(`"${long}"`))),
    `paragraph[span.speech[${JSON.stringify(`"${long}"`)}]]`,
  );
  assert.equal(
    await run(paragraph(text(`||${long}||`))),
    `paragraph["||" ${JSON.stringify(`${long}||`)}]`,
  );
});

test("code is left alone, on both passes", async () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "inlineCode", value: '"not a quote" ||not hidden||' }] }] };
  assert.equal(await run(tree), 'paragraph[code("\\"not a quote\\" ||not hidden||")]');
});

test("a quote wraps a resolved token whole, and nests with a spoiler", async () => {
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
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "emphasis", children: [text('she said "no"')] }] }] };
  assert.equal(await run(tree), 'paragraph[emphasis["she said " span.speech["\\"no\\""]]]');
});

test("a token's payload is escaped, not parsed", async () => {
  const { default: escape } = await load("tokenEscape.js");

  assert.equal(escape("{char:cmtt1|Bob *the Blade* Marley}"), "{char:cmtt1\\|Bob \\*the Blade\\* Marley}");
  assert.equal(escape("{tag:foo|My _Custom_ Tag}"), "{tag:foo\\|My \\_Custom\\_ Tag}");
  assert.equal(escape("{info:costs `5` gold}"), "{info:costs \\`5\\` gold}");

  const once = escape("{char:cmtt1|Bob *the Blade* Marley}"); // idempotent
  assert.equal(escape(once), once);

  assert.equal(escape("no tokens *here*"), "no tokens *here*");
  assert.equal(escape("a {not a token} b"), "a {not a token} b");

  assert.equal(escape("`{char:cmtt1|Ada}` shown as syntax"), "`{char:cmtt1|Ada}` shown as syntax"); // bar stays bare
});

test("a newline is a line break, and a quote runs over it", async () => {
  const { default: remarkLineBreaks } = await load("remarkLineBreaks.js");
  const { default: remarkChat } = await load("remarkChat.js");
  const lines = (tree) => {
    remarkLineBreaks()(tree);
    remarkChat()(tree);
    return shape(tree.children[0]);
  };

  // What remark hands over for `*draws her knife*\n"Get out."`: the newline sits in a text node.
  assert.equal(
    lines(paragraph(emphasis("draws her knife"), text('\n"Get out."'))),
    'paragraph[emphasis["draws her knife"] break[] span.speech["\\"Get out.\\""]]',
  );

  // Shift+Enter in the middle of a speech keeps it one speech.
  assert.equal(
    lines(paragraph(text('"Wait.\nCome back." she calls'))),
    'paragraph[span.speech["\\"Wait." break[] "Come back.\\""] " she calls"]',
  );

  // With no mark to close it, an opener is still just a character.
  assert.equal(lines(paragraph(text('she said "wait\nand left'))), 'paragraph["she said \\"wait" break[] "and left"]');

  // Inline code keeps its newline; it is not a text node.
  const code = paragraph({ type: "inlineCode", value: "a\nb" });
  remarkLineBreaks()(code);
  assert.equal(shape(code.children[0]), 'paragraph[code("a\\nb")]');
});

test("a quote runs from one paragraph into the next, one wrapper in each", async () => {
  const { default: remarkChat } = await load("remarkChat.js");
  const block = (...children) => ({ type: "paragraph", children });

  const two = { type: "root", children: [block(text('"First.')), block(text('Second." she says'))] };
  remarkChat()(two);
  assert.equal(shape(two), 'root[paragraph[span.speech["\\"First."]] paragraph[span.speech["Second.\\""] " she says"]]');

  // A paragraph with no mark in it, wholly inside the speech, is tinted all through.
  const three = { type: "root", children: [block(text('"One.')), block(emphasis("Two.")), block(text('Three."'))] };
  remarkChat()(three);
  assert.equal(
    shape(three),
    'root[paragraph[span.speech["\\"One."]] paragraph[span.speech[emphasis["Two."]]] paragraph[span.speech["Three.\\""]]]',
  );

  // A mark at the very end of a paragraph opens onto the blank line, so it is not a quote.
  const end = { type: "root", children: [block(text('he said "')), block(text('Hello"'))] };
  remarkChat()(end);
  assert.equal(shape(end), 'root[paragraph["he said \\""] paragraph["Hello\\""]]');
});

test("a quote may open inside emphasis and close outside it, as the server reads it", async () => {
  const tree = paragraph(emphasis('she says "wait'), text(' for me" and goes'));
  assert.equal(
    await run(tree),
    'paragraph[emphasis["she says " span.speech["\\"wait"]] span.speech[" for me\\""] " and goes"]',
  );
});

test("a real parse tints the same words the server hears", async () => {
  const { unified } = await import("unified");
  const { default: remarkParse } = await import("remark-parse");
  const { default: remarkGfm } = await import("remark-gfm");
  const { default: remarkLineBreaks } = await load("remarkLineBreaks.js");
  const { default: remarkChat } = await load("remarkChat.js");
  const { spokenSpans } = require("../lib/speech");
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkLineBreaks).use(remarkChat);

  // The tinted text, one entry per quote: wrappers that sit back to back across
  // a break or a paragraph belong to one quote, and are joined back up.
  function tinted(line) {
    const tree = processor.runSync(processor.parse(line));
    const out = [];
    let last = null;
    (function walk(node) {
      if (node.data?.hProperties?.className === "speech") {
        const words = [];
        (function collect(n) {
          if (n.type === "text" || n.type === "inlineCode") words.push(n.value);
          else if (n.type === "break") words.push("\n");
          for (const c of n.children ?? []) collect(c);
        })(node);
        const joined = words.join("");
        if (last !== null && !/["“”„‟]$/.test(last)) out[out.length - 1] += `\n${joined}`;
        else out.push(joined);
        last = out[out.length - 1];
        return;
      }
      for (const c of node.children ?? []) walk(c);
    })(tree);
    return out.map((q) => q.slice(1, -1).replace(/\n+/g, "\n"));
  }
  // The server reads the raw line, so its spans still hold the formatting marks.
  const heard = (line) => spokenSpans(line).map((q) => q.replace(/[*`]/g, "").replace(/\n+/g, "\n"));

  const lines = [
    '*draws her knife* "Get out.\nNow." *waits*',
    '"This is the first part.\n\nAnd this is the second." He sits.',
    '"One *two*\n\nthree `four` five" and "six"',
    'Unclosed " here\nand "a real one"',
  ];
  for (const line of lines) assert.deepEqual(tinted(line), heard(line), line);
});
