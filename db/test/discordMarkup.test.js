// The guard that keeps Discord's syntax readable on the web.
//
// WHAT A FAILURE HERE MEANS. Text that reaches DirectMessage.content is read
// on two faces. Discord renders `<t:1757700120:F>` as a time, `<@123…>` as a
// name; the web renders whatever web/app/components/remarkDiscord.js has been
// taught. When those two disagree a player opens their thread and reads the
// literal tag — which is exactly what happened with the lobby seat DMs, and is
// why this file exists.
//
// There is no allowlist. Every source file under db/lib, bot/src, web/lib and
// web/app is scanned, and what fails is not "markup" but markup NOBODY HAS
// TAUGHT THE RENDERER — so the check needs no opinion about which strings get
// stored, and cannot rot as the code moves.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DISCORD_MARKUP,
  DISCORD_MARKUP_KINDS,
  TIMESTAMP_STYLES,
  DEFAULT_TIMESTAMP_STYLE,
  findDiscordMarkup,
  findUnknownMarkup,
} = require("../lib/discordMarkup");

const REPO = path.join(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "generated", "migrations"]);

function jsFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}


// Source is not the string a player reads, so two things have to go before it
// can be judged. Comments discuss this syntax constantly — feedOutbox.js says
// "Discord reads `<@&roleId>`", which is documentation, not a leak. And a
// producer writes `<#${thread.id}>`, where the id is an interpolation; every
// such hole becomes a stand-in snowflake so the token is read as the token it
// will actually be. Innermost-first, repeatedly, because these nest.
function readable(source) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (let pass = 0; pass < 10; pass += 1) {
    const next = out.replace(/\$\{[^{}]*\}/g, "1000000000");
    if (next === out) break;
    out = next;
  }
  return out;
}

// Every source file, not just the ones that call a sendDm. The narrower scope
// was tried first and it missed the actual bug: lobby.js BUILDS the seat DM
// and lobbySweep.js sends it, so "calls sendDm" never looked at the file that
// wrote the tag. Chasing the call graph is not worth it, and it does not need
// chasing — the renderer handles the whole known vocabulary now, so a known
// token is fine wherever it appears and an unknown one is worth knowing about
// wherever it appears.
function scannedSources() {
  const roots = ["db/lib", "bot/src", "web/lib", "web/app"].map((r) => path.join(REPO, r));
  return roots
    .flatMap(jsFilesUnder)
    .map((file) => ({ file, source: readable(fs.readFileSync(file, "utf8")) }));
}

test("the grammar knows all seven timestamp styles, and a bare tag defaults", () => {
  for (const style of TIMESTAMP_STYLES) {
    const [hit] = findDiscordMarkup(`at <t:1757700120:${style}>`);
    assert.equal(hit.kind, "timestamp");
    assert.deepEqual(hit.groups, ["1757700120", style]);
  }
  const [bare] = findDiscordMarkup("at <t:1757700120>");
  assert.deepEqual(bare.groups, ["1757700120", undefined]);
  assert.equal(DEFAULT_TIMESTAMP_STYLE, "f");
  // Pre-1970 is a legal Discord timestamp and must not be mistaken for prose.
  assert.equal(findDiscordMarkup("<t:-86400:R>").length, 1);
});

test("every mention spelling is classified, and none of them is prose", () => {
  const kinds = (s) => findDiscordMarkup(s).map((t) => t.kind);
  assert.deepEqual(kinds("<@123456789012345678>"), ["user"]);
  assert.deepEqual(kinds("<@!123456789012345678>"), ["user"]);
  assert.deepEqual(kinds("<@&123456789012345678>"), ["role"]);
  assert.deepEqual(kinds("<#123456789012345678>"), ["channel"]);
  assert.deepEqual(kinds("<:skull:123456789012345678>"), ["emoji"]);
  assert.deepEqual(kinds("<a:wave:123456789012345678>"), ["emoji"]);
  assert.deepEqual(kinds("@here and @everyone"), ["ping", "ping"]);
  // Ordinary writing, markup and autolinks stay ordinary writing.
  for (const quiet of ["if a < b > c", "<3", "<html>", "</p>", "<https://x.test/a>", "an email <mailto:a@b.co>"]) {
    assert.deepEqual(findDiscordMarkup(quiet), [], quiet);
    assert.deepEqual(findUnknownMarkup(quiet), [], quiet);
  }
});

test("a syntax nobody has taught the renderer is caught, not ignored", () => {
  // The whole point of findUnknownMarkup: it must flag a shape the grammar
  // above does NOT describe, or it could never warn about a Discord change.
  assert.deepEqual(findUnknownMarkup("<t:1757700120:F> <@123456789012345678>"), []);
  assert.deepEqual(
    findUnknownMarkup("a <sound:123456789012345678> here").map((u) => u.raw),
    ["<sound:123456789012345678>"],
  );
});

test("every Discord token in the source is one the renderer knows", () => {
  const sources = scannedSources();
  // If this ever hits zero the scan has silently stopped protecting anything.
  assert.ok(sources.length > 100, `only scanned ${sources.length} files — has the layout moved?`);

  const offences = [];
  for (const { file, source } of sources) {
    for (const bad of findUnknownMarkup(source)) {
      const line = source.slice(0, bad.index).split("\n").length;
      offences.push(`${path.relative(REPO, file)}:${line} — ${bad.raw}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    `Discord markup the web cannot render — and this text may well be stored and read on both faces:\n${offences.join("\n")}\n` +
      "Either teach db/lib/discordMarkup.js + remarkDiscord.js the token, or don't write it.",
  );
});

test("the renderer handles every kind the grammar defines", () => {
  // Read as text rather than imported: it is an ESM file in another workspace,
  // and a plain readFileSync needs no build step and drags nothing in.
  const renderer = fs.readFileSync(path.join(REPO, "web/app/components/remarkDiscord.js"), "utf8");
  for (const kind of DISCORD_MARKUP_KINDS) {
    assert.ok(renderer.includes(`"${kind}"`), `remarkDiscord.js never mentions the ${kind} token (${DISCORD_MARKUP[kind].label})`);
  }
});

test("all three markdown renderers still run both Discord passes", () => {
  // The drift this whole change exists to stop: ChatMarkdown knew Discord's
  // chat syntax, MarkdownContent did not, and nothing made them agree.
  const plugins = fs.readFileSync(path.join(REPO, "web/app/components/markdownPlugins.js"), "utf8");
  for (const list of ["BASE_PLUGINS", "CHAT_PLUGINS", "DOC_PLUGINS"]) {
    const line = plugins.split("\n").find((l) => l.includes(`export const ${list}`));
    assert.ok(line, `markdownPlugins.js no longer exports ${list}`);
    // Both Discord-syntax passes, on every surface. remarkSubtext is the `-#`
    // one, and it was missing from DMs for exactly as long as remarkDiscord
    // was — the lobby seat DM shipped a raw `-#` and a raw `<t:…>` in one
    // message.
    assert.ok(line.includes("remarkDiscord"), `${list} dropped remarkDiscord`);
    assert.ok(line.includes("remarkSubtext"), `${list} dropped remarkSubtext`);
    // Order: the block-level pass must precede the inline ones.
    assert.ok(line.indexOf("remarkSubtext") < line.indexOf("remarkDiscord"), `${list} runs remarkSubtext too late`);
  }
  for (const file of ["MarkdownContent.js", "ChatMarkdown.js", "DocumentMarkdown.js"]) {
    const source = fs.readFileSync(path.join(REPO, "web/app/components", file), "utf8");
    assert.ok(source.includes("markdownPlugins"), `${file} builds its own plugin list again`);
    assert.ok(source.includes("DISCORD_COMPONENTS"), `${file} renders no Discord nodes`);
  }
});
