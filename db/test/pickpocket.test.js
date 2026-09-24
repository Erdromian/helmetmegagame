// The pure half of pickpocketing (db/lib/pickpocket.js). Two things worth
// pinning: the three outcome bands, because the middle one (you get it AND they
// feel it) is the whole texture of the verb and is easy to collapse into a
// plain pass/fail by accident; and the holdings filter, where the Assets clause
// is a real hole rather than a nicety.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SKILLED_BONUS,
  BUDGET_LBS,
  SKILLED_BUDGET_LBS,
  CLEAN,
  NOTICED,
  FAILED,
  DEFENSE_SLUGS,
  holdsPickpocket,
  isSkilled,
  pickpocketBonus,
  pickpocketBudgetLbs,
  pickpocketDefense,
  pickpocketOutcome,
  pickpocketTook,
  pickpocketableHoldings,
  pickpocketFitCount,
  weighPicks,
} = require("../lib/pickpocket");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));
const band = (die, tags = []) => pickpocketOutcome(die + pickpocketBonus(tags));
// The whole sum, the way actions/pickpocket.js computes it: the thief's bonus
// on, the mark's defense off.
const defended = (die, thief = [], mark = []) =>
  pickpocketOutcome(die + pickpocketBonus(thief) - pickpocketDefense(mark));

test("the three bands: 1 fails, 2-3 is noticed, 4+ is clean", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((d) => band(d)),
    [FAILED, NOTICED, NOTICED, CLEAN, CLEAN, CLEAN],
  );
});

test("both success bands take the goods; only a 1 takes nothing", () => {
  assert.equal(pickpocketTook(CLEAN), true);
  assert.equal(pickpocketTook(NOTICED), true);
  assert.equal(pickpocketTook(FAILED), false);
});

// "Almost always succeeds" is the claim the tag makes, and this is it: the +1
// lifts a natural 1 clear of the failure band, so a master is never caught
// empty-handed — only felt. Against an undefended mark, that is; the defense
// tests below are where that stops being true.
test("Skilled's +1 means a master never fails outright", () => {
  assert.equal(SKILLED_BONUS, 1);
  const master = held("pickpocket", "pickpocketing-skilled");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => band(d, master)), [
    NOTICED,
    NOTICED,
    CLEAN,
    CLEAN,
    CLEAN,
    CLEAN,
  ]);
});

test("the budget doubles for a master", () => {
  assert.equal(pickpocketBudgetLbs(held("pickpocket")), BUDGET_LBS);
  assert.equal(pickpocketBudgetLbs(held("pickpocket", "pickpocketing-skilled")), SKILLED_BUDGET_LBS);
  assert.equal(BUDGET_LBS, 15);
  assert.equal(SKILLED_BUDGET_LBS, 30);
});

test("either rung opens the verb; only the top one is skilled", () => {
  assert.equal(holdsPickpocket(held("pickpocket")), true);
  // A GM grant of the top rung alone still works — the catalog's requiredTag
  // is what normally puts both on a sheet, but this reads the pair, not the
  // invariant.
  assert.equal(holdsPickpocket(held("pickpocketing-skilled")), true);
  assert.equal(holdsPickpocket(held("stealth")), false);
  assert.equal(isSkilled(held("pickpocket")), false);
  assert.equal(pickpocketBonus(held("pickpocket")), 0);
});

const row = (over) => ({ quantity: 1, equipped: false, tag: { tradeable: true, category: "Items", weightLbs: 3 }, ...over });

test("what a hand can reach: tradeable, not worn, not an Asset", () => {
  assert.equal(pickpocketableHoldings([row()]).length, 1);
  // A skill or an injury was never cargo.
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: false, category: "Skills" } })]).length, 0);
  // Lifting a worn breastplate off a standing man is a fight, not a theft.
  assert.equal(pickpocketableHoldings([row({ equipped: true })]).length, 0);
  assert.equal(pickpocketableHoldings([row({ quantity: 0 })]).length, 0);
});

// The one that would be a hole rather than a nicety. An Asset weighs 0 on
// purpose (an arelitz carries itself, CARRY.md §1), so the weight budget — the
// only brake this verb has — cannot bound it. Without this clause 15 lb buys
// every arelitz, deed and house somebody has on them, unlimited.
test("Assets are off the table entirely, because the budget cannot measure them", () => {
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: true, category: "Assets", weightLbs: 0 } })]).length, 0);
  // Case-folded, matching tagWeight.js — the catalog has held both spellings.
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: true, category: "assets", weightLbs: 0 } })]).length, 0);
});

// One kind of thing, as many as fit — this is what the dialog's "All" means.
test("as many of one stack as fit in the budget", () => {
  assert.equal(pickpocketFitCount(3, 15, 10), 5);
  assert.equal(pickpocketFitCount(3, 15, 2), 2);
  assert.equal(pickpocketFitCount(3, 30, 10), 10);
  // Heavier than the whole budget: none of it.
  assert.equal(pickpocketFitCount(20, 15, 1), 0);
  // Float: 1.5 / 0.3 is 4.999… unguarded.
  assert.equal(pickpocketFitCount(0.3, 1.5, 9), 5);
  assert.equal(pickpocketFitCount(0.1, 15, 500), 150);
  // Weightless — the budget cannot measure it, so all of it fits.
  assert.equal(pickpocketFitCount(0, 15, 40), 40);
  assert.equal(pickpocketFitCount(3, 15, 0), 0);
});

test("picks are weighed per unit, not per row", () => {
  const r = row({ quantity: 5 });
  assert.equal(weighPicks([{ held: r, quantity: 2 }]), 6);
  assert.equal(weighPicks([]), 0);
});

// ─── The mark's defense (THEFT.md §2h) ─────────────────────────────────────

test("defense: one off the total for each of the four tags, and nothing else", () => {
  assert.equal(DEFENSE_SLUGS.length, 4);
  assert.equal(pickpocketDefense([]), 0);
  assert.equal(pickpocketDefense(held("keen-hearing")), 1);
  assert.equal(pickpocketDefense(held("eagle-eyes")), 1);
  assert.equal(pickpocketDefense(held("pickpocket")), 1);
  // Each RUNG counts, so a master thief's own pockets are two points harder.
  assert.equal(pickpocketDefense(held("pickpocket", "pickpocketing-skilled")), 2);
  assert.equal(pickpocketDefense(held("keen-hearing", "eagle-eyes", "pickpocket", "pickpocketing-skilled")), 4);
  // Stealth, Lucky and the drink are the thief's business, not the mark's.
  assert.equal(pickpocketDefense(held("stealth", "lucky", "tipsy")), 0);
});

test("each point of defense shifts the whole band up one face", () => {
  const ears = held("keen-hearing");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => defended(d, [], ears)), [
    FAILED,
    FAILED,
    NOTICED,
    NOTICED,
    CLEAN,
    CLEAN,
  ]);
  // And the master's +1 cancels one point of it exactly.
  const master = held("pickpocket", "pickpocketing-skilled");
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((d) => defended(d, master, ears)),
    [1, 2, 3, 4, 5, 6].map((d) => band(d)),
  );
});

// Where a plain thief stops ever getting away with it: three points closes
// the clean band for them, and only Skilled reopens it, on a 6.
test("three points of defense puts a clean take out of an unskilled thief's reach", () => {
  const three = held("keen-hearing", "eagle-eyes", "pickpocket");
  assert.equal([1, 2, 3, 4, 5, 6].map((d) => defended(d, [], three)).includes(CLEAN), false);
  const master = held("pickpocket", "pickpocketing-skilled");
  assert.equal(defended(6, master, three), CLEAN);
  assert.equal(defended(5, master, three), NOTICED);
});

// The ceiling. Somebody wearing all four is never picked clean — a 6 and the
// Skilled +1 still land on 3 — but the noticed band never closes, so they are
// not immune, only never unfelt. That is the design: defense buys KNOWING.
test("full defense: never clean, never immune", () => {
  const wary = held("keen-hearing", "eagle-eyes", "pickpocket", "pickpocketing-skilled");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => defended(d, [], wary)), [
    FAILED,
    FAILED,
    FAILED,
    FAILED,
    FAILED,
    NOTICED,
  ]);
  const master = held("pickpocket", "pickpocketing-skilled");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => defended(d, master, wary)), [
    FAILED,
    FAILED,
    FAILED,
    FAILED,
    NOTICED,
    NOTICED,
  ]);
});
