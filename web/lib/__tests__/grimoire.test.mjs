// THE RULE: a rite the cult has not earned is not in the Grimoire's text at all — not greyed, not
// stubbed, not shipped with a flag for the client to hide. web/lib/grimoire.js composes the body on
// the server and only the finished string reaches the browser, so "absent from this string" is the
// entire hiding mechanism (docs/systemdocs/THANATI.md §5a).
//
// So the assertion that matters below is the one about the WORD. A reader who is handed the Rite of
// Ascension's Word of the Circle can chant it whether or not the block above it was drawn, and the
// words are re-rolled per game precisely so a phrase cannot be carried in from outside. Asserting only
// that the rite's NAME is missing would pass on a build that still printed the phrase.
//
// The real catalog is imported rather than stubbed: the flag under test (`revealedByObjectives`) lives
// on db/lib/rites.js, and a stub would happily keep passing after somebody dropped it. The resolve
// hook only supplies the file extension Next resolves for us in the app.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const RITES_PATH = resolvePath(WEB_ROOT, "../db/lib/rites.js");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@lifeweb/db/lib/rites") {
      return { url: pathToFileURL(RITES_PATH).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { grimoireBody, expandGrimoire } = await import("../grimoire.js");
const { RITES } = await import(pathToFileURL(RITES_PATH).href);

const ASCENSION = RITES.find((r) => r.key === "ascension");
// Every rite gets a distinct, findable phrase, so "the word leaked" is a substring search.
const WORDS = Object.fromEntries(RITES.map((r) => [r.key, `phrase-for-${r.key}`]));

test("the catalog still flags the rite this is all about", () => {
  assert.equal(ASCENSION.revealedByObjectives, true);
  // Exactly one hidden rite today. A second one appearing is fine, but it should be a deliberate
  // edit to this list rather than something that rode in unnoticed.
  assert.deepEqual(RITES.filter((r) => r.revealedByObjectives).map((r) => r.key), ["ascension"]);
});

test("unrevealed: the rite, its ingredients and above all its Word are absent", () => {
  const body = grimoireBody(WORDS, { revealed: false });

  assert.ok(!body.includes(ASCENSION.name), "the rite's name is in the body");
  assert.ok(!body.includes(WORDS.ascension), "THE WORD OF THE CIRCLE LEAKED");
  assert.ok(!body.includes(ASCENSION.description), "the rite's description is in the body");
  assert.ok(!body.includes("barons-scepter"), "the rite's ingredients are in the body");
  assert.ok(!body.includes(String(ASCENSION.minChanters)), "the rite's chanter count is in the body");

  // Every other rite is untouched — this hides one block, it does not truncate the document.
  for (const rite of RITES.filter((r) => !r.revealedByObjectives)) {
    assert.ok(body.includes(rite.name), `${rite.key} went missing`);
    assert.ok(body.includes(WORDS[rite.key]), `${rite.key} lost its word`);
  }
});

test("revealed: the full block comes back, word included", () => {
  const body = grimoireBody(WORDS, { revealed: true });
  assert.ok(body.includes(ASCENSION.name));
  assert.ok(body.includes(WORDS.ascension));
  assert.ok(body.includes(ASCENSION.description));
  assert.equal(body.split("\n\n").length, RITES.length);
});

test("the default hides rather than leaks", () => {
  // A caller that forgets the option must get the safe answer. This is the whole reason the
  // parameter defaults to false instead of true.
  assert.ok(!grimoireBody(WORDS).includes(WORDS.ascension));
  assert.ok(!grimoireBody().includes("Rite of Ascension"));
});

test("expandGrimoire threads the flag through to the body", () => {
  const doc = { key: "grimoire", description: "{grimoire}" };
  assert.ok(!expandGrimoire(doc, WORDS, { revealed: false }).description.includes(WORDS.ascension));
  assert.ok(expandGrimoire(doc, WORDS, { revealed: true }).description.includes(WORDS.ascension));
  // Unchanged behaviour: a document that is not the Grimoire, or whose body is authored prose
  // rather than the marker, is returned as it came.
  const other = { key: "lore", description: "{grimoire}" };
  assert.equal(expandGrimoire(other, WORDS, { revealed: true }), other);
  const authored = { key: "grimoire", description: "real prose" };
  assert.equal(expandGrimoire(authored, WORDS, { revealed: true }), authored);
});
