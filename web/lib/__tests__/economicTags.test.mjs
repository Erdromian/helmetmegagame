// What the Economist's /econ/players page may list of a character's tags
// (web/lib/economicTags.js). The rule is a server-side cut: a row it refuses
// is never sent to the browser, so these are the only assertions that stand
// between the cult's kit and the Economist's screen.
//
// The two named tags are read out of docs/tags.yaml rather than stubbed as
// SECRET, so the test fails the day somebody re-files Black Robes as
// catalog:gm — that is the regression this exists to catch.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");
const DB_ROOT = resolvePath(ROOT, "db");

// The resolve hook supplies what Next resolves for us in the app: @lifeweb/db's
// files by path, and the extensionless relative imports web/lib writes
// (descriptors.test.mjs's own, plus the relative half).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@lifeweb/db/")) {
      const file = resolvePath(DB_ROOT, specifier.slice("@lifeweb/db/".length));
      return { url: pathToFileURL(file.endsWith(".js") ? file : `${file}.js`).href, shortCircuit: true };
    }
    if (specifier.startsWith("./") && !/\.[cm]?js$/.test(specifier) && context.parentURL) {
      return nextResolve(`${specifier}.js`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { isEconomicTag, ECONOMIC_TAG_RULE_SELECT } = await import("../economicTags.js");

const yaml = readFileSync(resolvePath(ROOT, "docs/tags.yaml"), "utf8");

// The `catalog:` line of one top-level tag entry, the way db/lib/syncTags.js
// files it onto Tag.catalogVisibility.
function catalogOf(slug) {
  const m = yaml.match(new RegExp(`^  ${slug}:\\n(?:    .*\\n)*?    catalog: (\\w+)`, "m"));
  assert.ok(m, `docs/tags.yaml has no "${slug}"`);
  return { secret: "SECRET", gm: "GM", all: "ALL" }[m[1]];
}

const item = (over = {}) => ({ category: "Items", catalogVisibility: "ALL", paperKind: null, photoOfCharacterId: null, requiredTag: null, group: null, ...over });

test("an ordinary Item, Asset or economic skill shows", () => {
  assert.equal(isEconomicTag(item()), true);
  assert.equal(isEconomicTag(item({ category: "Assets" })), true);
  assert.equal(isEconomicTag(item({ category: "Skills", group: { slug: "skills-crafting" } })), true);
  assert.equal(isEconomicTag(item({ category: "Skills", group: { slug: "skills-combat" } })), false);
  assert.equal(isEconomicTag(item({ category: "Health" })), false);
  assert.equal(isEconomicTag(item({ category: "General" })), false);
});

test("the cult's kit is SECRET in the catalog and never shows", () => {
  for (const slug of ["grimoire", "black-robes", "thanati", "dark-inspiration"]) {
    const catalogVisibility = catalogOf(slug);
    if (slug === "dark-inspiration") {
      // Its own line is catalog:gm — it is kept out by being General, not by
      // being secret, and the assertion below says so.
      assert.equal(catalogVisibility, "GM");
      continue;
    }
    assert.equal(catalogVisibility, "SECRET", `${slug} should be catalog: secret`);
    assert.equal(isEconomicTag(item({ catalogVisibility })), false, slug);
  }
  assert.equal(isEconomicTag(item({ category: "General", catalogVisibility: "GM" })), false);
});

test("a GM-catalog ware behind a secret gate is out with it", () => {
  const secretGate = { catalogVisibility: "SECRET" };
  assert.equal(isEconomicTag(item({ catalogVisibility: "GM", requiredTag: secretGate })), false);
  assert.equal(isEconomicTag(item({ catalogVisibility: "GM", group: { slug: "items-special", requiredTag: secretGate } })), false);
  assert.equal(isEconomicTag(item({ catalogVisibility: "GM", requiredTag: { catalogVisibility: "GM" } })), true);
});

test("a written sheet, a book, an envelope or a photograph never shows", () => {
  for (const paperKind of ["PAPER", "SEALED", "BROKEN_SEAL", "BOOK", "DOCUMENTS"]) {
    assert.equal(isEconomicTag(item({ paperKind })), false, paperKind);
  }
  assert.equal(isEconomicTag(item({ photoOfCharacterId: "c1" })), false);
  // Blank paper carries no paperKind and is stock like anything else.
  assert.equal(isEconomicTag(item({ group: { slug: "items-paper" } })), true);
});

test("the shared select carries every column the rule reads", () => {
  for (const col of ["category", "catalogVisibility", "paperKind", "photoOfCharacterId", "requiredTag", "group"]) {
    assert.ok(ECONOMIC_TAG_RULE_SELECT[col], col);
  }
  assert.ok(ECONOMIC_TAG_RULE_SELECT.requiredTag.select.catalogVisibility);
  assert.ok(ECONOMIC_TAG_RULE_SELECT.group.select.requiredTag.select.catalogVisibility);
});
