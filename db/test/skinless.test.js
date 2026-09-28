// The Skinless (db/lib/skinless.js, docs/systemdocs/SKINLESS.md): the rolled
// body, the grunts, Smell Skin's words, and the rules hung on other systems --
// Cave Eyes in the fighting band, the forced-unlimited party fate, and the
// grunts in the per-reader lens. Pure throughout; no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SKINLESS_NAMES,
  SKINLESS_PRESET_TAGS,
  SKINLESS_WEAPONS,
  SKINLESS_RANDOM_TAGS,
  SKINLESS_TAG_SLUGS,
  seededRng,
  gruntify,
  rollSkinlessIdentity,
  rollSkinlessTags,
  isSkinlessTags,
  smellSkinLine,
  skinlessWordsLine,
} = require("../lib/skinless");
const { fightingSkill } = require("../lib/fightingSkill");
const { normalizeFighting } = require("../lib/tagShapes");
const { normalizePartyFates } = require("../lib/lateParty");
const { lensRow } = require("../lib/strangers");

// A catalog row for every slug, with the conflicts and prerequisites the real
// catalog carries for the ones the roll has to respect.
function catalog() {
  const rows = SKINLESS_TAG_SLUGS.map((slug) => ({ id: `id-${slug}`, slug, requiredTagId: null, conflictsWith: [] }));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  bySlug.get("dwarf").conflictsWith.push({ id: "id-giant" });
  bySlug.get("frail").conflictsWith.push({ id: "id-strong" });
  bySlug.get("giant").conflictsWith.push({ id: "id-strong" });
  bySlug.get("ranged-throwing-weapons").requiredTagId = "id-ranged-basic";
  return rows;
}

// --- The body ----------------------------------------------------------------

test("the name pool is the doc's: 28 names a side", () => {
  assert.equal(SKINLESS_NAMES.MAN.length, 28);
  assert.equal(SKINLESS_NAMES.WOMAN.length, 28);
  assert.ok(SKINLESS_NAMES.MAN.includes("Urist"));
  assert.ok(SKINLESS_NAMES.WOMAN.includes("Ostrich"));
});

test("an identity is a man or a woman, named from that half of the pool, surnamed Skinless", () => {
  for (let seed = 1; seed < 200; seed += 1) {
    const who = rollSkinlessIdentity(seededRng(seed));
    assert.ok(["MAN", "WOMAN"].includes(who.gender));
    assert.ok(SKINLESS_NAMES[who.gender].includes(who.firstName));
    assert.equal(who.lastName, "Skinless");
    assert.equal(who.name, `${who.firstName} Skinless`);
  }
});

test("every body holds the whole preset and exactly one weapon", () => {
  for (let seed = 1; seed < 300; seed += 1) {
    const slugs = rollSkinlessTags(catalog(), seededRng(seed));
    for (const preset of SKINLESS_PRESET_TAGS) assert.ok(slugs.includes(preset), `${preset} missing (seed ${seed})`);
    assert.equal(slugs.filter((s) => SKINLESS_WEAPONS.includes(s)).length, 1);
    assert.equal(new Set(slugs).size, slugs.length, "no tag twice");
  }
});

test("clashing random tags never land together", () => {
  for (let seed = 1; seed < 2000; seed += 1) {
    const slugs = new Set(rollSkinlessTags(catalog(), seededRng(seed)));
    assert.ok(!(slugs.has("dwarf") && slugs.has("giant")), `Dwarf and Giant (seed ${seed})`);
    assert.ok(!(slugs.has("frail") && slugs.has("strong")), `Frail and Strong (seed ${seed})`);
    assert.ok(!(slugs.has("giant") && slugs.has("strong")), `Giant and Strong (seed ${seed})`);
  }
});

test("the likelihoods come out about right: High near half, Low near a tenth", () => {
  const counts = new Map();
  const runs = 4000;
  for (let seed = 1; seed <= runs; seed += 1) {
    for (const slug of rollSkinlessTags(catalog(), seededRng(seed))) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const share = (slug) => (counts.get(slug) ?? 0) / runs;
  assert.ok(Math.abs(share("reckless-attacker") - 0.5) < 0.05);
  assert.ok(Math.abs(share("glass-jaw") - 0.1) < 0.03);
  assert.ok(Math.abs(share("biter") - 0.25) < 0.04);
  assert.equal(SKINLESS_RANDOM_TAGS.length, 22);
});

test("a tag missing from the catalog is skipped rather than granted", () => {
  const rows = catalog().filter((r) => r.slug !== "cave-eyes");
  const slugs = rollSkinlessTags(rows, seededRng(7));
  assert.ok(!slugs.includes("cave-eyes"));
});

test("isSkinlessTags reads either row shape, and ignores an empty stack", () => {
  assert.equal(isSkinlessTags([{ tag: { slug: "skinless" } }]), true);
  assert.equal(isSkinlessTags([{ slug: "skinless" }]), true);
  assert.equal(isSkinlessTags([{ tag: { slug: "skinless" }, quantity: 0 }]), false);
  assert.equal(isSkinlessTags([{ tag: { slug: "fat" } }]), false);
});

// --- The grunts --------------------------------------------------------------

test("grunts are the same for one seed, and different words give different grunts only by seed", () => {
  const line = "Kill the one with the lantern, then take the gate.";
  assert.equal(gruntify(line, 42), gruntify(line, 42));
  assert.notEqual(gruntify(line, 42), gruntify(line, 43));
});

test("grunts keep the length roughly and none of the words", () => {
  const line = "Kill the one with the lantern, then take the gate.";
  const g = gruntify(line, 9);
  const words = line.split(/\s+/).length;
  const noises = g.split(/\s+/).length;
  assert.equal(noises, words);
  for (const word of ["Kill", "lantern", "gate"]) assert.ok(!g.includes(word));
});

// --- Smell Skin and the DM ---------------------------------------------------

test("Smell Skin's words", () => {
  assert.equal(smellSkinLine(null), "You smell no skin anywhere.");
  assert.equal(smellSkinLine(0), "You smell skin right here.");
  assert.equal(smellSkinLine(1), "You smell skin 1 location away.");
  assert.equal(smellSkinLine(4), "You smell skin 4 locations away.");
});

test("the words DM names the speaker as the reader knows them", () => {
  assert.equal(skinlessWordsLine("Urist Skinless", "the gate"), "Urist Skinless says: the gate");
});

// --- Cave Eyes ---------------------------------------------------------------

function caveEyes() {
  return { tag: { slug: "cave-eyes", name: "Cave Eyes", fighting: normalizeFighting({ tree: "both", tiers: 1, when: { zoneKind: ["CAVE_LEVEL"] } }) } };
}

test("Cave Eyes adds a tier to both trees in the caves", () => {
  const bare = fightingSkill([], { zoneKind: "CAVE_LEVEL" });
  const eyes = fightingSkill([caveEyes()], { zoneKind: "CAVE_LEVEL" });
  assert.equal(eyes.melee.score - bare.melee.score, 10);
  assert.equal(eyes.ranged.score - bare.ranged.score, 10);
});

test("Cave Eyes adds nothing on the surface", () => {
  const bare = fightingSkill([], { zoneKind: "SURFACE" });
  const eyes = fightingSkill([caveEyes()], { zoneKind: "SURFACE" });
  assert.equal(eyes.melee.score, bare.melee.score);
  assert.equal(eyes.melee.situational.length, 0);
});

test("with nowhere given, Cave Eyes is listed for the GM rather than added", () => {
  const bare = fightingSkill([]);
  const eyes = fightingSkill([caveEyes()]);
  assert.equal(eyes.melee.score, bare.melee.score);
  assert.deepEqual(eyes.melee.situational.map((s) => s.label), ["Cave Eyes"]);
});

test("the catalog refuses an unknown zone kind", () => {
  assert.throws(() => normalizeFighting({ tree: "both", tiers: 1, when: { zoneKind: ["MOON"] } }), /zoneKind/);
});

// --- The lateparty -----------------------------------------------------------

test("a Skinless fate is unlimited whatever slots were typed", () => {
  const fates = normalizePartyFates(
    [
      { roleSlug: "skinless", slots: "5" },
      { roleSlug: "guard", slots: "3" },
    ],
    ["skinless", "guard"],
    { alwaysUnlimited: ["skinless"] },
  );
  assert.deepEqual(fates, [
    { roleSlug: "skinless", slots: null },
    { roleSlug: "guard", slots: 3 },
  ]);
});

// --- The lens ----------------------------------------------------------------

function speechRow(overrides = {}) {
  return { seq: "77", characterId: "sk", name: "Urist Skinless", content: "Take the gate.", source: "WEB", ...overrides };
}
const knownFacts = new Map([["sk", { known: true }]]);

test("a reader without skin hears grunts from a Skinless", () => {
  const out = lensRow(speechRow(), { characterId: "reader", facts: knownFacts, grunters: new Set(["sk"]), readerSkinless: false });
  assert.equal(out.content, gruntify("Take the gate.", 77));
});

test("another Skinless hears the words", () => {
  const out = lensRow(speechRow(), { characterId: "reader", facts: knownFacts, grunters: new Set(["sk"]), readerSkinless: true });
  assert.equal(out.content, "Take the gate.");
});

test("a GM, the speaker, and a system line keep the words", () => {
  const grunters = new Set(["sk"]);
  assert.equal(lensRow(speechRow(), { gm: true, grunters }).content, "Take the gate.");
  assert.equal(lensRow(speechRow(), { characterId: "sk", grunters }).content, "Take the gate.");
  assert.equal(lensRow(speechRow({ source: "SYSTEM" }), { characterId: "reader", facts: knownFacts, grunters }).content, "Take the gate.");
});

test("a ghost (no character) hears grunts", () => {
  const out = lensRow(speechRow(), { characterId: null, grunters: new Set(["sk"]), readerSkinless: false });
  assert.equal(out.content, gruntify("Take the gate.", 77));
});
