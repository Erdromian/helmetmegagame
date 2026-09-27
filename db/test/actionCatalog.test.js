// The Discord bot's list of player verbs (db/lib/actionCatalog.js) against the
// web's (web/app/components/actionRegistry.js). The registry imports icons, so
// it is read as TEXT here: every `mode: "…"` it declares must have a line in the
// catalog, with the same show and gate keys — otherwise a verb added to the web
// quietly stays missing from Discord's Actions menu and commands.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACTIONS,
  SECTIONS,
  actionFor,
  actionForCommand,
  commandGroups,
  actionState,
} = require("../lib/actionCatalog");

const REGISTRY = fs.readFileSync(
  path.join(__dirname, "..", "..", "web", "app", "components", "actionRegistry.js"),
  "utf8",
);

// Each action literal in ACTION_SECTIONS, as { mode, show, gate }. Literals are
// either one line or a multi-line `{ … }` block; both carry `mode: "x"`.
function registryActions() {
  const start = REGISTRY.indexOf("export const ACTION_SECTIONS");
  const end = REGISTRY.indexOf("const BY_MODE");
  const body = REGISTRY.slice(start, end);
  const out = [];
  const re = /\{[^{}]*?mode:\s*"([^"]+)"[^{}]*?\}/gs;
  let m;
  while ((m = re.exec(body))) {
    const block = m[0];
    const show = /show:\s*"([^"]+)"/.exec(block)?.[1] ?? null;
    const gate = /gate:\s*"([^"]+)"/.exec(block)?.[1] ?? null;
    out.push({ mode: m[1], show, gate });
  }
  return out;
}

test("every verb on the web's registry has a catalog line", () => {
  const registry = registryActions();
  assert.ok(registry.length > 50, `read ${registry.length} registry actions — the parser has broken`);
  const missing = registry.filter((r) => !actionFor(r.mode)).map((r) => r.mode);
  assert.deepEqual(missing, [], `add these to db/lib/actionCatalog.js: ${missing.join(", ")}`);
});

test("the catalog hides and greys on the same keys the registry does", () => {
  for (const r of registryActions()) {
    const a = actionFor(r.mode);
    assert.equal(a.show ?? null, r.show, `${r.mode}: show`);
    assert.equal(a.gate ?? null, r.gate, `${r.mode}: gate`);
  }
});

test("modes are unique, sections known, and every verb says how it runs", () => {
  const seen = new Set();
  const sectionKeys = new Set([...SECTIONS.map((s) => s.key), "place"]);
  for (const a of ACTIONS) {
    assert.ok(!seen.has(a.mode), `duplicate mode ${a.mode}`);
    seen.add(a.mode);
    assert.ok(sectionKeys.has(a.section), `${a.mode}: unknown section ${a.section}`);
    assert.ok(a.run === "native" || a.run === "link", `${a.mode}: run`);
    assert.ok(a.label && a.label.length <= 100, `${a.mode}: label`);
  }
});

test("commands fit Discord: names, descriptions, and no command both bare and grouped", () => {
  const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
  for (const { command, actions } of commandGroups()) {
    assert.match(command, NAME, `command ${command}`);
    const bare = actions.filter((a) => a.sub == null);
    if (bare.length > 0) assert.equal(actions.length, 1, `/${command} is both a verb and a group`);
    assert.ok(actions.length <= 25, `/${command} has more than 25 subcommands`);
    const subs = new Set();
    for (const a of actions) {
      assert.ok(a.description.length >= 1 && a.description.length <= 100, `${a.mode}: description length`);
      if (a.sub != null) {
        assert.match(a.sub, NAME, `${a.mode}: sub`);
        assert.ok(!subs.has(a.sub), `/${command} ${a.sub} twice`);
        subs.add(a.sub);
      }
      assert.equal(actionForCommand(command, a.sub), a);
    }
  }
});

test("a web link only names a dialog the web can open", () => {
  // The DIALOGS keys web/app/components/actions/index.js mounts; an INSTANT
  // verb is deliberately not linkable (opening it would run it).
  const index = fs.readFileSync(
    path.join(__dirname, "..", "..", "web", "app", "components", "actions", "index.js"),
    "utf8",
  );
  const dialogs = index.slice(index.indexOf("export const DIALOGS"));
  for (const a of ACTIONS.filter((x) => x.web)) {
    assert.match(dialogs, new RegExp(`\\b${a.mode}\\b`), `${a.mode} is not a web dialog`);
  }
});

test("actionState: hidden beats greyed, and the pools' sentence beats the catalog's", () => {
  const extract = actionFor("extract");
  assert.equal(actionState(extract, {}).state, "hidden");
  assert.deepEqual(actionState(extract, { canSeeExtract: true }), {
    state: "greyed",
    reason: "You have nothing to cut with.",
  });
  assert.equal(actionState(extract, { canSeeExtract: true, canExtract: true }).state, "ready");
  const kiss = actionFor("kiss");
  assert.deepEqual(actionState(kiss, { gateReason: { kiss: "You're Bound." } }), {
    state: "greyed",
    reason: "You're Bound.",
  });
  assert.equal(actionState(actionFor("search"), {}).state, "ready");
});
