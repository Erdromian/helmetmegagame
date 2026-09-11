// The fighting band, its stacking rule, and the shapes the sync must refuse.
//
// WHAT A FAILURE HERE MEANS. Combat is derived from tags on every read, never
// stored, so there is no row to inspect when a number looks wrong and no
// migration to blame. The band a player sees IS this arithmetic. Two failure
// modes in particular are invisible in play and only catchable here:
//
//  - A conditional bonus that never fires looks exactly like a tag that does
//    nothing, which is exactly what most tags do.
//  - A specialism that pays on the wrong weapon makes somebody quietly better
//    than the catalog says, and nobody reports being too strong.
//
// The four canon values at the bottom are the sharpest case: tipsy, wasted,
// hangover and opium-high state their own tier shift in prose players read.
// The prose and the `fighting:` block are two copies of one number, and this
// is what stops them drifting.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BANDS,
  POINTS_PER_TIER,
  UNTRAINED,
  fightingSkill,
  fightingSkillFor,
  fightingWord,
  formatFightingSkill,
} = require("../lib/fightingSkill");
const { normalizeFighting, validateFighting } = require("../lib/tagShapes");
const { HEALTH_CATEGORY } = require("../lib/medicalVision");

// A held row in the shape every surface passes: `{ tag, equipped }`.
function row(slug, fighting, extra = {}) {
  return { equipped: true, ...extra, tag: { slug, name: slug, fighting, ...(extra.tag ?? {}) } };
}
const melee = (tags) => fightingSkillFor(tags, "melee");
const band = (tags) => melee(tags).band.label;

test("an untrained character is Weak, and sits mid-band", () => {
  assert.equal(band([]), "Weak");
  // Mid-band matters: a peasant picking up a knife or taking one half-tier
  // knock should not change what they are called.
  const b = BANDS.find((x) => x.key === "weak");
  assert.ok(UNTRAINED > b.max - POINTS_PER_TIER && UNTRAINED < b.max);
});

test("every rung lands in the middle of its own band", () => {
  // Basic is rung 1, not rung 0 — the ladder starts at the first rung, and a
  // character on no rung at all simply has no block.
  const expected = ["Mediocre", "Capable", "Seasoned", "Dangerous", "Lethal"];
  expected.forEach((label, i) => {
    const rung = i + 1;
    const r = melee([row("rung", { tree: "melee", rung })]);
    assert.equal(r.band.label, label, `rung ${rung}`);
    const b = BANDS.find((x) => x.label === label);
    assert.ok(r.score > b.max - POINTS_PER_TIER && r.score < b.max, `rung ${rung} sits mid-band`);
  });
});

test("the highest rung held wins, because the ladder chains by parentTag", () => {
  const ladder = [1, 2, 3, 4, 5].map((rung) => row(`melee-${rung}`, { tree: "melee", rung }));
  assert.equal(band(ladder), "Lethal");
  assert.equal(melee(ladder).score, melee([row("top", { tree: "melee", rung: 5 })]).score);
});

test("Pitiful is only reachable downward", () => {
  assert.equal(band([row("missing-arm", { tree: "both", points: -20 })]), "Pitiful");
  // And it is a floor: more wounds do not reach a colder word.
  const piled = [
    row("a", { tree: "both", points: -30 }),
    row("b", { tree: "both", points: -30 }),
    row("c", { tree: "both", points: -30 }),
  ];
  assert.equal(band(piled), "Pitiful");
  assert.equal(melee(piled).score, 0);
});

test("Legendary needs a specialism and the right thing in hand", () => {
  const expert = [row("melee-expert", { tree: "melee", rung: 4 })];
  assert.equal(band(expert), "Dangerous");

  const armed = [
    ...expert,
    row("broadsword", { weaponClass: "sword", points: 5 }, { tag: { equipSlot: "WEAPON" } }),
  ];
  assert.equal(band(armed), "Lethal");

  const specialist = [...armed, row("melee-swords", { tree: "melee", points: 20, when: { weaponClass: ["sword"] } })];
  assert.equal(band(specialist), "Legendary");
});

test("modifiers sum; a maiming and a hangover both land", () => {
  const r = melee([
    row("melee-basic", { tree: "melee", rung: 1 }),
    row("old", { tree: "both", points: -5 }),
    row("hangover", { tree: "both", points: -10 }),
  ]);
  assert.equal(r.score, UNTRAINED + POINTS_PER_TIER - 5 - 10);
});

test("items take the single best — two weapons never pay twice", () => {
  const sword = row("broadsword", { weaponClass: "sword", points: 5 }, { tag: { equipSlot: "WEAPON" } });
  const club = row("mace", { weaponClass: "club", points: 5 }, { tag: { equipSlot: "WEAPON" } });
  const one = melee([sword]).score;
  assert.equal(melee([sword, club]).score, one, "a second weapon adds nothing");
});

test("a specialism pays only on the weapon it names, and pairs with it", () => {
  const swords = row("melee-swords", { tree: "melee", points: 20, when: { weaponClass: ["sword"] } });
  const mace = row("mace", { weaponClass: "club", points: 5 }, { tag: { equipSlot: "WEAPON" } });
  const sword = row("broadsword", { weaponClass: "sword", points: 5 }, { tag: { equipSlot: "WEAPON" } });

  assert.equal(melee([swords, mace]).score, UNTRAINED + 5, "swordsmanship does nothing holding a mace");
  assert.equal(melee([swords, sword]).score, UNTRAINED + 25);
  // Holding both, the better PAIRING wins, not the better weapon.
  assert.equal(melee([swords, sword, mace]).score, UNTRAINED + 25);
});

test("a weapon in a sack is not a weapon", () => {
  const stowed = row("broadsword", { weaponClass: "sword", points: 5 }, { equipped: false, tag: { equipSlot: "WEAPON" } });
  assert.equal(melee([stowed]).score, UNTRAINED);
});

test("a weapon's class decides its half of the tree", () => {
  const bow = row("longbow", { weaponClass: "bow", points: 6 }, { tag: { equipSlot: "WEAPON" } });
  const both = fightingSkill([bow]);
  assert.equal(both.melee.score, UNTRAINED, "a bow does nothing in melee");
  assert.equal(both.ranged.score, UNTRAINED + 6);
});

test("situational entries are listed and never summed", () => {
  const tags = [
    row("melee-duelist", { tree: "melee", points: 20, situational: true }),
    row("guerrilla", { tree: "both", points: 20, situational: true }),
    // No tier and no tree at all, and it still has to reach the list — that
    // list is the whole reason such a tag carries a block.
    row("camouflage", { situational: true }),
  ];
  const r = melee(tags);
  assert.equal(r.score, UNTRAINED, "nothing situational reaches the number");
  assert.equal(r.situational.length, 3);
  assert.equal(r.situational.find((s) => s.label === "melee-duelist").tiers, 2);
  assert.equal(r.situational.find((s) => s.label === "camouflage").tiers, null);
  // The condition text came out of the catalog: a situational says only that a
  // gamemaster decides it, and which moment is the description's job.
  assert.ok(r.situational.every((s) => !("when" in s)));
});

test("conditions are an AND, and each key is really checked", () => {
  const robes = {
    tree: "both",
    points: 20,
    when: { holds: ["thanati"], equipped: ["black-robes"] },
  };
  const worn = row("black-robes", robes, { tag: { equipSlot: "BODY" } });
  const carried = row("black-robes", robes, { equipped: false, tag: { equipSlot: "BODY" } });
  const belief = row("thanati", null);

  assert.equal(melee([worn]).score, UNTRAINED, "robes without the Belief do nothing");
  assert.equal(melee([carried, belief]).score, UNTRAINED, "robes in a pack do nothing");
  assert.equal(melee([worn, belief]).score, UNTRAINED + 20);
});

test("unarmoured reads whether a slot is filled, never what it turns aside", () => {
  const flamboyant = row("melee-flamboyant", { tree: "melee", points: 20, when: { unarmoured: ["BODY"] } });
  const plate = row("plate-armor", null, { tag: { equipSlot: "BODY" } });
  const helm = row("helm", null, { tag: { equipSlot: "HEAD" } });

  assert.equal(melee([flamboyant]).score, UNTRAINED + 20);
  assert.equal(melee([flamboyant, helm]).score, UNTRAINED + 20, "a helmet is not body armour");
  assert.equal(melee([flamboyant, plate]).score, UNTRAINED, "plate switches it off");
});

test("cancels zeroes a modifier and still names what did it", () => {
  const maimed = row("missing-fingers", { tree: "both", points: -15 });
  const ambi = row("ambidextrous", { cancels: ["missing-fingers"] }, { tag: { name: "Ambidextrous" } });

  assert.equal(melee([maimed]).score, UNTRAINED - 15);
  const r = melee([maimed, ambi]);
  assert.equal(r.score, UNTRAINED);
  const named = r.contributors.find((c) => c.label === "missing-fingers");
  assert.ok(named, "the cancelled row is still in the breakdown");
  assert.equal(named.points, 0);
  assert.equal(named.cancelledBy, "Ambidextrous");
});

test("a floor lifts and never caps", () => {
  const apex = row("apex-form", { tree: "both", floor: "legendary" });
  assert.equal(band([apex]), "Legendary");
  // Somebody already above it keeps what they had — a floor is a minimum.
  const r = melee([apex, row("rung", { tree: "melee", rung: 4 })]);
  assert.equal(r.band.label, "Legendary");
  assert.equal(r.floor, "apex-form");
});

test("a cap drops, and beats a floor", () => {
  const bound = row("bound", { tree: "both", cap: "pitiful" });
  assert.equal(band([bound, row("rung", { tree: "melee", rung: 4 })]), "Pitiful");
  assert.equal(band([bound, row("apex-form", { tree: "both", floor: "legendary" })]), "Pitiful");
});

test("both halves are answered, and read melee first", () => {
  const r = fightingSkill([row("m", { tree: "melee", rung: 3 })]);
  assert.equal(formatFightingSkill(r), "Seasoned · Weak");
});

test("the band object survives JSON — Infinity would not", () => {
  const r = JSON.parse(JSON.stringify(fightingSkill([])));
  assert.equal(r.melee.band.label, "Weak");
  assert.equal(fightingWord(UNTRAINED), "Weak");
});

// ─── the door ───────────────────────────────────────────────────────────────

test("tiers are authored as decimals and stored as whole points", () => {
  assert.deepEqual(normalizeFighting({ tree: "both", tiers: -0.5 }), { tree: "both", points: -5 });
  assert.deepEqual(normalizeFighting({ tree: "both", tiers: 2 }), { tree: "both", points: 20 });
  assert.equal(normalizeFighting({ tree: "both", tiers: 0.1 }).points, 1);
});

test("a tier off the 0.1 grid is refused rather than rounded", () => {
  assert.throws(() => normalizeFighting({ tree: "both", tiers: 0.25 }), /multiple of 0\.1/);
});

test("the door refuses the blocks that would silently do nothing", () => {
  const slugs = new Set(["tipsy", "sword-cane"]);
  const opts = (extra = {}) => ({ selfSlug: "x", tagSlugs: slugs, equippable: false, ...extra });

  assert.throws(() => validateFighting({ points: 10 }, opts()), /no tree/);
  assert.throws(() => validateFighting({ weaponClass: "sword", points: 5 }, opts()), /not equippable/);
  assert.throws(
    () => validateFighting({ weaponClass: "sword", tree: "melee" }, opts({ equippable: true })),
    /already decides the tree/,
  );
  assert.throws(() => validateFighting({ tree: "both", points: 10, when: { holds: ["nope"] } }, opts()), /unknown tag/);
  assert.throws(() => validateFighting({ when: { holds: ["tipsy"] } }, opts()), /nothing to apply/);
  assert.throws(() => normalizeFighting({ tree: "melee", rung: 0 }), /at least 1/);
  assert.throws(() => normalizeFighting({ tree: "both", tiers: 1, when: { bogus: ["x"] } }), /unknown key/);
  assert.throws(() => normalizeFighting({ tree: "both", situational: "one-on-one" }), /is a flag/);
  assert.throws(() => normalizeFighting({ tree: "both", tiers: 1, points: 10 }), /tiers and points/);
});

// ─── hands ──────────────────────────────────────────────────────────────────
//
// Not a fighting band, but the same catalog and the same maimings, and the
// failure mode is identical: a surface that forgets to select Tag.handsLost
// reads every maimed character as whole. These live here rather than in a file
// of their own because the values are priced against the fighting ones — an
// arm costs 2.5 tiers and both hands.

const { HANDS_FLOOR, WEAPON_HANDS, handsFor, shedForHands } = require("../lib/equipSlots");

const maim = (slug, handsLost) => ({ tag: { slug, name: slug, handsLost } });

test("a whole person has every hand", () => {
  assert.equal(handsFor([]), WEAPON_HANDS);
  assert.equal(handsFor([{ tag: { slug: "brave" } }]), WEAPON_HANDS);
});

test("an arm costs two hands and a bad hand costs one", () => {
  assert.equal(handsFor([maim("missing-arm", 2)]), 2);
  assert.equal(handsFor([maim("mangled-hand", 1)]), 3);
  assert.equal(handsFor([maim("missing-fingers", 1)]), 3);
});

test("nobody is reduced below two, however much is missing", () => {
  // A character who can hold nothing at all is a dead end rather than a
  // drawback — they cannot carry a torch or take a letter.
  assert.equal(handsFor([maim("missing-arm", 2), maim("missing-arm", 2)]), HANDS_FLOOR);
  assert.equal(handsFor([maim("missing-arm", 2), maim("missing-fingers", 1)]), HANDS_FLOOR);
  assert.equal(handsFor([maim("x", 99)]), HANDS_FLOOR);
});

test("Ambidextrous cancels the fighting penalty but grows no hands", () => {
  const maimed = [
    maim("missing-fingers", 1),
    { tag: { slug: "ambidextrous", name: "Ambidextrous", fighting: { cancels: ["missing-fingers"] } } },
  ];
  // The tier penalty is gone...
  const withFighting = [{ tag: { ...maimed[0].tag, fighting: { tree: "both", points: -15 } } }, maimed[1]];
  assert.equal(fightingSkillFor(withFighting, "melee").score, UNTRAINED);
  // ...and the hand is still missing.
  assert.equal(handsFor(maimed), 3);
});

test("an involuntary loss sheds the excess, fullest hands first", () => {
  const w = (name, twoHanded = false, qty = 1) => ({
    id: name,
    equippedQuantity: qty,
    tag: { name, equipSlot: "WEAPON", twoHanded },
  });
  assert.deepEqual(shedForHands([w("knife"), w("sword")], 4), [], "nothing to shed when it fits");

  // Four hands' worth, cut to two: the two-hander goes first, because putting
  // down one poleaxe beats putting down two knives.
  const shed = shedForHands([w("knife"), w("poleaxe", true), w("dagger")], 2);
  assert.equal(shed[0].id, "poleaxe");
  const left = [w("knife"), w("poleaxe", true), w("dagger")].filter((r) => !shed.some((s) => s.id === r.id));
  assert.ok(left.reduce((n, r) => n + (r.tag.twoHanded ? 2 : 1) * r.equippedQuantity, 0) <= 2);
});

test("a stack fills hands per unit, and sheds per unit", () => {
  const swords = { id: "swords", equippedQuantity: 3, tag: { name: "Sword", equipSlot: "WEAPON" } };
  assert.equal(shedForHands([swords], 2).length, 1, "the whole stack comes off, since it is one row");
});

// --- Second Wind ----------------------------------------------------------

// "Wounds and illnesses don't affect your combat score" — except the really
// bad illnesses. Wounds, maimings and infections are waived whatever they
// cost; an illness is waived only down to -1.5 tiers, which is where the
// catalog itself breaks (nothing sits between -1.5 and -2).
const secondWind = { equipped: true, tag: { slug: "second-wind", name: "Second Wind" } };
function ail(slug, tiers, group) {
  return {
    equipped: true,
    tag: {
      slug,
      name: slug,
      category: HEALTH_CATEGORY,
      group: { slug: group },
      fighting: normalizeFighting({ tree: "both", tiers }),
    },
  };
}

test("Second Wind waives a wound whatever it costs", () => {
  for (const [slug, tiers, group] of [
    ["minor-wound", -1, "health-wounds"],
    ["missing-arm", -3, "health-maiming"],
    ["festering", -2, "health-infection"],
  ]) {
    const r = ail(slug, tiers, group);
    assert.ok(melee([r]).score < melee([]).score, `${slug} should cost something`);
    assert.equal(melee([r, secondWind]).score, melee([]).score, `${slug} should be waived`);
  }
});

test("Second Wind waives an ordinary illness but not one that is killing you", () => {
  const waived = [["leper", -0.3], ["pox", -1], ["heatstroke", -1.5]];
  for (const [slug, tiers] of waived) {
    const r = ail(slug, tiers, "health-illness");
    assert.equal(melee([r, secondWind]).score, melee([]).score, `${slug} should be waived`);
  }
  const kept = [["consumptive", -2], ["appendicitis", -2.5], ["choking", -3]];
  for (const [slug, tiers] of kept) {
    const r = ail(slug, tiers, "health-illness");
    assert.equal(melee([r, secondWind]).score, melee([r]).score, `${slug} must still bite`);
    assert.ok(melee([r, secondWind]).score < melee([]).score);
  }
});

test("Second Wind leaves a state of mind alone", () => {
  const r = ail("shell-shocked", -1, "health-mind");
  assert.equal(melee([r, secondWind]).score, melee([r]).score);
});

// --- Drunken Master -------------------------------------------------------

// The drink costs everyone something and PAYS a Drunken Master — a flat bonus
// on top of whatever the rung costs, so the rungs stay ordered: a second drink
// is still worse than the first, just better than sober either way. The tag
// used to cancel Tipsy exactly and do nothing at all past it, so it read +1 and
// did +0, and a second drink fell off a cliff while the description promised
// Wasted was free. It is a plain modifier now, no `cancels` — which is why the
// block needs `holdsAny`: the rungs replace each other, so `holds` (AND) could
// never match more than one of them.
const drunkenMaster = {
  equipped: true,
  tag: {
    slug: "drunken-master",
    name: "Drunken Master",
    fighting: normalizeFighting({
      tree: "both",
      tiers: 1.9,
      when: { holdsAny: ["tipsy", "wasted", "blind-drunk"] },
    }),
  },
};
const drink = (slug, tiers) => row(slug, normalizeFighting({ tree: "both", tiers }));

// Measured off a TRAINED character rather than an untrained one, because Blind
// Drunk's -3 would take a peasant through the floor at 0 and the clamp, not the
// tag, would be what the numbers showed.
const trained = row("melee-expert", { tree: "melee", rung: 4 });
const drySkilled = () => melee([trained]).score;

test("a drink costs everyone else something", () => {
  const sober = drySkilled();
  assert.equal(melee([trained, drink("tipsy", -0.5)]).score - sober, -5);
  assert.equal(melee([trained, drink("wasted", -1.2)]).score - sober, -12);
  assert.equal(melee([trained, drink("blind-drunk", -3)]).score - sober, -30);
});

test("a Drunken Master is up on every rung, and sober is still sober", () => {
  const sober = drySkilled();
  // The bonus is flat; the OUTCOME is not, because the rungs cost different
  // amounts. Tipsy is the good place to be and Wasted is still a step down
  // from it — just a step down from something above sober. Blind Drunk stays
  // a real loss: the bonus softens it, drinking skill does not restore sight.
  for (const [slug, tiers, net] of [
    ["tipsy", -0.5, 14],
    ["wasted", -1.2, 7],
    ["blind-drunk", -3, -11],
  ]) {
    const score = melee([trained, drink(slug, tiers), drunkenMaster]).score;
    assert.equal(score - sober, net, `${slug}`);
  }
  // No drink, no bonus — the tag is worth nothing to somebody who stays dry.
  assert.equal(melee([trained, drunkenMaster]).score, sober);
});

test("holdsAny is OR where holds is AND", () => {
  // The whole reason holdsAny exists: one rung at a time is all anybody holds.
  const anyBlock = normalizeFighting({
    tree: "both",
    tiers: 1,
    when: { holdsAny: ["tipsy", "wasted"] },
  });
  const allBlock = normalizeFighting({
    tree: "both",
    tiers: 1,
    when: { holds: ["tipsy", "wasted"] },
  });
  const sober = melee([]).score;
  const tipsy = drink("tipsy", -0.8);
  assert.equal(melee([tipsy, row("any", anyBlock)]).score - sober, -8 + POINTS_PER_TIER);
  assert.equal(melee([tipsy, row("all", allBlock)]).score - sober, -8);
});

