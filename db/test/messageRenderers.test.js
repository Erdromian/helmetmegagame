// The guard that keeps the message renderers agreeing about SYNTAX.
//
// WHAT A FAILURE HERE MEANS. The same words are read on several surfaces — a
// line in /chat, the copy of it a ⭐ files under /notes, the transcript, a DM
// quoting it, the GM's audit peek. They are stored ONCE, in one spelling: a
// mention is `{char:<id>}` on both faces (db/lib/characterMentions.js), a
// Discord timestamp is `<t:…>`, a subtext line is `-#`. A surface that has not
// been taught one of those passes does not degrade gracefully — it prints the
// plumbing at the reader. `{char:cmtt1148600jgql0pyydw04pn}` is what a starred
// line looked like for as long as StarredList.js rendered a bare string, and a
// DM printed the same, because BASE_PLUGINS shipped without remarkTokens and
// nothing said it had to.
//
// db/test/discordMarkup.test.js is the same guard for Discord's angle-bracket
// vocabulary and it already asserted the plugin lists carry remarkDiscord and
// remarkSubtext. It never asserted remarkTokens, which is the hole this closes.
//
// The rule these tests encode:
//
//   A surface does not get to know a different SYNTAX from its neighbours.
//   What it gets to decide is which tokens it RESOLVES, and that is the
//   `components` map, not the plugin list.
//
// Read as text rather than imported: these are ESM files in another workspace,
// and readFileSync needs no build step and drags nothing in — the same trick
// discordMarkup.test.js uses.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..");
const COMPONENTS = path.join(REPO, "web/app/components");

const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");

// Every `export const X_PLUGINS = [...]` in markdownPlugins.js, as { name, line }.
// Discovered rather than hardcoded, so a list added later is covered the moment
// it exists — a hardcoded trio is how the third one drifted.
function pluginLists() {
  const source = read("web/app/components/markdownPlugins.js");
  return source
    .split("\n")
    .filter((line) => /export const \w+_PLUGINS\s*=/.test(line))
    .map((line) => ({ name: line.match(/export const (\w+_PLUGINS)/)[1], line }));
}

test("every plugin list runs every syntax pass", () => {
  const lists = pluginLists();
  assert.ok(lists.length >= 2, "markdownPlugins.js exports no plugin lists — has the file moved?");

  for (const { name, line } of lists) {
    // The {kind:payload} tokens. Missing here means a mention prints as a cuid
    // in braces, which is a line that looks broken rather than a visibly
    // unresolved reference.
    assert.ok(line.includes("remarkTokens"), `${name} dropped remarkTokens — a {char:…} will print as raw braces`);
    // Discord's two, the pair discordMarkup.test.js has always guarded.
    assert.ok(line.includes("remarkDiscord"), `${name} dropped remarkDiscord`);
    assert.ok(line.includes("remarkSubtext"), `${name} dropped remarkSubtext`);
    // Order is load-bearing (markdownPlugins.js says why): the block-level
    // pass must run on raw text, before any inline pass has cut the paragraph
    // into children.
    assert.ok(line.indexOf("remarkSubtext") < line.indexOf("remarkDiscord"), `${name} runs remarkSubtext too late`);
    // And chat's own marks go LAST, after the token and Discord passes. That
    // is the reverse of the old rule, and the reason is chatRuns.js: remarkChat
    // scans siblings now, so a resolved mention inside a quote is one more
    // thing the quote wraps rather than the thing that broke it. Going last is
    // what keeps a token's payload — a name like `Bob "Ace" Smith` — from
    // having its own speech tinted mid-mention.
    if (line.includes("remarkChat")) {
      assert.ok(line.indexOf("remarkTokens") < line.indexOf("remarkChat"), `${name} runs remarkChat too early`);
      assert.ok(line.indexOf("remarkDiscord") < line.indexOf("remarkChat"), `${name} runs remarkChat too early`);
    }
  }
});

test("a renderer that runs remarkTokens also draws them", () => {
  // remarkTokens emits a <richtoken> node. A renderer that omits the component
  // renders it as NOTHING AT ALL, which is worse than the raw text was.
  for (const file of fs.readdirSync(COMPONENTS)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(COMPONENTS, file), "utf8");
    // A RENDERER — one that imports the lists. Matched on the import rather
    // than on the word, so a plugin merely naming the file in a comment is not
    // asked to carry a components map it has no use for.
    if (!/from "\.\/markdownPlugins"/.test(source)) continue;
    assert.ok(source.includes("richtoken"), `${file} runs the token pass but renders no richtoken component`);
    assert.ok(source.includes("DISCORD_COMPONENTS"), `${file} renders no Discord nodes`);
  }
});

// Every surface that draws a body somebody WROTE — a scene line, the copy of
// one, a DM, a journal entry. The two allowed renderers are ChatMarkdown (a
// scene: the speech tint and ||spoilers|| on top) and MarkdownContent (prose).
//
// RichText is named as forbidden here on purpose. It is the FULL catalog
// resolver — a {tag:…} becomes a live hoverable chip — which is right for
// authored prose (a tag description, a Desire) and wrong for anything a player
// typed, since it lets them mint one mid-scene. It rendered the transcript and
// the Journal until this list existed.
const BODY_RENDERERS = [
  "web/app/(app)/chat/Feed.js",
  "web/app/(app)/notes/StarredList.js",
  "web/app/(app)/notes/JournalList.js",
  "web/app/(app)/notes/JournalComposer.js",
  "web/app/(app)/archive/ArchiveTranscript.js",
  "web/app/components/DmThread.js",
  "web/app/components/InspectorColumn.js",
  "web/app/components/ArchiveContextModal.js",
];

test("no message body is drawn raw, or by the full catalog resolver", () => {
  for (const file of BODY_RENDERERS) {
    const source = read(file);
    assert.ok(
      source.includes("ChatMarkdown") || source.includes("MarkdownContent"),
      `${file} draws a message body without a renderer — a raw string prints the tokens at the reader`,
    );
    assert.ok(
      !/^import RichText from/m.test(source),
      `${file} renders a player-written body through RichText, which resolves the whole catalog`,
    );
  }
});
