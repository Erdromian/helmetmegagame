// The math a medical Gambit rolls against, and the margin that decides what a
// missed one does — pure, no Prisma, so both the file-time quote
// (web/app/(app)/character/actions/medical.js) and the turn-close pass
// (db/lib/healGambitPass.js) read the same numbers, the same way
// db/lib/gambitModifier.js is shared by a confirm DM and a turn pass.
//
// A medical Gambit fires for two different reasons (TAGS.md §5c,
// isGambitHeal): the medic is reaching above the tier they hold, or the tag
// itself carries requirementGambit (tier 7, and Dying off the ladder). Both
// read as one number here — how far outmatched the attempt is — and that
// number is what a miss turns into a complication's severity.

// Tier ladder a Medical skill sits on. Ancestry (buildSkillAncestry) already
// folds Expert into "holds Skilled and Basic too", so the caller passes
// whichever slugs the medic is SATISFIED for and this reads the highest one.
const { DYING_SLUG } = require("./constants");
const { rollTotal } = require("./rollDie");

const MEDICAL_TIER = Object.freeze({
  "medical-basic": 1,
  "medical-skilled": 2,
  "medical-expert": 3,
});

function tierOf(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  let best = 0;
  for (const [slug, tier] of Object.entries(MEDICAL_TIER)) {
    if (held.has(slug) && tier > best) best = tier;
  }
  return best;
}

// The medic's own tier, off the same satisfied-skill set healCharacterRequestImpl already builds.
function medicTierOf(satisfiedSlugs) {
  return tierOf(satisfiedSlugs);
}

// What the AFFLICTION asks for — the highest Medical tier named in its own
// requirementSkills. A tag naming none (shouldn't happen for anything
// isGambitHeal ever fires on, but a gambit can also fire from
// requirementGambit alone) reads as tier 1, the same floor holding
// medical-basic already guarantees a medic clears.
function requiredTierOf(tag) {
  const slugs = (tag?.requirementSkills ?? []).map((s) => s?.slug).filter(Boolean);
  return Math.max(1, tierOf(slugs));
}

// 3 is the bare d6's own 50/50 line (a roll of 4-6 clears it with no
// modifier at all). Every tier of daylight between what the tag asks for and
// what the medic holds adds 2 — a full tier's worth of training is worth
// more than a coin flip. requirementGambit tacks on one more: it is what
// makes tier 7 harder than tier 6 even though the two share every other
// number, and it is the reason even an Expert rolls for Dying.
const BASE_THRESHOLD = 3;
const TIER_GAP_PENALTY = 2;
const REQUIREMENT_GAMBIT_PENALTY = 1;

function healThreshold(tag, medicTier) {
  const gap = Math.max(0, requiredTierOf(tag) - medicTier);
  return (
    BASE_THRESHOLD +
    TIER_GAP_PENALTY * gap +
    (tag?.requirementGambit ? REQUIREMENT_GAMBIT_PENALTY : 0)
  );
}

// The cure ladder's own rung (TAGS.md §5c), read off the same three fields
// the ladder is priced on — resources/turns/gambit — the identical arithmetic
// db/lib/mood.js#woundRungOf uses, but WITHOUT its group restriction. That
// restriction is a mood scoping choice (only health-wounds/maiming/infection
// cost fear), and three of the game's seven Gambit-flagged tags sit outside
// it entirely (blind is health-mind; phrygian-toxin, exploded-chest and
// consumptive are health-illness) — a botch still has to be able to say how
// bad it was for every one of them. Deliberately re-derived rather than
// exported from mood.js, so that module's group gate stays mood's alone; if
// the ladder's own arithmetic ever changes, change it in both places.
function severityRungOf(tag) {
  if (tag?.requirementGambit) return 7;
  // Dying no longer carries requirementGambit (an Esculap cures it outright,
  // MEDICAL.md §3a), but it is still the worst thing on a sheet — pinned at
  // rung 7 by slug rather than by price, the same way needsSurgicalSite()
  // exempts it by slug instead of by requirement shape.
  if (tag?.slug === DYING_SLUG) return 7;
  const resources = tag?.requirementResources ?? 0;
  const turns = tag?.requirementTurns ?? 0;
  if (resources >= 8) return 6;
  if (resources >= 6) return 5;
  if (resources >= 4) return 4;
  if (resources === 3) return 3.5;
  if (resources === 2) return turns === 0 || tag?.requirementPerTurn === 4 ? 2 : 3;
  if (resources === 1) return 1;
  return 0.5;
}

// The floor under a near-miss: how severe a complication has to be no
// matter how close the roll came. A whisker under the threshold on a
// gut wound still opens something real; the same whisker on a bruise can
// just be a bruise. Ladder rung -> floor, clamped into the table's 1-6 range.
function floorFor(severityRung) {
  if (severityRung >= 6) return 3;
  if (severityRung >= 5) return 2;
  return 1;
}

// `die`/`diceModifier` are what's already stamped on the Action row at file
// time (rolled once, read here — never re-rolled). `severityRung` is the
// treated tag's own ladder rung, from severityRungOf(). Returns the total,
// whether it cleared the threshold, and — when it didn't — which rung of the
// complication table (db/lib/healComplications.js) the failure lands on.
function healOutcome({ die, diceModifier = 0, threshold, severityRung }) {
  const total = rollTotal(die, diceModifier);
  const succeeded = total >= threshold;
  if (succeeded) return { total, succeeded, margin: 0, complicationRung: null };
  const margin = threshold - total;
  const complicationRung = Math.min(6, Math.max(1, Math.max(margin, floorFor(severityRung))));
  return { total, succeeded, margin, complicationRung };
}

module.exports = {
  MEDICAL_TIER,
  medicTierOf,
  requiredTierOf,
  healThreshold,
  severityRungOf,
  healOutcome,
};
