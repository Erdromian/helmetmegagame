// The Farm button (E:\Bascinet\V3\Soilery\Soilery Rework.docx): a farmer
// plants 100 crops, each with a 1-in-6 chance of withering, and every one
// that survives brings in 1 Foodstuff when the turn is pushed. The farmer is
// left Recently Farmed for 2 turns, which refuses the next farm — so a farmer
// farms one turn in three — and takes a step up the ordinary Tired ladder.
// Pure and Prisma-free, modelled on db/lib/godflesh.js. See
// docs/systemdocs/SOILERY.md.

const { SOILERY_SLUG, EXHAUSTED_SLUG, RECENTLY_FARMED_SLUG } = require("./constants");

// How many crops one Farm plants. GameConfig.farmMaxCrops is the live knob
// (/gm/dev, "Plants per farm"); this is the fallback when it is unset.
const FARM_PLANTS = 100;
// 1-in-6 fails, independently PER CROP planted — not a rounded average, so a
// harvest has real variance. See reapFoodstuffs() below.
const WITHER_IN = 6;
// Fertilizer (the old Soilery doc's Addendum): nothing withers, and 1-in-6
// comes up double instead — same die, same independence, opposite table.
const BOUNTY_IN = 6;

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — same contract as
// db/lib/gambitModifier.js#holds.
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

// How many Foodstuffs `planted` crops bring in. Every crop rolls its own die.
function reapFoodstuffs(planted, rng = Math.random, { fertilized = false } = {}) {
  let reaped = 0;
  for (let i = 0; i < planted; i++) {
    if (fertilized) reaped += Math.floor(rng() * BOUNTY_IN) === 0 ? 2 : 1;
    else if (Math.floor(rng() * WITHER_IN) !== 0) reaped += 1;
  }
  return reaped;
}

function foodstuffCount(n) {
  return n === 1 ? "1 Foodstuff" : `${n} Foodstuffs`;
}

// The turn-close DM for a harvest.
function farmDm(turn, { planted, reaped, fertilized = false } = {}) {
  const fertilizedLine = fertilized ? "\nThe fields were richly fed — nothing withered, and some came up double." : "";
  return `*The Farms brought in their harvest, turn ${turn}.*\n**Harvest:** planted ${planted} crops and reaped ${foodstuffCount(reaped)}.${fertilizedLine}`;
}

// Null means "go ahead"; a string is the refusal to show the player.
// Checked in order: must hold Soilery, must not be Recently Farmed, must not
// be Exhausted, and must not already have an action open this turn. Tired
// alone does not stop a farmer.
function farmRefusalFor(characterTags, hasOpenAction) {
  if (!holds(characterTags, SOILERY_SLUG)) {
    return "You don't know how to farm.";
  }
  if (holds(characterTags, RECENTLY_FARMED_SLUG)) {
    return "The fields need some time to recover before you can plant there again.";
  }
  if (holds(characterTags, EXHAUSTED_SLUG)) {
    return "You're too worn out to farm right now.";
  }
  if (hasOpenAction) {
    return "You already have an action this turn.";
  }
  return null;
}

module.exports = {
  FARM_PLANTS,
  WITHER_IN,
  BOUNTY_IN,
  reapFoodstuffs,
  farmDm,
  farmRefusalFor,
};
