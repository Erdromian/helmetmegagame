// The 0-100 hunger meter (E:\Bascinet\V3\Soilery\Soilery Rework.docx;
// docs/systemdocs/TURN-ENGINE.md §5). A character never sees the number, only
// one of three descriptors, each a tag they hold: Full, Hungry or Starving.
// No Prisma import here, same posture as db/lib/gambitModifier.js/godflesh.js,
// so both bot/ and web/ can import this by subpath without dragging in the
// generated Prisma client.
const {
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  GLUTTON_SLUG,
  FOODSTUFFS_SLUG,
  FULL_SLUG,
  HUNGER_SLUG,
  STARVING_SLUG,
} = require("./constants");

const HUNGER_MAX = 100;
const HUNGER_MIN = 0;

// The doc's rate: 17 a day, split across however many turns the day holds,
// with the per-turn figure truncated to a whole number (so a 6-hour turn
// burns 4, not 4.25). Big Appetite (`fast-metabolism`) keeps the 1.4x it had
// under the old per-turn rate — the doc does not name it.
const HUNGER_DECAY_PER_DAY = 17;
const HUNGER_DECAY_PER_DAY_FAST = 24;

// The three bands are separate, not nested: Full is 67-100, Hungry 34-66,
// Starving 0-33. `<=` a threshold puts you in that band.
const HUNGRY_THRESHOLD = 66;
const STARVING_THRESHOLD = 33;
// Where the turn close's automatic eating of Foodstuffs stops when you are
// Starving: the first Hungry value.
const AUTO_EAT_FLOOR = STARVING_THRESHOLD + 1;
// Where it stops for anything else (a meal, a dish, a raw ingredient): one
// above the 0 that grants `dying`. That food is only eaten to stay alive.
const STAY_ALIVE_FLOOR = 1;

// One-time mood hit, charged only on the turn a character crosses DOWN into
// a band — never once per turn they simply remain in it.
const THRESHOLD_MOOD_HIT = -30;
// What eating a raw ingredient (meat, cheese, a fish) costs before the
// food's own mood term is added — see rawFoodMoodTerms below. Foodstuffs
// are not on this path: they carry their own flat -5 as `mealMood`.
const RAW_FOOD_MOOD = -10;

// The close that takes the meter to 0 grants `dying` (Bascinet's call; the doc
// says only that a Starving character "will perish" if they do not eat soon).
// Dying then runs its usual one-turn clock (db/lib/dyingDeathPass.js).
const STARVING_DEATH_TURNS = 1;

// What one Foodstuff restores, if the tag row has somehow lost its
// `mealHunger`. The catalog (docs/tags.yaml) is the real source.
const FOODSTUFF_HUNGER = 4;

// The doc's three descriptors, word for word. `tone` is the design-system
// tone a tile or row draws the word in.
const DESCRIPTORS = {
  full: {
    band: "full",
    slug: FULL_SLUG,
    word: "Full",
    line: "You aren't particularly hungry right now.",
    tone: "muted",
  },
  hungry: {
    band: "hungry",
    slug: HUNGER_SLUG,
    word: "Hungry",
    line: "You could really go for something to eat…",
    tone: "warn",
  },
  starving: {
    band: "starving",
    slug: STARVING_SLUG,
    word: "Starving",
    line: "You are starving to death! If you do not eat soon, you will perish.",
    tone: "bad",
  },
};
const DESCRIPTOR_BY_SLUG = Object.fromEntries(Object.values(DESCRIPTORS).map((d) => [d.slug, d]));

function clampHunger(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.min(HUNGER_MAX, Math.max(HUNGER_MIN, Math.round(n)));
}

function bandOf(hungerValue) {
  const v = clampHunger(hungerValue);
  if (v <= STARVING_THRESHOLD) return "starving";
  if (v <= HUNGRY_THRESHOLD) return "hungry";
  return "full";
}

// A per-day figure spread over one turn. By default a day is the calendar
// day: a turn is 6, 8, 12 or 24 hours (Turn.turnLengthHours), so 17 a day is
// 4, 5, 8 or 17 a turn, truncated because the doc says so (unlike
// db/lib/vampire.js#perTurnRate). When GameConfig.turnsPerDay is set, a day is
// that many turns instead, whatever their length, and the share rounds UP:
// 17 over 2 turns is 9 a turn (Bascinet's call).
function perTurnDecay(perDay, turnLengthHours, turnsPerDay = 0) {
  if (Number.isInteger(turnsPerDay) && turnsPerDay >= 1) return Math.ceil(perDay / turnsPerDay);
  const hours = Number.isFinite(turnLengthHours) && turnLengthHours > 0 ? turnLengthHours : 24;
  return Math.trunc((perDay * hours) / 24);
}

function asSet(slugs) {
  return slugs instanceof Set ? slugs : new Set(slugs ?? []);
}

// Accepts a Set or array of held slugs. Hungerless never decays.
function decayFor(heldSlugs, turnLengthHours, turnsPerDay = 0) {
  const held = asSet(heldSlugs);
  if (held.has(HUNGERLESS_SLUG)) return 0;
  const perDay = held.has(FAST_METABOLISM_SLUG) ? HUNGER_DECAY_PER_DAY_FAST : HUNGER_DECAY_PER_DAY;
  return perTurnDecay(perDay, turnLengthHours, turnsPerDay);
}

// before/after are raw hungerValue numbers. Reports each threshold's crossing
// independently, in EITHER direction, so a caller can charge each onset mood
// hit exactly once.
function crossings(before, after) {
  const b = clampHunger(before);
  const a = clampHunger(after);
  return {
    enteredHungry: b > HUNGRY_THRESHOLD && a <= HUNGRY_THRESHOLD,
    enteredStarving: b > STARVING_THRESHOLD && a <= STARVING_THRESHOLD,
    leftHungry: b <= HUNGRY_THRESHOLD && a > HUNGRY_THRESHOLD,
    leftStarving: b <= STARVING_THRESHOLD && a > STARVING_THRESHOLD,
  };
}

// What the character is told about their hunger: a word and the doc's line,
// never the number. Reads the descriptor tag they hold, and falls back to the
// meter only when they hold none (a sheet read before the turn pass first
// ran). The Hungerless get no descriptor at all.
function hungerDescriptorFor({ heldSlugs, hungerValue }) {
  const held = asSet(heldSlugs);
  if (held.has(HUNGERLESS_SLUG)) return null;
  for (const slug of held) {
    if (DESCRIPTOR_BY_SLUG[slug]) return DESCRIPTOR_BY_SLUG[slug];
  }
  return DESCRIPTORS[bandOf(hungerValue ?? HUNGER_MAX)];
}

// How much a single tag restores on the meter: a meal's or a Foodstuff's own
// `mealHunger` (copied onto a minted dish by db/lib/customCraftMint.js),
// failing that an ingredient's own `cooked.hunger`, failing that nothing.
function foodHungerFor(tag) {
  if (!tag) return 0;
  if (Number.isInteger(tag.mealHunger)) return tag.mealHunger;
  if (Number.isInteger(tag.cooked?.hunger)) return tag.cooked.hunger;
  return 0;
}

// One unit of a dish is its own figure plus every additional ingredient's.
function unitHungerFor(tag, ingredientTags = []) {
  return foodHungerFor(tag) + ingredientTags.reduce((sum, t) => sum + foodHungerFor(t), 0);
}

// The Consume slider's top end (the doc): what you hold, or how many you can
// eat before the meter reaches 100, whichever is lower. The last one may
// overshoot. At 100 you cannot eat food at all, unless you are a Glutton or
// Hungerless. Something that is not food is never capped by hunger.
function eatMaxFor({ hungerValue, perUnit, held, glutton = false, hungerless = false }) {
  const have = Math.max(0, Math.trunc(held ?? 0));
  if (!(perUnit > 0) || glutton || hungerless) return have;
  const room = HUNGER_MAX - clampHunger(hungerValue);
  if (room <= 0) return 0;
  return Math.min(have, Math.ceil(room / perUnit));
}

// What one unit of a food looks like to somebody deciding whether to eat it:
// the sum of what it would do to the dial, before anybody's multipliers. A
// dish sums its own mealMood and every ingredient's cooked.mood
// (db/lib/mood.js#dishMoodTerms — harm plus relief is the plain sum); a raw
// thing is the flat RAW_FOOD_MOOD plus its own cooked.mood (rawFoodMoodTerms
// below). Same dish/raw split consumeTagRequestImpl makes.
function foodMoodFor(tag, ingredientTags = []) {
  if (!tag) return 0;
  if (ingredientTags.length || tag.mealMood != null) {
    return (tag.mealMood ?? 0) + ingredientTags.reduce((sum, t) => sum + (Number.isFinite(t?.cooked?.mood) ? t.cooked.mood : 0), 0);
  }
  return RAW_FOOD_MOOD + (Number.isFinite(tag.cooked?.mood) ? tag.cooked.mood : 0);
}

// May the turn close eat this for somebody, unasked? Only plain food: it fills
// you and moves your mood, and does nothing else. Anything that grants a tag
// (Dustfish's nausea, the cult's Flesh, a stew with human meat in it), cures
// something, pays out, or needs a skill to administer stays the player's own
// decision. A dish is checked through its ingredients the way
// web/lib/cooking.js#mergeDishGrants/#mergeDishCures read them: an
// ingredient's cooked.into if it has one, else its own consumesInto.
function autoEdible(tag, ingredientTags = []) {
  if (!tag?.consumable) return false;
  if (unitHungerFor(tag, ingredientTags) <= 0) return false;
  if (tag.consumesInto?.length || tag.cures?.length || tag.administerSkill) return false;
  if (tag.consumesIntoResources || tag.consumesIntoTagPoints || tag.consumeChoice?.length) return false;
  for (const ing of ingredientTags) {
    if ((ing?.cooked?.into ?? ing?.consumesInto ?? []).length) return false;
    if (ing?.cooked?.cures && ing.cures?.length) return false;
  }
  return true;
}

// The turn close eats for somebody on its own (TURN-ENGINE.md §5a), and within
// each step it reaches for the TASTIEST thing first: the biggest mood figure,
// then whatever fills most.
//
// `foods` are what the character carries that autoEdible passed:
// { tagId, slug, name, quantity, hunger, mood } with hunger/mood per unit.
function tastiestFirst(foods) {
  return (foods ?? [])
    .filter((f) => f.quantity > 0 && f.hunger > 0)
    .sort((a, b) => b.mood - a.mood || b.hunger - a.hunger || String(a.tagId).localeCompare(String(b.tagId)));
}

// Even a starving body will not eat just anything off its own belt: a food
// worse than this is left for the player to decide on (raw Human Flesh is
// -50). Foodstuffs (-5) and Moldy Bread (-10) are well inside it.
const AUTO_EAT_MOOD_FLOOR = -20;

function isFoodstuffs(food) {
  return food.slug === FOODSTUFFS_SLUG;
}

// Starving after the decay, the close eats in two steps:
// 1. Foodstuffs, until the meter reaches the first Hungry value, or they run
//    out. Rations are what a body falls back on to keep going.
// 2. Only if the meter would still read 0, which grants `dying`: anything
//    else worth eating (a meal, a dish, a raw ingredient), tastiest first,
//    until it reads 1. A feast somebody carries for their betters is eaten
//    only to keep them alive, never merely to keep them out of Starving.
function planAutoMeals(afterDecay, foods) {
  let v = clampHunger(afterDecay);
  if (v > STARVING_THRESHOLD) return [];
  const meals = [];
  const eatUpTo = (list, floor) => {
    for (const food of list) {
      if (v >= floor) break;
      if (food.mood < AUTO_EAT_MOOD_FLOOR) continue;
      const count = Math.min(food.quantity, Math.ceil((floor - v) / food.hunger));
      meals.push({ ...food, count });
      v += count * food.hunger;
    }
  };
  const ordered = tastiestFirst(foods);
  eatUpTo(ordered.filter(isFoodstuffs), AUTO_EAT_FLOOR);
  eatUpTo(ordered.filter((f) => !isFoodstuffs(f)), STAY_ALIVE_FLOOR);
  return meals;
}

// Where a character lands once the close's decay and any automatic eating
// are known. `meals` is what was actually eaten (it may be less than planned
// if a stack moved under the lock). Shared by planHunger and
// db/lib/hungerPass.js so the two can never disagree.
function resolveHunger({ before, afterDecay, meals = [], starvingSinceTurn = null, turnNumber }) {
  const restored = meals.reduce((sum, m) => sum + m.count * m.hunger, 0);
  const eaten = meals.reduce((sum, m) => sum + m.count, 0);
  const final = clampHunger(afterDecay + restored);
  const band = bandOf(final);
  const cross = crossings(before, final);
  const zeroSince = final <= HUNGER_MIN ? starvingSinceTurn ?? turnNumber : null;
  const newlyDying = zeroSince != null && turnNumber - zeroSince >= STARVING_DEATH_TURNS - 1;

  // What the DM says about the eating: it lifted them out of Starving on
  // Foodstuffs (autoAte), it took something better to keep them alive
  // (autoAteToLive), or it was not enough either way (autoAteShort).
  const kinds = [];
  const ateBetter = meals.some((m) => m.count > 0 && !isFoodstuffs(m));
  if (eaten > 0) {
    if (final <= HUNGER_MIN) kinds.push("autoAteShort");
    else if (ateBetter) kinds.push("autoAteToLive");
    else kinds.push(final > STARVING_THRESHOLD ? "autoAte" : "autoAteShort");
  }
  if (cross.enteredStarving || newlyDying) kinds.push("starving");
  else if (cross.enteredHungry) kinds.push("hungry");
  const ate = meals.filter((m) => m.count > 0).map((m) => ({ slug: m.slug, name: m.name, count: m.count }));
  const notice = kinds.length ? { kinds, ate, justDied: newlyDying } : null;

  return { final, band, cross, zeroSince, newlyDying, notice, eaten };
}

// The whole close for one character, with no database: the decay, what they
// would eat (Foodstuffs to stay out of Starving, anything else only to stay
// alive), and where that leaves them.
function planHunger(
  { hungerValue, starvingSinceTurn = null, heldSlugs, foods = [] },
  { turnLengthHours, turnsPerDay = 0, turnNumber },
) {
  const held = asSet(heldSlugs);
  if (held.has(HUNGERLESS_SLUG)) {
    return { hungerless: true, decay: 0, afterDecay: HUNGER_MAX, meals: [], eaten: 0, final: HUNGER_MAX, band: null, zeroSince: null, newlyDying: false, notice: null };
  }
  const before = clampHunger(hungerValue);
  const decay = decayFor(held, turnLengthHours, turnsPerDay);
  const afterDecay = clampHunger(before - decay);
  const meals = planAutoMeals(afterDecay, foods);
  return {
    hungerless: false,
    decay,
    afterDecay,
    meals,
    ...resolveHunger({ before, afterDecay, meals, starvingSinceTurn, turnNumber }),
  };
}

// What eating something RAW costs/earns as mood terms, mirroring
// db/lib/mood.js#dishMoodTerms's returned-terms shape so applyMoodTerms
// handles either the same way. Raw food always carries the flat RAW_FOOD
// penalty (noMultiplier — revulsion at eating something uncooked isn't a
// fright, so no tag scales it); on top of that, the food's own `cooked.mood`
// lands as a MEAL term if positive or a DISGUST term if negative.
function rawFoodMoodTerms(cookedMood) {
  const mood = Number.isFinite(cookedMood) ? cookedMood : 0;
  const terms = [{ kind: "RAW_FOOD", base: RAW_FOOD_MOOD, noMultiplier: true }];
  if (mood > 0) terms.push({ kind: "MEAL", base: mood });
  else if (mood < 0) terms.push({ kind: "DISGUST", base: mood, noMultiplier: true });
  return terms;
}

// "your Lavish Meal", "3 Foodstuffs", "your Cheese and 2 Foodstuffs". A count
// is a digit; one of a thing is "your" thing, except a Foodstuff, whose name
// is already plural.
function ateWord({ slug, name, count }) {
  if (slug === FOODSTUFFS_SLUG) return count === 1 ? "1 Foodstuff" : `${count} Foodstuffs`;
  return count === 1 ? `your ${name}` : `${count} of your ${name}`;
}

function ateList(ate = []) {
  const words = ate.map(ateWord);
  if (words.length <= 1) return words[0] ?? "something";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// The DM a close sends. No line names a number of hunger points. A notice
// from the pass carries `kinds` (several lines in one DM); the GM's Feed
// Them button still sends the older one-kind shape.
function hungerDm(notice) {
  const kinds = notice?.kinds ?? (notice?.kind ? [notice.kind] : []);
  const lines = [];
  for (const kind of kinds) {
    if (kind === "autoAte") {
      lines.push(`You were about to starve, so you ate ${ateList(notice.ate)} from your pack.`);
    } else if (kind === "autoAteShort") {
      lines.push(`You were starving, so you ate ${ateList(notice.ate)}. It wasn't enough.`);
    } else if (kind === "autoAteToLive") {
      lines.push(`You were starving to death, so you ate ${ateList(notice.ate)} to stay alive.`);
    } else if (kind === "hungry") {
      lines.push(`You're **Hungry**. ${DESCRIPTORS.hungry.line}`);
    } else if (kind === "starving") {
      lines.push(`You're **Starving**. ${DESCRIPTORS.starving.line}`);
    } else if (kind === "recovered") {
      lines.push("You've eaten enough. The gnawing has stopped.");
    }
  }
  return lines.length ? lines.join("\n") : null;
}

// Sent alongside a "starving" notice the turn `dying` first lands
// (notice.justDied) — db/lib/turnSideEffects/steps/hunger.js.
const DYING_DM =
  "You have not eaten in days. Your body is giving out — you're **Dying**. A GM will decide what happens next.";

module.exports = {
  HUNGER_MAX,
  HUNGER_MIN,
  HUNGER_DECAY_PER_DAY,
  HUNGER_DECAY_PER_DAY_FAST,
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  AUTO_EAT_FLOOR,
  STAY_ALIVE_FLOOR,
  THRESHOLD_MOOD_HIT,
  RAW_FOOD_MOOD,
  STARVING_DEATH_TURNS,
  FOODSTUFF_HUNGER,
  DESCRIPTORS,
  clampHunger,
  bandOf,
  perTurnDecay,
  decayFor,
  crossings,
  hungerDescriptorFor,
  foodHungerFor,
  unitHungerFor,
  eatMaxFor,
  foodMoodFor,
  autoEdible,
  tastiestFirst,
  AUTO_EAT_MOOD_FLOOR,
  planAutoMeals,
  resolveHunger,
  planHunger,
  rawFoodMoodTerms,
  hungerDm,
  DYING_DM,
};
