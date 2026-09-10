// node --test over the pure halves of the mastery tags (TAGS.md 4a) that are
// testable without Prisma: Amor Fati's sign-flipping mood multiplier, Second
// Wind's Health-penalty waiver, and Manic's Desire-slot bypass. Lucky and
// Scavenging have their own file (advantage.test.js). Run with
// `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDelta, multiplierFor, MULTIPLIER_SLUGS, EVENTS } = require("../lib/mood");
const { fightingSkillFor } = require("../lib/fightingSkill");
const { slotStates, desireSlotsNeverLock } = require("../lib/desireGates");

const AMOR = ["amor-fati"];

// --- Amor Fati ------------------------------------------------------------
// "Unfortunate incidents only serve to make you pleased." A negative factor
// in the multiplier table, so harm comes back as relief.

test("a shock pays back half its sting as mood instead of taking it", () => {
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: EVENTS.CRUCIFIED, heldSlugs: AMOR }), 40);
  assert.equal(resolveDelta({ kind: "TORTURED", base: EVENTS.TORTURED, heldSlugs: AMOR }), 20);
  assert.equal(resolveDelta({ kind: "MUTILATED", base: EVENTS.MUTILATED, heldSlugs: AMOR }), 25);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: AMOR }), 15);
});

test("the ever-present miseries simply stop landing, and do not become a pleasure", () => {
  for (const kind of ["WILDERNESS", "CAVE", "HUNGER", "CORPSE", "NOBLE_MEAL"]) {
    const got = resolveDelta({ kind, base: -10, heldSlugs: AMOR });
    assert.equal(got, 0, `${kind} should be nothing at all, got ${got}`);
    // Not -0: it adds like zero but prints like a bug.
    assert.ok(Object.is(got, 0), `${kind} resolved to -0`);
  }
});

test("relief is untouched — Amor Fati is not a damper on good things", () => {
  assert.equal(resolveDelta({ kind: "KISS", base: EVENTS.KISS, heldSlugs: AMOR }), EVENTS.KISS);
  assert.equal(resolveDelta({ kind: "MUSIC", base: EVENTS.MUSIC, heldSlugs: AMOR }), EVENTS.MUSIC);
});

test("nobody else is changed by the new rows", () => {
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: EVENTS.CRUCIFIED, heldSlugs: [] }), -80);
  assert.equal(multiplierFor("WOUND", ["brave"]), 0.5);
  assert.equal(multiplierFor("WILDERNESS", ["outsider"]), 0);
});

// --- Imperturbable --------------------------------------------------------
// It works through `intensity` rather than a multiplier, because a multiplier
// is only consulted for harm and the tag has to stop the climb as well.

test("intensity zero stops the dial in BOTH directions", () => {
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [], intensity: 0 }), 0);
  assert.equal(resolveDelta({ kind: "KISS", base: 15, heldSlugs: [], intensity: 0 }), 0);
});

test("Imperturbable is on the watched-slug list, or the nightly pass would miss it", () => {
  assert.ok(MULTIPLIER_SLUGS.includes("imperturbable"));
  assert.ok(MULTIPLIER_SLUGS.includes("amor-fati"));
  assert.equal(MULTIPLIER_SLUGS.length, new Set(MULTIPLIER_SLUGS).size, "no duplicate slugs");
});

// --- Second Wind ----------------------------------------------------------
const tag = (slug, category, fighting) => ({ tag: { slug, name: slug, category, fighting } });
const SKILL = tag("melee-basic", "Skills", { tree: "melee", rung: 1 });
const SECOND_WIND = tag("second-wind", "General", null);
const WOUND = tag("broken-arm", "Health", { tree: "both", points: -15 });

test("a Health penalty stops counting, but is still named at zero", () => {
  const without = fightingSkillFor([SKILL, WOUND], "melee");
  const with_ = fightingSkillFor([SKILL, WOUND, SECOND_WIND], "melee");
  assert.ok(with_.score > without.score, "the wound should stop costing anything");
  const row = with_.contributors.find((c) => c.label === "broken-arm");
  assert.ok(row, "the wound is still listed, so a player can read why it is free");
  assert.equal(row.points, 0);
  assert.equal(row.cancelledBy, "Second Wind");
});

test("a non-Health penalty is untouched", () => {
  const hangover = tag("hangover", "Status", { tree: "both", points: -10 });
  const with_ = fightingSkillFor([SKILL, hangover, SECOND_WIND], "melee");
  assert.equal(with_.contributors.find((c) => c.label === "hangover").points, -10);
});

test("the three Health tags that CAP the band still do", () => {
  for (const slug of ["dying", "paralyzed", "seizure"]) {
    const capped = fightingSkillFor(
      [SKILL, SECOND_WIND, tag(slug, "Health", { tree: "both", cap: "pitiful" })],
      "melee",
    );
    assert.equal(capped.band.key, "pitiful", `${slug} should still take you out of a fight`);
  }
});

test("a Health effect that HELPS keeps helping", () => {
  const boon = tag("adrenaline", "Health", { tree: "both", points: 10 });
  const with_ = fightingSkillFor([SKILL, boon, SECOND_WIND], "melee");
  assert.equal(with_.contributors.find((c) => c.label === "adrenaline").points, 10);
});

// --- Manic ----------------------------------------------------------------

test("Manic is recognised in every tag shape the app passes around", () => {
  assert.equal(desireSlotsNeverLock([{ tag: { slug: "manic" } }]), true);
  assert.equal(desireSlotsNeverLock([{ slug: "manic" }]), true);
  assert.equal(desireSlotsNeverLock(new Set(["manic"])), true);
  assert.equal(desireSlotsNeverLock([]), false);
});

test("a Manic slot reopens the instant it empties, where an ordinary one waits", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED" }];
  const args = { history, openTurnNumber: 5, desireSlots: 1, lockTurns: 1 };
  assert.equal(slotStates(args)[0].lockedUntilTurn, 7);
  assert.equal(slotStates({ ...args, noLock: true })[0].lockedUntilTurn, null);
  assert.equal(slotStates({ ...args, noLock: true })[0].lockedTurnsLeft, null);
});

// The bug this guards: lockTurns 0 still reads `openTurnNumber <= maxEnded`,
// which is TRUE on the turn of the claim. Zero means "reopens tomorrow".
test("lockTurns 0 is NOT the same as no lock, which is why noLock exists", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED" }];
  const args = { history, openTurnNumber: 5, desireSlots: 1 };
  assert.equal(slotStates({ ...args, lockTurns: 0 })[0].lockedUntilTurn, 6);
  assert.equal(slotStates({ ...args, lockTurns: 0, noLock: true })[0].lockedUntilTurn, null);
});

test("Manic still leaves the last claim readable in the slot", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED", id: "d1" }];
  const slot = slotStates({ history, openTurnNumber: 5, desireSlots: 1, lockTurns: 1, noLock: true })[0];
  assert.equal(slot.lastEnded.id, "d1");
});

// --- Metempsychosis: who the new body turns out to be ---------------------
// reincarnate() itself needs Prisma, so what is pinned here is the rolling —
// the part that decides a person — not the transaction around it.
const { randomCharacterName, NAME_CORPUS } = require("../lib/nameCorpus");
const { GENDERS } = require("../lib/titles");
const { isDynastyMember } = require("../lib/dynasty");
const { AGE_MIN, AGE_MAX } = require("../lib/characterName");

const namesIn = (...pools) => new Set(pools.flat().map((n) => n.name));
const MALE_OK = namesIn(NAME_CORPUS.medieval.male, NAME_CORPUS.flavour.male, NAME_CORPUS.flavour.witcher);
const FEMALE_OK = namesIn(NAME_CORPUS.medieval.female, NAME_CORPUS.flavour.female);

test("a rolled MAN draws only from the male pools, a WOMAN only from the female", () => {
  for (let i = 0; i < 300; i++) {
    assert.ok(MALE_OK.has(randomCharacterName({ gender: "MAN" }).firstName));
    assert.ok(FEMALE_OK.has(randomCharacterName({ gender: "WOMAN" }).firstName));
  }
});

test("NEUTRAL draws from both, so over many rolls it reaches each side", () => {
  let male = 0;
  let female = 0;
  for (let i = 0; i < 400; i++) {
    const { firstName } = randomCharacterName({ gender: "NEUTRAL" });
    if (MALE_OK.has(firstName)) male += 1;
    if (FEMALE_OK.has(firstName)) female += 1;
  }
  assert.ok(male > 0 && female > 0, `neutral reached only one pool (${male}/${female})`);
});

// The three dynasty seats wear the living Baron's last name, so the corpus
// must hand back none for them — reincarnate() then fetches it. Rolling one
// would give the Heir a surname that isn't his family's.
test("a dynasty seat gets no rolled surname", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(randomCharacterName({ gender: "MAN", lastNameLocked: true }).lastName, null);
  }
  assert.ok(randomCharacterName({ gender: "MAN" }).lastName, "an ordinary seat still gets one");
});

test("isDynastyMember covers exactly the three seats that inherit the name", () => {
  for (const slug of ["baroness", "heir", "successor"]) assert.equal(isDynastyMember(slug), true, slug);
  // The Baron is the SOURCE of the name, not an inheritor — and he is
  // whitelisted, so a reincarnating soul never lands on him anyway.
  for (const slug of ["baron", "migrant", "bum"]) assert.equal(isDynastyMember(slug), false, slug);
});

test("a rolled age stays inside the bounds the wizard validates, and reaches both ends", () => {
  const roll = () => AGE_MIN + Math.floor(Math.random() * (AGE_MAX - AGE_MIN + 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const age = roll();
    assert.ok(Number.isInteger(age) && age >= AGE_MIN && age <= AGE_MAX, `out of range: ${age}`);
    lo = Math.min(lo, age);
    hi = Math.max(hi, age);
  }
  assert.equal(lo, AGE_MIN);
  assert.equal(hi, AGE_MAX);
});

test("GENDERS is the three-value set the roll picks from", () => {
  assert.deepEqual([...GENDERS].sort(), ["MAN", "NEUTRAL", "WOMAN"]);
});
