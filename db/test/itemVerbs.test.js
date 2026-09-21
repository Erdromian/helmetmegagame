// node --test over db/lib/itemVerbs.js — the list linking an item to its own
// verb. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { ITEM_VERBS, LOCAL_MODES, verbsForTag } = require("../lib/itemVerbs");

const ROOT = path.join(__dirname, "..", "..");
const TAGS = yaml.load(fs.readFileSync(path.join(ROOT, "docs", "tags.yaml"), "utf8")).tags;
const SLUGS = Object.keys(TAGS);

// The registry is an ES module full of icon imports, so it is read as text.
const REGISTRY = fs.readFileSync(path.join(ROOT, "web", "app", "components", "actionRegistry.js"), "utf8");
const REGISTRY_MODES = new Set([...REGISTRY.matchAll(/\bmode:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]));

// The two local modes are handled by name in the menus.
const LOCAL_FILE = fs.readFileSync(path.join(ROOT, "web", "app", "components", "useSoundItem.js"), "utf8");

test("every mode is a registry mode, or one of the two sounded by useSoundItem", () => {
  for (const { mode } of ITEM_VERBS) {
    if (LOCAL_MODES.has(mode)) {
      assert.match(LOCAL_FILE, new RegExp(`\\b${mode}:\\s*\\{`), `${mode} missing from useSoundItem.js`);
    } else {
      assert.ok(REGISTRY_MODES.has(mode), `${mode} is not in actionRegistry.js`);
    }
  }
});

test("every slug, prefix and suffix names something in tags.yaml", () => {
  for (const { match } of ITEM_VERBS) {
    if (match.slug) assert.ok(TAGS[match.slug], `${match.slug} is not in tags.yaml`);
    // custom-pointer-* is minted at runtime (db/lib/pointerMint.js), never catalogued.
    if (match.suffix) assert.ok(SLUGS.some((s) => s.endsWith(match.suffix)), `nothing ends ${match.suffix}`);
  }
});

test("every flag matches at least one catalogued item", () => {
  for (const { match } of ITEM_VERBS) {
    if (!match.flag) continue;
    const hits = SLUGS.filter((s) => verbsForTag({ slug: s, ...TAGS[s] }).length > 0 && TAGS[s][match.flag]);
    assert.ok(hits.length > 0, `no tag carries ${match.flag}`);
  }
});

test("the Accordion plays, and a plain item has no verb of its own", () => {
  assert.deepEqual(verbsForTag({ slug: "accordion", ...TAGS.accordion }), ["play"]);
  assert.deepEqual(verbsForTag({ slug: "rope", ...TAGS.rope }), []);
});

test("the datacard opens its three, each once", () => {
  assert.deepEqual(verbsForTag({ slug: "nuclear-datacard" }), ["pointer", "arm", "disarm"]);
});

test("a wax stamp seals and a sealed letter does not", () => {
  assert.deepEqual(verbsForTag({ slug: "x", sealMark: "an ox" }), ["seal"]);
  assert.deepEqual(verbsForTag({ slug: "x", sealMark: "an ox", paperKind: "SEALED" }), []);
});

test("seed bags farm and a pointer device reads", () => {
  assert.deepEqual(verbsForTag({ slug: "wheat-seed-bag" }), ["farm"]);
  assert.deepEqual(verbsForTag({ slug: "custom-pointer-ab12-a" }), ["pointerdevice"]);
});
