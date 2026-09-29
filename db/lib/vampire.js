// The Vampire's two 0-100 meters (docs/systemdocs/VAMPIRE.md, the design
// doc's pages 1-3 — the Blood Abilities menu on pages 4-5 is a separate,
// out-of-scope task). No Prisma import here, same posture as db/lib/
// hunger.js/gambitModifier.js, so both bot/ and web/ can import this by
// subpath without dragging in the generated Prisma client.
const {
  VAMPIRE_SLUG,
  FLUSH_SLUG,
  SATIATED_SLUG,
  THIRSTY_SLUG,
  FAMISHED_SLUG,
  BLOODCRAZED_SLUG,
} = require("./secretSlugs");

const { turnsInGameDay } = require("./turnClock");

const BLOOD_MAX = 100;
const BLOOD_MIN = 0;
const HUMANITY_MAX = 100;
const HUMANITY_MIN = 0;

function clampBlood(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.min(BLOOD_MAX, Math.max(BLOOD_MIN, Math.round(n)));
}

function clampHumanity(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.min(HUMANITY_MAX, Math.max(HUMANITY_MIN, Math.round(n)));
}

// A per-IN-GAME-DAY config rate, split evenly over the turns that day holds
// (turnClock.js#turnsInGameDay): GameConfig.turnsPerDay when a GM has set it,
// else the turn length's share of 24 hours. So 34 a day is 34 a turn on a
// 24-hour game, 9 on a 6-hour one, and 17 on 24-hour turns run two to a day.
// Always pass the length of the turn being CLOSED (turn.turnLengthHours),
// never live GameConfig's — the same discipline db/lib/turnClock.js uses,
// since a GM's turn-length change must take effect at the next turn, not
// retroactively resize the one already running.
function perTurnRate(perDayRate, turnLengthHours, turnsPerDay = 0) {
  const rate = Number.isFinite(perDayRate) ? perDayRate : 0;
  const hours = Number.isFinite(turnLengthHours) && turnLengthHours > 0 ? turnLengthHours : 24;
  return Math.round(rate / turnsInGameDay({ turnsPerDay, turnLengthHours: hours }));
}

// Blood urgency — hidden, mutually exclusive, always returns exactly one.
// The design doc's printed ranges (100 / 100-67 / 66-34 / 33-1 / 0) overlap
// at their shared edges; treated here as non-overlapping steps with Flush
// the exact top value and Satiated taking the rest of that top band.
function bloodUrgencyBand(bloodLevel) {
  const v = clampBlood(bloodLevel);
  if (v <= 0) return "bloodcrazed";
  if (v <= 33) return "famished";
  if (v <= 66) return "thirsty";
  if (v < BLOOD_MAX) return "satiated";
  return "flush";
}

// Appearance — visible, additive. Independent of the urgency band: both may
// be held at once (e.g. Famished + Pale + Black Sclera all at blood 20).
function isPale(bloodLevel) {
  return clampBlood(bloodLevel) <= 66;
}

function hasBlackSclera(bloodLevel) {
  return clampBlood(bloodLevel) <= 33;
}

// Humanity — hidden, mutually exclusive over 1-100. Returns null at 0: that
// is Bestial/Wight territory, a permanent state handled separately rather
// than a fifth band in this track.
function humanityBand(humanity) {
  const v = clampHumanity(humanity);
  if (v <= 0) return null;
  if (v <= 25) return "warped";
  if (v <= 50) return "disturbed";
  if (v <= 75) return "estranged";
  return "humane";
}

// The one coded humanity loss (docs/systemdocs/VAMPIRE.md §5) — automatic,
// and only on the turn a character crosses INTO Bloodcrazed, never for
// simply remaining there. The four kill-reason losses are GM guidance, not
// code; they are documented, not exported here.
const HUMANITY_LOSS_BLOODCRAZED = 60;

// The design doc's own flavor lines, one per band onset. No line names a
// number, matching db/lib/hunger.js#hungerDm's rule.
function vampireDm(notice) {
  switch (notice?.kind) {
    case "flush":
      return "The blood of a mortal courses through your veins, rejuvenating you.";
    case "satiated":
      return "Your thirst for human blood is satisfied.";
    case "thirsty":
      return "Your appetite for blood is growing, it would be wise to find a victim soon...";
    case "famished":
      return "You can barely contain your insatiable urge for blood! If you do not find a victim soon, you will lose all control.";
    case "bloodcrazed":
      return "You have lost all control of yourself and will prey upon the first person you see!";
    case "humane":
      return "Your connection to the mortal world around you is secure, for now.";
    case "estranged":
      return "You feel markedly detached from the rest of the world.";
    case "disturbed":
      return "You have lost any sense of remorse for the horrible things you've done.";
    case "warped":
      return "You find yourself at odds with the mortal world, and the those who inhabit it.";
    case "bestial":
      return "No more a human, your inner nature has broken free and can be subdued no longer!";
    default:
      return null;
  }
}

// What a vampire is told about their blood where everybody else is told about
// their hunger (the sheet's tile, the /chat You plate): the urgency band's
// word and its onset line, never the number. Same shape as
// db/lib/hunger.js#DESCRIPTORS, and `tone` is the same design-system tone.
const BLOOD_DESCRIPTORS = Object.fromEntries(
  [
    [FLUSH_SLUG, "flush", "Flush", "good"],
    [SATIATED_SLUG, "satiated", "Satiated", "muted"],
    [THIRSTY_SLUG, "thirsty", "Thirsty", "warn"],
    [FAMISHED_SLUG, "famished", "Famished", "bad"],
    [BLOODCRAZED_SLUG, "bloodcrazed", "Bloodcrazed", "bad"],
  ].map(([slug, band, word, tone]) => [band, { band, slug, word, line: vampireDm({ kind: band }), tone }]),
);
const BLOOD_DESCRIPTOR_BY_SLUG = Object.fromEntries(Object.values(BLOOD_DESCRIPTORS).map((d) => [d.slug, d]));

// Mirrors db/lib/hunger.js#hungerDescriptorFor: the urgency tag they hold
// wins, and the blood level is the fallback when they hold none (a sheet read
// before the turn pass first ran, or between a tag's expiry and its regrant).
// Null for anybody who is not a vampire — they get the hunger descriptor.
function bloodDescriptorFor({ heldSlugs, bloodLevel }) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (!held.has(VAMPIRE_SLUG)) return null;
  for (const slug of held) {
    if (BLOOD_DESCRIPTOR_BY_SLUG[slug]) return BLOOD_DESCRIPTOR_BY_SLUG[slug];
  }
  return BLOOD_DESCRIPTORS[bloodUrgencyBand(bloodLevel ?? BLOOD_MAX)];
}

module.exports = {
  BLOOD_MAX,
  BLOOD_MIN,
  HUMANITY_MAX,
  HUMANITY_MIN,
  clampBlood,
  clampHumanity,
  perTurnRate,
  bloodUrgencyBand,
  isPale,
  hasBlackSclera,
  humanityBand,
  HUMANITY_LOSS_BLOODCRAZED,
  vampireDm,
  BLOOD_DESCRIPTORS,
  bloodDescriptorFor,
};
