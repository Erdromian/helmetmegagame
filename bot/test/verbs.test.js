// Every player verb's typed twin (bot/src/lib/commands.js, built from
// db/lib/actionCatalog.js) and the handlers behind them (bot/src/lib/verbs/).
// Discord refuses a whole registration for one bad command, and a verb with a
// command but no handler answers "That isn't something you can do." — both are
// caught here rather than an hour after a deploy.
const test = require("node:test");
const assert = require("node:assert/strict");
const { commandDefinitions } = require("../src/lib/commands");
const { ACTIONS } = require("@lifeweb/db/lib/actionCatalog");
const { VERBS, VERB_COMMANDS, OPEN_VERB_PREFIXES } = require("../src/lib/verbs");
const { META_COMMANDS } = require("../src/lib/verbs/meta");
const { verbId, modalId, parseVerbId, parseModalId } = require("../src/lib/verbs/context");

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;

test("the command list fits Discord: unique names, a hundred at most, sane descriptions", () => {
  const names = commandDefinitions.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, "a command is registered twice");
  assert.ok(names.length <= 100, `${names.length} commands — Discord caps a bot at 100`);
  for (const c of commandDefinitions) {
    assert.match(c.name, NAME);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, `/${c.name} description`);
    for (const o of c.options ?? []) {
      assert.match(o.name, NAME);
      assert.ok(o.description.length >= 1 && o.description.length <= 100, `/${c.name} ${o.name} description`);
    }
    assert.ok((c.options ?? []).length <= 25, `/${c.name} has more than 25 options`);
  }
});

test("every catalog verb is registered, and every native one has a handler", () => {
  const registered = new Map(commandDefinitions.map((c) => [c.name, c]));
  for (const a of ACTIONS) {
    const cmd = registered.get(a.command);
    assert.ok(cmd, `/${a.command} is not registered`);
    if (a.sub) assert.ok(cmd.options?.some((o) => o.name === a.sub), `/${a.command} ${a.sub} is not registered`);
    if (a.run === "native") assert.ok(VERBS[a.mode], `${a.mode} is native but has no handler`);
    assert.ok(VERB_COMMANDS.has(a.command));
  }
  for (const name of META_COMMANDS) assert.ok(registered.has(name), `/${name} is not registered`);
  assert.ok(registered.has("actions"));
});

test("a verb with a modal first has one to open, and a modal to answer", () => {
  for (const [mode, verb] of Object.entries(VERBS)) {
    if (verb.modalFirst) assert.equal(typeof verb.modal, "function", `${mode} opens a modal but cannot answer one`);
  }
});

test("custom ids round-trip, a target key's own colon included, and stay under Discord's 100", () => {
  const key = `hood:${"a".repeat(32)}`;
  const id = verbId("detonatecollar", "go", key);
  assert.ok(id.length <= 100, id);
  assert.deepEqual(parseVerbId(id), { mode: "detonatecollar", step: "go", payload: key });
  assert.deepEqual(parseVerbId(verbId("recall", "go")), { mode: "recall", step: "go", payload: null });
  assert.deepEqual(parseModalId(modalId("brand", key)), { mode: "brand", payload: key });
  assert.equal(parseVerbId("loc:open"), null);
});

test("only reads stay open between sessions", () => {
  const open = new Set(ACTIONS.filter((a) => a.open).map((a) => a.mode));
  for (const a of ACTIONS) {
    const prefix = `act:v:${a.mode}:`;
    assert.equal(OPEN_VERB_PREFIXES.includes(prefix), open.has(a.mode), `${a.mode}'s steps are gated wrongly`);
  }
  assert.ok(OPEN_VERB_PREFIXES.includes("act:open"));
});
