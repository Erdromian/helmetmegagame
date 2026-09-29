// The words a character is told about their own appetite (web/lib/descriptors.js):
// Hunger for everybody, Blood in its place for a vampire, nothing for the Hungerless.
//
// The resolve hook supplies what Next resolves for us in the app: @lifeweb/db's
// files by path (archiveText.test.mjs's own).

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB_LIB = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const DB_ROOT = resolvePath(WEB_LIB, "../../db");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@lifeweb/db/")) {
      const file = resolvePath(DB_ROOT, specifier.slice("@lifeweb/db/".length));
      return { url: pathToFileURL(file.endsWith(".js") ? file : `${file}.js`).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { appetiteOf, descriptorsFor } = await import("../descriptors.js");
const { BLOOD_URGENCY_SLUGS } = await import("@lifeweb/db/lib/secretSlugs");

const tags = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));

test("a mortal is told their Hunger", () => {
  assert.deepEqual(appetiteOf({ tags: tags("hungry"), hungerValue: 50 }), {
    key: "hunger",
    label: "Hunger",
    word: "Hungry",
    line: "You could really go for something to eat…",
    tone: "warn",
  });
});

test("a vampire is told their Blood instead, never the number", () => {
  const blood = appetiteOf({ tags: tags("vampire", "hungerless", "satiated"), hungerValue: 100, vampireBloodLevel: 80 });
  assert.deepEqual(blood, {
    key: "blood",
    label: "Blood",
    word: "Satiated",
    line: "Your thirst for human blood is satisfied.",
    tone: "muted",
    // The band chips the tile already shows, so the sheet leaves them off its strip.
    tileSlugs: BLOOD_URGENCY_SLUGS,
  });
  assert.equal(JSON.stringify(blood).includes("80"), false);
  // No urgency tag held yet: read off the level.
  assert.equal(appetiteOf({ tags: tags("vampire", "hungerless"), vampireBloodLevel: 50 }).word, "Thirsty");
});

test("the Hungerless who are not vampires are told nothing", () => {
  assert.equal(appetiteOf({ tags: tags("hungerless"), hungerValue: 100 }), null);
  assert.deepEqual(descriptorsFor({ tags: tags("hungerless") }), []);
});

test("the You plate gets exactly one row, Blood for a vampire", () => {
  const rows = descriptorsFor({ tags: tags("vampire", "hungerless", "famished"), vampireBloodLevel: 20 });
  assert.deepEqual(
    rows.map((r) => [r.key, r.label, r.word]),
    [["blood", "Blood", "Famished"]],
  );
});
