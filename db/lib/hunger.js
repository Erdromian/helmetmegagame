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
// Where the turn close's automatic eating stops: the first Hungry value.
const AUTO_EAT_FLOOR = STARVING_THRESHOLD + 1;

// One-time mood hit, charged only on the turn a character crosses DOWN into
// a band — never once per turn they simply remain in it.
const THRESHOLD_MOOD_HIT = -30;
// What eating a raw ingredient (meat, cheese, a fish) costs before the
// food's own mood term is added — see rawFoodMoodTerms below. Foodstuffs
// are not on this path: they carry their own flat -5 as `mealMood`.
const RAW_FOOD_MOOD = -10;

// Three consecutive closes at 0 grants `dying`. The doc says only that a
// Starving character "will perish" if they do not eat soon.
const STARVING_DEATH_TURNS = 3;

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

// A per-day figure spread over one turn, truncated. A turn is 6, 8, 12 or 24
// hours (Turn.turnLengthHours), so 17 a day is 4, 5, 8 or 17 a turn. Unlike
// db/lib/vampire.js#perTurnRate this truncates, because the doc says so.
function perTurnDecay(perDay, turnLengthHours) {
  const hours = Number.isFinite(turnLengthHours) && turnLengthHours > 0 ? turnLengthHours : 24;
  return Math.trunc((perDay * hours) / 24);
}

function asSet(slugs) {
  return slugs instanceof Set ? slugs : new Set(slugs ?? []);
}

// Accepts a Set or array of held slugs. Hungerless never decays.
function decayFor(heldSlugs, turnLengthHours) {
  const held = asSet(heldSlugs);
  if (held.has(HUNGERLESS_SLUG)) return 0;
  const perDay = held.has(FAST_METABOLISM_SLUG) ? HUNGER_DECAY_PER_DAY_FAST : HUNGER_DECAY_PER_DAY;
  return perTurnDecay(perDay, turnLengthHours);
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

// How many Foodstuffs a character eats at the turn close to stay out of
// Starving: enough to reach the first Hungry value, or all they have.
function planAutoEat(afterDecay, held, perUnit) {
  const v = clampHunger(afterDecay);
  if (v > STARVING_THRESHOLD || !(held > 0) || !(perUnit > 0)) return 0;
  return Math.min(held, Math.ceil((AUTO_EAT_FLOOR - v) / perUnit));
}

// Where a character lands once the close's decay and any automatic eating
// are known. `eaten` is what was actually eaten (it may be fewer than
// planned if the stack moved under the lock). Shared by planHunger and
// db/lib/hungerPass.js so the two can never disagree.
function resolveHunger({ before, afterDecay, eaten = 0, perUnit = FOODSTUFF_HUNGER, starvingSinceTurn = null, turnNumber }) {
  const final = clampHunger(afterDecay + eaten * perUnit);
  const band = bandOf(final);
  const cross = crossings(before, final);
  const zeroSince = final <= HUNGER_MIN ? starvingSinceTurn ?? turnNumber : null;
  const newlyDying = zeroSince != null && turnNumber - zeroSince >= STARVING_DEATH_TURNS - 1;

  const kinds = [];
  if (eaten > 0) kinds.push(final > STARVING_THRESHOLD ? "autoAte" : "autoAteShort");
  if (cross.enteredStarving || newlyDying) kinds.push("starving");
  else if (cross.enteredHungry) kinds.push("hungry");
  const notice = kinds.length ? { kinds, eaten, justDied: newlyDying } : null;

  return { final, band, cross, zeroSince, newlyDying, notice };
}

// The whole close for one character, with no database: the decay, what they
// would eat to stay out of Starving, and where that leaves them.
function planHunger(
  { hungerValue, starvingSinceTurn = null, heldSlugs, foodstuffsHeld = 0 },
  { turnLengthHours, turnNumber, perUnit = FOODSTUFF_HUNGER },
) {
  const held = asSet(heldSlugs);
  if (held.has(HUNGERLESS_SLUG)) {
    return { hungerless: true, decay: 0, afterDecay: HUNGER_MAX, eat: 0, final: HUNGER_MAX, band: null, zeroSince: null, newlyDying: false, notice: null };
  }
  const before = clampHunger(hungerValue);
  const decay = decayFor(held, turnLengthHours);
  const afterDecay = clampHunger(before - decay);
  const eat = planAutoEat(afterDecay, foodstuffsHeld, perUnit);
  return {
    hungerless: false,
    decay,
    afterDecay,
    eat,
    ...resolveHunger({ before, afterDecay, eaten: eat, perUnit, starvingSinceTurn, turnNumber }),
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

function foodstuffWord(n) {
  return n === 1 ? "1 Foodstuff" : `${n} Foodstuffs`;
}

// The DM a close sends. No line names a number of hunger points. A notice
// from the pass carries `kinds` (several lines in one DM); the GM's Feed
// Them button still sends the older one-kind shape.
function hungerDm(notice) {
  const kinds = notice?.kinds ?? (notice?.kind ? [notice.kind] : []);
  const lines = [];
  for (const kind of kinds) {
    if (kind === "autoAte") {
      lines.push(`You were about to starve, so you ate ${foodstuffWord(notice.eaten)} from your pack.`);
    } else if (kind === "autoAteShort") {
      lines.push(
        notice.eaten === 1
          ? "You were starving, so you ate your last Foodstuff. It wasn't enough."
          : `You were starving, so you ate your last ${foodstuffWord(notice.eaten)}. It wasn't enough.`,
      );
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
  planAutoEat,
  resolveHunger,
  planHunger,
  rawFoodMoodTerms,
  hungerDm,
  DYING_DM,
};
