// node --test over the pure half of db/lib/fear.js — the band table, the
// wound rungs, the multiplier stack and the coefficient. Run with
// `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FEAR_BANDS,
  PLACE_TERMS,
  NIGHTLY_DECAY,
  EVENTS,
  bandOf,
  placeClassOf,
  placeTermFor,
  arrivalTermFor,
  MOVE_FEAR_TURN_CAP,
  woundRungOf,
  woundFearFor,
  multiplierFor,
  resolveDelta,
  clampFear,
  fearBandDm,
} = require("../lib/fear");

const wound = (extra = {}) => ({
  slug: "x",
  category: "health",
  group: { slug: "health-wounds" },
  requirementResources: null,
  requirementTurns: null,
  requirementGambit: false,
  ...extra,
});

test("bands are half-open, gapless and start at 10", () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(9.99), null);
  assert.equal(bandOf(10).slug, "uncomfortable");
  assert.equal(bandOf(27.99).slug, "uncomfortable");
  assert.equal(bandOf(28).slug, "stressed");
  assert.equal(bandOf(45.99).slug, "stressed");
  assert.equal(bandOf(46).slug, "anxious");
  assert.equal(bandOf(63.99).slug, "anxious");
  assert.equal(bandOf(64).slug, "afraid");
  assert.equal(bandOf(81.99).slug, "afraid");
  assert.equal(bandOf(82).slug, "panic");
  assert.equal(bandOf(100).slug, "panic");
  assert.equal(FEAR_BANDS.length, 5);
  for (let i = 1; i < FEAR_BANDS.length; i += 1) assert.equal(FEAR_BANDS[i].min, FEAR_BANDS[i - 1].max);
});

test("clamp holds the dial inside 0..100", () => {
  assert.equal(clampFear(-5), 0);
  assert.equal(clampFear(140), 100);
  assert.equal(clampFear(33.333), 33.33);
});

test("wound rungs follow the cure ladder, exceptions included", () => {
  assert.equal(woundRungOf(wound()), 0); // tier 0: no requirement block
  assert.equal(woundRungOf(wound({ requirementResources: 0 })), 0.5); // minor-bleeding
  assert.equal(woundRungOf(wound({ requirementResources: 1 })), 1);
  assert.equal(woundRungOf(wound({ requirementResources: 2, requirementTurns: 0 })), 2); // frostbite
  assert.equal(woundRungOf(wound({ requirementResources: 2, requirementTurns: 1 })), 3); // choking
  assert.equal(woundRungOf(wound({ requirementResources: 3, requirementTurns: 1 })), 3.5); // arterial bleed
  assert.equal(woundRungOf(wound({ requirementResources: 4, requirementTurns: 1 })), 4);
  assert.equal(woundRungOf(wound({ requirementResources: 6, requirementTurns: 1 })), 5);
  assert.equal(woundRungOf(wound({ requirementResources: 8, requirementTurns: 1 })), 6);
  assert.equal(woundRungOf(wound({ requirementResources: 8, requirementTurns: 1, requirementGambit: true })), 7);
  assert.equal(woundRungOf(wound({ group: { slug: "health-illness" }, requirementResources: 4 })), null);
  assert.equal(woundRungOf({ slug: "sword", category: "items", group: { slug: "items-weapons" } }), null);
});

test("wound fear is priced per rung and is 0 for untreatable trifles", () => {
  assert.equal(woundFearFor(wound()), 0);
  assert.equal(woundFearFor(wound({ requirementResources: 2, requirementTurns: 1 })), 30);
  assert.equal(woundFearFor(wound({ requirementResources: 8, requirementGambit: true })), 65);
  assert.equal(woundFearFor({ slug: "sword", category: "items", group: { slug: "items-weapons" } }), 0);
});

test("multipliers stack by product, and a cancel forces zero", () => {
  assert.equal(multiplierFor("WILDERNESS", new Set()), 1);
  assert.equal(multiplierFor("WILDERNESS", new Set(["brave", "rough-camper", "agoraphobia"])), 0.5);
  assert.equal(multiplierFor("WILDERNESS", new Set(["outsider", "agoraphobia", "brave"])), 0);
  assert.equal(multiplierFor("CAVE", new Set(["outsider"])), 1); // Outsider says nothing about caves
  assert.equal(multiplierFor("CAVE", new Set(["pale", "claustrophobia"])), 1); // they cancel
  assert.equal(multiplierFor("CAVE", new Set(["spelunker", "claustrophobia"])), 0);
  assert.equal(multiplierFor("WOUND", new Set(["hemophobia"])), 2);
  assert.equal(multiplierFor("WOUND", new Set(["pyrophobia"])), 1);
  assert.equal(multiplierFor("WOUND", new Set(["pyrophobia"]), { burn: true }), 3);
  assert.equal(multiplierFor("WOUND", new Set(["pyrophobia", "hemophobia", "brave"]), { burn: true }), 3);
  assert.equal(multiplierFor("CAVE_TROUBLE", new Set(["teratophobia"])), 3);
  assert.equal(multiplierFor("CRUCIFIED", new Set(["brave"])), 0.5);
});

test("the coefficient scales gains up and relief down", () => {
  const held = new Set();
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: EVENTS.CRUCIFIED, heldSlugs: held, intensity: 1 }), 80);
  assert.equal(resolveDelta({ kind: "CONFESSION", base: EVENTS.CONFESSION, heldSlugs: new Set(["brave"]), intensity: 1 }), -15);
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: 80, heldSlugs: held, intensity: 2 }), 160);
  assert.equal(resolveDelta({ kind: "DRINK", base: -30, heldSlugs: held, intensity: 2 }), -15);
  assert.equal(resolveDelta({ kind: "DRINK", base: -30, heldSlugs: new Set(["brave"]), intensity: 1 }), -30);
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: 80, heldSlugs: held, intensity: 0 }), 0);
  assert.equal(resolveDelta({ kind: "DRINK", base: -30, heldSlugs: held, intensity: 0 }), 0);
});

test("place classes: haven beats indoors, safe cave counts as a roof", () => {
  const cave = { indoors: true, attributes: {}, zone: { kind: "CAVE_LEVEL" } };
  const customs = { indoors: true, attributes: { safe: true, depot: true }, zone: { kind: "CAVE_LEVEL" } };
  const inn = { indoors: true, attributes: { haven: true }, zone: { kind: "SURFACE" } };
  const factory = { indoors: true, attributes: { refinery: true }, zone: { kind: "SURFACE" } };
  const farms = { indoors: false, attributes: {}, zone: { kind: "SURFACE" } };
  const marsh = { indoors: false, attributes: { godflesh: true, wilderness: true }, zone: { kind: "SURFACE" } };
  assert.equal(placeClassOf(cave), "CAVE");
  assert.equal(placeClassOf(customs), "INDOORS");
  assert.equal(placeClassOf(inn), "HAVEN");
  assert.equal(placeClassOf(factory), "INDOORS");
  assert.equal(placeClassOf(farms), "OPEN");
  assert.equal(placeClassOf(marsh), "WILDERNESS");
  assert.equal(placeClassOf(null), "OPEN");
});

test("the three tuning scenarios land where the designer asked", () => {
  const k = 1;
  const held = new Set();
  let fear = 0;
  for (let i = 0; i < 7; i += 1) fear += resolveDelta({ kind: "WILDERNESS", base: EVENTS.WILDERNESS_MOVE, heldSlugs: held, intensity: k });
  assert.equal(fear, 14);
  assert.equal(bandOf(fear).slug, "uncomfortable"); // the walk alone does it
  fear += resolveDelta({ kind: "WILDERNESS", base: PLACE_TERMS.WILDERNESS, heldSlugs: held, intensity: k });
  fear += resolveDelta({ kind: "DECAY", base: NIGHTLY_DECAY, heldSlugs: held, intensity: k });
  assert.equal(fear, 20);
  assert.equal(bandOf(fear).slug, "uncomfortable");
  fear += resolveDelta({ kind: "WOUND", base: woundFearFor(wound({ requirementResources: 2, requirementTurns: 1 })), heldSlugs: held, intensity: k });
  assert.equal(fear, 50);
  assert.equal(bandOf(fear).slug, "anxious");
  // Back to 20, then two nights indoors clear it.
  fear = 20;
  for (let night = 0; night < 2; night += 1) {
    fear += resolveDelta({ kind: "PLACE", base: PLACE_TERMS.INDOORS, heldSlugs: held, intensity: k });
    fear += resolveDelta({ kind: "DECAY", base: NIGHTLY_DECAY, heldSlugs: held, intensity: k });
    fear = clampFear(fear);
  }
  assert.equal(fear, 0);
});

test("the DM names the new band and says when it passes", () => {
  assert.equal(fearBandDm(null, bandOf(30)), "You are now Stressed.");
  assert.equal(fearBandDm(bandOf(30), bandOf(70)), "You are now Afraid.");
  assert.equal(fearBandDm(bandOf(90), bandOf(50)), "You are now Anxious.");
  assert.equal(fearBandDm(bandOf(90), null), "You've calmed down.");
  assert.equal(fearBandDm(bandOf(30), bandOf(31)), null);
  assert.equal(fearBandDm(null, null), null);
});

// Torture (docs/systemdocs/TORTURE.md): +40, halved by Brave like any gain,
// and nothing at all under the two anti-pain statuses — a 0 beats the ×0.5.
test("being tortured is +40 unless you cannot feel it", () => {
  assert.equal(EVENTS.TORTURED, 40);
  const hit = (heldSlugs) => resolveDelta({ kind: "TORTURED", base: EVENTS.TORTURED, heldSlugs });
  assert.equal(hit([]), 40);
  assert.equal(hit(["brave"]), 20);
  assert.equal(hit(["pain-immunity"]), 0);
  assert.equal(hit(["opium-high"]), 0);
  assert.equal(hit(["brave", "pain-immunity"]), 0);
  // The zero is scoped: an Opium High does nothing for a wound.
  assert.equal(multiplierFor("WOUND", ["opium-high"]), 1);
});

// --- the movement ration (MOVE_FEAR_TURN_CAP) -----------------------------

test("only an arrival is movement; a night in the same place is not", () => {
  // The trap this locks down: arrivalTermFor and placeTermFor return the SAME
  // `kind` for wilderness and caves, because kind is what the multipliers read.
  // Only the `move` flag separates a step from a night, and the ration counts
  // steps. Key the cap off `kind` and a night outdoors gets rationed too.
  const wild = { attributes: { wilderness: true }, indoors: false, zone: { kind: "SURFACE" } };
  const cave = { attributes: {}, indoors: false, zone: { kind: "CAVE_LEVEL" } };
  assert.equal(arrivalTermFor(wild).move, true);
  assert.equal(arrivalTermFor(cave).move, true);
  assert.equal(arrivalTermFor(wild).kind, "WILDERNESS");
  assert.equal(placeTermFor("WILDERNESS").kind, "WILDERNESS");
  assert.ok(!placeTermFor("WILDERNESS").move);
  assert.ok(!placeTermFor("CAVE").move);
  // Indoors and havens cost nothing to walk into at all.
  assert.equal(arrivalTermFor({ attributes: { haven: true }, indoors: true, zone: { kind: "SURFACE" } }), null);
});

test("movement fear stops at the cap, and the cap counts what landed", () => {
  const k = 1;
  const step = (held) => resolveDelta({ kind: "WILDERNESS", base: EVENTS.WILDERNESS_MOVE, heldSlugs: held, intensity: k });
  const pooled = (n, held) => {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += step(held);
    return Math.min(sum, MOVE_FEAR_TURN_CAP);
  };

  const plain = new Set();
  // The Refugee's afternoon: five marsh steps, exactly the Uncomfortable line.
  assert.equal(pooled(5, plain), 10);
  assert.equal(bandOf(pooled(5, plain)).slug, "uncomfortable");
  // Under the cap nothing is clipped; over it, the day stops at 15.
  assert.equal(pooled(7, plain), 14);
  assert.equal(pooled(8, plain), 15);
  assert.equal(pooled(40, plain), 15);

  // Brave halves each step, so the same walk costs half — and the cap counts
  // the delta that landed, not the base. Capping bases would have let Brave
  // absorb 30 points of walking for the same 15-point ration.
  const brave = new Set(["brave"]);
  assert.equal(step(brave), 1);
  assert.equal(pooled(8, brave), 8);
  assert.equal(pooled(20, brave), 15);

  // Outsider zeroes wilderness outright: a Brigand walks all day for nothing.
  assert.equal(pooled(20, new Set(["outsider"])), 0);

  // A cave is 3 a step, so the cap arrives two steps sooner.
  const caveStep = resolveDelta({ kind: "CAVE", base: EVENTS.CAVE_MOVE, heldSlugs: plain, intensity: k });
  assert.equal(caveStep, 3);
  assert.equal(Math.min(caveStep * 5, MOVE_FEAR_TURN_CAP), 15);
});

test("the cap does not touch what is not movement", () => {
  const k = 1;
  const held = new Set();
  // A capped day of walking, then a wound and a death in the same turn: both
  // land in full on top, because only movement is pooled.
  let fear = MOVE_FEAR_TURN_CAP;
  fear += resolveDelta({ kind: "DEATH_SEEN", base: EVENTS.DEATH_SEEN, heldSlugs: held, intensity: k });
  assert.equal(fear, 30);
  // And the Cathedral's relief still applies while walking is capped out.
  fear += resolveDelta({ kind: "CATHEDRAL", base: EVENTS.CATHEDRAL, heldSlugs: held, intensity: k });
  assert.equal(fear, 20);
});
