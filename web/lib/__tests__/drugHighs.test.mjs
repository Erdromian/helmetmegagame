// Which drug somebody is on, read back off the state tags it leaves (web/lib/drugHighs.js).
// The table is a copy of what docs/tags.yaml says each item grants, so this holds it to
// that file: a drug whose states drift from its `consumesInto` would go silent, or sound
// for the wrong dose.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { DRUGS, DRUG_STATE_SLUGS, drugsHeld } = await import("../drugHighs.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const yaml = createRequire(import.meta.url)("js-yaml");
const TAGS = yaml.load(fs.readFileSync(path.join(ROOT, "docs", "tags.yaml"), "utf8")).tags;

// What outlives the high rather than being it.
const NOT_THE_HIGH = new Set(["heroin-addict"]);
const grants = (slug) =>
  (TAGS[slug]?.consumesInto ?? []).map((g) => (typeof g === "string" ? g : g.slug)).filter((s) => !NOT_THE_HIGH.has(s));

test("each drug's states are what its item grants, and each state is a real tag", () => {
  for (const d of DRUGS) {
    for (const s of d.states) assert.ok(TAGS[s], `${d.id}: no tag ${s}`);
    // Opium High is a GM's tag with no item behind it.
    if (d.id === "opium") {
      assert.ok(!TAGS.opium);
      continue;
    }
    assert.ok(TAGS[d.id], `${d.id} is not an item`);
    assert.equal(TAGS[d.id].name, d.name, d.id);
    assert.deepEqual([...grants(d.id)].sort(), [...d.states].sort(), d.id);
  }
  assert.ok(DRUG_STATE_SLUGS.includes("changa-high"));
});

test("a drug counts while all its states are held, and Bliss is not also Cave Fungus", () => {
  const at = (slug, ms) => ({ slug, acquiredAt: new Date(ms) });
  assert.deepEqual(drugsHeld([]), []);
  assert.deepEqual(drugsHeld([at("high", 5)]), [{ id: "cave-fungus", takenAt: 5 }]);
  // Refined fungus on top of raw: the newer Euphoric is the dose.
  assert.deepEqual(drugsHeld([at("high", 5), at("euphoric", 9)]), [{ id: "bliss", takenAt: 9 }]);
  // Euphoric alone, the High having run out first: not on Bliss any more.
  assert.deepEqual(drugsHeld([at("euphoric", 9)]), []);
  assert.deepEqual(
    drugsHeld([at("changa-high", 3), at("dissociated", 4)]).map((d) => d.id),
    ["changa", "eth-lod"],
  );
  assert.deepEqual(drugsHeld([{ slug: "doped", acquiredAt: null }]), [{ id: "heroin", takenAt: 0 }]);
});
