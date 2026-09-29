// Who may make a Trinket and why they can't right now (TRINKETS.md §2). One
// answer for the sheet's button (web/app/(app)/character/page.js), the bot's
// Actions menu (actionPools.js) and the request itself (trinketActions.js), so
// a greyed tooltip and a refusal never say two different things.
//
// Pure: callers read the facts (the skill set, the forge, the Move, the ⬢) and
// hand them in.
const { SMITHING_SLUG, TRINKET_RESOURCE_COST } = require("./constants");

const TRINKET_NEEDS_SMITHING = "Making a Trinket needs Smithing.";
const TRINKET_NO_FORGE =
  "Making a Trinket is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up.";

// Smithing or any tier above it. `tierRows` is any catalog read carrying id and
// slug; `satisfied` is medicalVision.js#satisfiedSkillIds' set.
function isSmith(tierRows, satisfied) {
  const id = tierRows.find((t) => t.slug === SMITHING_SLUG)?.id;
  return Boolean(id && satisfied.has(id));
}

// Why a smith can't start one right now, or null. Only ever asked about a smith:
// the button is hidden from everybody else.
function trinketRefusalFor({ hasOpenTurn, hasWorkshop, hasMoved, resources }) {
  if (!hasWorkshop) return TRINKET_NO_FORGE;
  if (!hasOpenTurn) return "No turn is open.";
  if (hasMoved) return "You've already used your Move this turn.";
  const have = resources ?? 0;
  if (have < TRINKET_RESOURCE_COST) {
    return `A Trinket costs ${TRINKET_RESOURCE_COST} ⬢, and you have ${have} ⬢.`;
  }
  return null;
}

// What a smith could set into one: every held tag carrying `inlayValue`. Names
// only — what a stone is worth to the price is the turn's surprise.
function inlayStonesOf(tags) {
  return tags
    .filter((ct) => ct.tag?.inlayValue && (ct.quantity ?? 1) > 0)
    .map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name, quantity: ct.quantity ?? 1 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  TRINKET_NEEDS_SMITHING,
  TRINKET_NO_FORGE,
  isSmith,
  trinketRefusalFor,
  inlayStonesOf,
};
