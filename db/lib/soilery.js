// The Farms placeholder (db/lib/locationAttributes.js's `soilery` attribute):
// sow a plan of crops, then reap what didn't wither. Deliberately small —
// the whole Farms Location is expected to be redesigned later, and this is
// only a stand-in until then. Pure and Prisma-free, modelled on
// db/lib/godflesh.js. See docs/systemdocs/SOILERY.md.

const { SOILERY_SLUG, EXHAUSTED_SLUG } = require("./constants");

const FARM_MAX_CROPS = 50;
// 1-in-6 fails, independently PER UNIT sown — not a rounded average. See reap() below for why.
const WITHER_IN = 6;
// Fertilizer's addendum: nothing withers, and 1-in-6 comes up double instead
// — same die, same independence, opposite outcome table. See reap() below.
const BOUNTY_IN = 6;
// One plant is a plant, not a single grain: a surviving unit brings in this
// many of its crop. The sow cap counts PLANTS, so 50 sown is 125 crops after
// the wither die, which is what lets three farmers feed the town.
const CROPS_PER_PLANT = 3;

// `cropsPerPlant` and `witherIn` are per-crop overrides on the two constants
// above — tobacco is the only crop that takes them so far, yielding less and
// failing more because it is the one worth money.
const CROPS = [
  { sowing: "sowing-wheat", crop: "wheat" },
  { sowing: "sowing-potato", crop: "potato" },
  { sowing: "sowing-tomato", crop: "tomato" },
  { sowing: "sowing-carrot", crop: "carrot" },
  { sowing: "sowing-onion", crop: "onion" },
  { sowing: "sowing-plump-helmet", crop: "plump-helmet" },
  { sowing: "sowing-pigtails", crop: "pigtails" },
  { sowing: "sowing-tobacco", crop: "tobacco", cropsPerPlant: 2, witherIn: 3 },
];

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — same contract as
// db/lib/gambitModifier.js#holds.
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

// Which crops this character currently holds the sowing ticket for.
function sowableCrops(characterTags = []) {
  return CROPS.filter((entry) => holds(characterTags, entry.sowing));
}

// `plan` is what a player submits: [{ crop, planted }, ...]. Never throws —
// always answers { ok: false, error } or { ok: true }, since this is meant
// to gate a form submission, not crash a request handler.
function validatePlan(plan, licensed, maxCrops = FARM_MAX_CROPS) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, error: "Nothing to sow." };
  }

  const licensedCrops = new Set((licensed ?? []).map((entry) => entry.crop));
  let total = 0;

  for (const row of plan) {
    const crop = row?.crop;
    const planted = row?.planted;

    if (!licensedCrops.has(crop)) {
      return { ok: false, error: `You don't hold a sowing ticket for "${crop}".` };
    }
    if (!Number.isInteger(planted) || planted <= 0) {
      return { ok: false, error: `"${crop}" must be a positive number of plants.` };
    }
    total += planted;
  }

  if (total === 0) {
    return { ok: false, error: "Nothing to sow." };
  }
  if (total > maxCrops) {
    return { ok: false, error: `A farm holds at most ${maxCrops} plants at once.` };
  }

  return { ok: true };
}

// Rolls `planted` INDEPENDENT 1-in-WITHER_IN chances rather than
// Math.round(planted * (WITHER_IN - 1) / WITHER_IN) — the plan calls for
// real per-unit variance (a small planting can wholly fail or wholly
// survive), which a rounded average can never produce and which later tests
// are expected to check for.
//
// `fertilized` swaps the whole outcome table (SOILERY.md's Addendum): no
// wither roll at all, replaced by an independent 1-in-BOUNTY_IN chance of
// a DOUBLE yield instead of a single one, per planted unit. Same die shape,
// opposite direction — never both rolled for the same unit. Fertilizer is
// therefore worth more on a crop with a steeper wither die, since it is a
// bigger risk being cancelled.
//
// `cropsPerPlant` and `witherIn` default to the constants above; pass a
// crop's own numbers, or use reapFor() below to look them up by slug.
function reap(planted, rng = Math.random, {
  fertilized = false,
  cropsPerPlant = CROPS_PER_PLANT,
  witherIn = WITHER_IN,
} = {}) {
  let harvested = 0;
  for (let i = 0; i < planted; i++) {
    if (fertilized) {
      harvested += (Math.floor(rng() * BOUNTY_IN) === 0 ? 2 : 1) * cropsPerPlant;
    } else if (Math.floor(rng() * witherIn) !== 0) {
      harvested += cropsPerPlant;
    }
  }
  return harvested;
}

// reap() for a named crop, so a caller never has to know the CROPS table.
// An unknown slug reaps on the ordinary numbers rather than throwing — a
// harvest is being resolved at turn-push, and refusing there would lose the
// whole action over a renamed tag.
function reapFor(cropSlug, planted, rng = Math.random, { fertilized = false } = {}) {
  const entry = CROPS.find((c) => c.crop === cropSlug);
  return reap(planted, rng, {
    fertilized,
    cropsPerPlant: entry?.cropsPerPlant ?? CROPS_PER_PLANT,
    witherIn: entry?.witherIn ?? WITHER_IN,
  });
}

// "sowed 30 Wheat and reaped 75, sowed 20 Potato and reaped 50"
function harvestLine(rows) {
  return (rows ?? [])
    .map((row) => `sowed ${row.planted} ${row.cropName} and reaped ${row.reaped}`)
    .join(", ");
}

// The turn-close DM text for a farm's harvest — harvestLine does the counting, this says it in scene.
// `fertilized` adds a line so a player who spent on Fertilizer is told it did something.
function farmDm(turn, rows, fertilized = false) {
  const line = harvestLine(rows);
  const fertilizedLine = fertilized ? "\nThe fields were richly fed — nothing withered, and some came up double." : "";
  return `*The Farms brought in their harvest, turn ${turn}.*\n**Harvest:** ${line}${fertilizedLine}`;
}

// Null means "go ahead"; a string is the refusal to show the player.
// Checked in order: must hold Soilery, must NOT be worn
// out (checks BOTH Exhausted and Tired — the two-stage fatigue ladder in
// db/lib/fatigue.js, so either rung locks the farm out, not just the
// deeper one), and must not already have an action open this turn.
function farmRefusalFor(characterTags, hasOpenAction) {
  if (!holds(characterTags, SOILERY_SLUG)) {
    return "You don't know how to farm.";
  }
  // Only Exhausted refuses, the same gate the Factory floor and the seam use
  // (db/lib/refinery.js#refineFatigueRefusal, db/lib/mining.js#computeMiningAccess).
  // One day at the plough makes you Tired and a second wears you out, so pushing
  // a day is the player's call rather than the game's.
  if (holds(characterTags, EXHAUSTED_SLUG)) {
    return "You're too worn out to farm right now.";
  }
  if (hasOpenAction) {
    return "You already have an action this turn.";
  }
  return null;
}

module.exports = {
  FARM_MAX_CROPS,
  WITHER_IN,
  BOUNTY_IN,
  CROPS_PER_PLANT,
  CROPS,
  sowableCrops,
  validatePlan,
  reap,
  reapFor,
  harvestLine,
  farmDm,
  farmRefusalFor,
};
