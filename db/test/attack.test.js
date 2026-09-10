// The strength gate on the Attack button (docs/systemdocs/ATTACK.md).
//
// WHAT A FAILURE HERE MEANS. This is the only thing standing between a bum and
// a whole day of the Tribunal Ordinator's time, and it is also the only thing
// a player ever learns about somebody else's fighting band (COMBAT.md §5). Too
// loose and the verb is a griefing tool; too tight and it refuses ordinary
// fights and leaks more than it should.
//
// The capped-champion case at the bottom is the one that decided the whole
// shape: floor:/cap: tags move the BAND after the points are summed, so a
// bound Expert still scores 55. A score-based gate would let a tied-up
// champion refuse to be attacked, which is exactly backwards.
const test = require("node:test");
const assert = require("node:assert/strict");

const { attackRefusal, bestBandRank, MAX_BAND_GAP, TOO_STRONG } = require("../lib/attack");
const { bandRank } = require("../lib/fightingSkill");

// A held row in the shape every surface passes: `{ tag, equipped }`.
function row(slug, fighting, extra = {}) {
  return { equipped: true, ...extra, tag: { slug, name: slug, fighting } };
}
// Rungs: Basic 1, Trained 2, Skilled 3, Expert 4. Untrained is no row at all.
const rung = (n) => row(`melee-${n}`, { tree: "melee", rung: n });

test("everybody starts Weak, on both halves", () => {
  assert.equal(bestBandRank([]), bandRank("weak"));
});

test("a peasant may attack a peasant", () => {
  assert.equal(attackRefusal([], []), null);
});

test("a peasant may attack two bands up, and no further", () => {
  // Weak(1) -> Capable(3) is exactly MAX_BAND_GAP.
  assert.equal(bestBandRank([rung(2)]), bandRank("capable"));
  assert.equal(attackRefusal([], [rung(2)]), null);
  // Weak(1) -> Seasoned(4) is one past it.
  assert.equal(bestBandRank([rung(3)]), bandRank("seasoned"));
  assert.equal(attackRefusal([], [rung(3)]), TOO_STRONG);
});

test("the gap is what matters, not the height", () => {
  // A Seasoned fighter may attack a Lethal one: still two bands.
  assert.equal(attackRefusal([rung(3)], [rung(5)]), null);
  assert.equal(attackRefusal([rung(3)], [rung(6)]), TOO_STRONG);
});

test("punching down is never refused", () => {
  assert.equal(attackRefusal([rung(4)], []), null);
});

test("the better half of the tree answers for each side", () => {
  // A marksman with no melee at all is not a free target: their ranged band is
  // what a would-be attacker is measured against.
  const marksman = [row("ranged-expert", { tree: "ranged", rung: 4 })];
  assert.equal(bestBandRank(marksman), bandRank("dangerous"));
  assert.equal(attackRefusal([], marksman), TOO_STRONG);
  // And it works the other way: the marksman may attack a Seasoned swordsman.
  assert.equal(attackRefusal(marksman, [rung(3)]), null);
});

test("a CAPPED champion is attackable — the case bands exist for", () => {
  // Bound caps the band at Pitiful while leaving the score at Expert's 55. A
  // gate reading scores would refuse; a gate reading bands lets a peasant tie
  // into somebody who is already tied up.
  const boundExpert = [rung(4), row("bound", { tree: "both", cap: "pitiful" })];
  assert.equal(bestBandRank(boundExpert), bandRank("pitiful"));
  assert.equal(attackRefusal([], boundExpert), null);
});

test("a FLOORED champion is refused, however little they hold", () => {
  const apex = [row("apex-form", { tree: "both", floor: "legendary" })];
  assert.equal(bestBandRank(apex), bandRank("legendary"));
  assert.equal(attackRefusal([], apex), TOO_STRONG);
});

test("the tunable is a band count, and it is two", () => {
  assert.equal(MAX_BAND_GAP, 2);
});
