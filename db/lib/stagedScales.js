// Staged scales (docs/systemdocs/ADJUDICATION.md §1b): a GM setting or moving
// one of a character's hidden meters — hunger, mood, a Vampire's blood and
// humanity — from the adjudication desk, landing at the turn push like every
// other staged row.
//
// This is the pure half: the registry of scales, the validator the desk's
// server actions and the push both run, and the wording the tray and the
// Oracle print. No Prisma and nothing that requires it, so the composer (a
// client component) reads the same limits the server enforces. The half that
// writes is db/lib/stagedScalesApply.js.
//
// A payload's `scales` is { [key]: { op: "set" | "add", value } }, one entry
// per scale it touches. `set` puts the meter at that number; `add` moves it by
// that much. Either way the result is clamped to the meter's own range.
const { HUNGERLESS_SLUG, IMPERTURBABLE_SLUG, CHANGA_HIGH_SLUG } = require("./constants");
const { VAMPIRE_SLUG } = require("./secretSlugs");
const { clampHunger, bandOf: hungerBandOf, DESCRIPTORS, HUNGER_MIN, HUNGER_MAX } = require("./hunger");
const { clampMood, bandOf: moodBandOf, MOOD_MIN, MOOD_MAX } = require("./mood");
const {
  clampBlood,
  clampHumanity,
  bloodUrgencyBand,
  humanityBand,
  BLOOD_MIN,
  BLOOD_MAX,
  HUMANITY_MIN,
  HUMANITY_MAX,
} = require("./vampire");

const capitalise = (word) => (word ? word[0].toUpperCase() + word.slice(1) : word);

// Order is the order the composer draws them in and the push applies them in.
// Hunger comes before mood on purpose: dropping into Hungry or Starving costs
// mood (db/lib/hunger.js), and a GM's own mood figure is applied after that,
// so a Set on mood is always the number they end on.
//
// `band` names the word the meter reads as at a value, for the GM only — a
// player never sees these numbers, just the tag or word they drive.
// `vampire` marks a meter that means nothing off a Vampire's seat.
const SCALES = Object.freeze([
  Object.freeze({
    key: "hunger",
    label: "Hunger",
    column: "hungerValue",
    min: HUNGER_MIN,
    max: HUNGER_MAX,
    vampire: false,
    clamp: clampHunger,
    band: (v) => DESCRIPTORS[hungerBandOf(v)].word,
  }),
  Object.freeze({
    key: "mood",
    label: "Mood",
    column: "mood",
    min: MOOD_MIN,
    max: MOOD_MAX,
    vampire: false,
    clamp: clampMood,
    band: (v) => moodBandOf(v)?.label ?? null,
  }),
  Object.freeze({
    key: "blood",
    label: "Blood",
    column: "vampireBloodLevel",
    min: BLOOD_MIN,
    max: BLOOD_MAX,
    vampire: true,
    clamp: clampBlood,
    band: (v) => capitalise(bloodUrgencyBand(v)),
  }),
  Object.freeze({
    key: "humanity",
    label: "Humanity",
    column: "vampireHumanity",
    min: HUMANITY_MIN,
    max: HUMANITY_MAX,
    vampire: true,
    clamp: clampHumanity,
    // 0 is no band at all: it is where Bestial begins (VAMPIRE.md §3).
    band: (v) => capitalise(humanityBand(v)) ?? "Bestial",
  }),
]);

const SCALE_BY_KEY = new Map(SCALES.map((s) => [s.key, s]));
const SCALE_OPS = Object.freeze(["set", "add"]);

// Checks and tidies a posted `scales` object. Returns { scales } — an object
// holding only the scales that actually change something, possibly empty — or
// { error } with the first sentence a GM should read. Whole numbers only: the
// meters a player's sheet reads are whole, and mood's fractions come from
// GameConfig.moodIntensity dividing, never from a person typing one.
function normalizeStagedScales(raw) {
  if (raw == null) return { scales: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "That isn't a set of scale changes." };
  const scales = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (entry == null) continue;
    const scale = SCALE_BY_KEY.get(key);
    if (!scale) return { error: `There is no "${key}" scale.` };
    const op = entry.op;
    if (!SCALE_OPS.includes(op)) return { error: `${scale.label}: pick Set to or Change by.` };
    if (entry.value === "" || entry.value == null) {
      // A Set left blank is a mistake worth saying; a blank Change is "no change".
      if (op === "set") return { error: `${scale.label}: say what to set it to.` };
      continue;
    }
    const value = Number(entry.value);
    if (!Number.isInteger(value)) return { error: `${scale.label} takes a whole number.` };
    if (op === "set" && (value < scale.min || value > scale.max)) {
      return { error: `${scale.label} runs from ${formatScaleNumber(scale.min)} to ${formatScaleNumber(scale.max)}.` };
    }
    const span = scale.max - scale.min;
    if (op === "add" && Math.abs(value) > span) {
      return { error: `${scale.label} only spans ${span}, so a change of ${value} can't mean anything.` };
    }
    if (op === "add" && value === 0) continue;
    scales[key] = { op, value };
  }
  return { scales };
}

function hasScales(scales) {
  return Boolean(scales) && Object.keys(scales).length > 0;
}

// Where one change leaves one meter, clamped to its range.
function resolveScale(key, before, change) {
  const scale = SCALE_BY_KEY.get(key);
  if (!scale || !change) return before;
  const raw = change.op === "set" ? change.value : Number(before ?? 0) + change.value;
  return scale.clamp(raw);
}

// A meter's number as the desk prints it: whole, with a real minus sign (the
// repo's "−", not a hyphen). Mood is stored to two places; nobody needs them.
function formatScaleNumber(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return "?";
  return v < 0 ? `−${Math.abs(v)}` : String(v);
}

function signed(n) {
  return n > 0 ? `+${formatScaleNumber(n)}` : formatScaleNumber(n);
}

// "Hunger → 40 (Hungry)" or "Mood −20": what a staged row will do, for the
// tray, the push preview and a confirm dialog. The GM's own vocabulary, so
// numbers are fine here.
function describeScaleChange(key, change) {
  const scale = SCALE_BY_KEY.get(key);
  if (!scale || !change) return null;
  if (change.op === "set") {
    const band = scale.band(change.value);
    return `${scale.label} → ${formatScaleNumber(change.value)}${band ? ` (${band})` : ""}`;
  }
  return `${scale.label} ${signed(change.value)}`;
}

function describeScales(scales) {
  return SCALES.filter((s) => scales?.[s.key])
    .map((s) => describeScaleChange(s.key, scales[s.key]))
    .filter(Boolean);
}

// Why an applied row left a scale where it was (db/lib/stagedScalesApply.js).
const SKIP_REASONS = Object.freeze({
  notAlive: "not alive",
  hungerless: "Hungerless",
  imperturbable: "Imperturbable",
  changa: "high on Changa",
  notVampire: "not a Vampire",
});

// The tags that decide whether a scale can move at all.
const SCALE_GATE_SLUGS = Object.freeze([HUNGERLESS_SLUG, IMPERTURBABLE_SLUG, CHANGA_HIGH_SLUG, VAMPIRE_SLUG]);

// Why this character's meter can't take a change, or null when it can. Read
// by the desk when staging (it refuses a scale nobody picked can take) and by
// the push (it skips the ones who can't, and says why). `heldSlugs` is a Set
// or an array of the slugs they hold.
//   - Hunger: a Hungerless meter never moves; the hunger pass refills it.
//   - Mood: Imperturbable pins the dial at Fine and Changa pins it at the
//     top (db/lib/mood.js#applyMoodTerms), so the nightly pass would undo it.
//   - Blood and humanity mean nothing off a Vampire's seat.
function scaleBlockFor(key, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (key === "hunger" && held.has(HUNGERLESS_SLUG)) return SKIP_REASONS.hungerless;
  if (key === "mood" && held.has(IMPERTURBABLE_SLUG)) return SKIP_REASONS.imperturbable;
  if (key === "mood" && held.has(CHANGA_HIGH_SLUG)) return SKIP_REASONS.changa;
  if (SCALE_BY_KEY.get(key)?.vampire && !held.has(VAMPIRE_SLUG)) return SKIP_REASONS.notVampire;
  return null;
}

// What an applied row actually did, from its `appliedEffect.scales` snapshot:
// "Hunger 80 → 40", "Humanity 90 → 30 (−60 Bloodcrazed)", "Blood skipped — not
// a Vampire". One line per scale, same order as the registry.
function describeAppliedScales(applied) {
  const lines = [];
  for (const scale of SCALES) {
    const entry = applied?.[scale.key];
    if (!entry) continue;
    if (entry.skipped) {
      lines.push(`${scale.label} skipped — ${entry.skipped}`);
      continue;
    }
    const extras = [];
    if (entry.bloodcrazedLoss) extras.push(`−${entry.bloodcrazedLoss} Bloodcrazed`);
    if (entry.onset) extras.push(`${signed(entry.onset)} hunger onset`);
    if (entry.bestial) extras.push("Bestial");
    const moved = `${formatScaleNumber(entry.from)} → ${formatScaleNumber(entry.to)}`;
    lines.push(`${scale.label} ${moved}${extras.length ? ` (${extras.join(", ")})` : ""}`);
  }
  return lines;
}

// True when every scale a row asked for was skipped — the tray calls that a
// no-op rather than "Applied".
function allScalesSkipped(applied) {
  const entries = Object.values(applied ?? {});
  return entries.length > 0 && entries.every((e) => e?.skipped);
}

// The meters a GM moved at a push, per scale: { hunger: Set<characterId>, … }.
// `rows` are that turn's applied StagedEffect rows ({ targetCharacterId,
// payload, appliedEffect }). A meter counts when the row asked for it and it
// wasn't skipped — a knock-on (the mood an onset cost, the humanity
// Bloodcrazed took) is not the GM's figure, so it is not held. The nightly
// passes leave a held meter where the GM put it (ADJUDICATION.md §1b).
// An Observer row (ADJUDICATION.md §1c) has no target: each onlooker it reached
// carries their own `scales` snapshot under appliedEffect.observers.characters.
function heldScalesFrom(rows) {
  const held = Object.fromEntries(SCALES.map((s) => [s.key, new Set()]));
  const hold = (characterId, asked, applied) => {
    if (!characterId || !asked || !applied) return;
    for (const { key } of SCALES) {
      if (asked[key] && applied[key] && !applied[key].skipped) held[key].add(characterId);
    }
  };
  for (const row of rows ?? []) {
    const asked = row?.payload?.scales;
    hold(row?.targetCharacterId, asked, row?.appliedEffect?.scales);
    for (const onlooker of row?.appliedEffect?.observers?.characters ?? []) {
      hold(onlooker?.characterId, asked, onlooker?.scales);
    }
  }
  return held;
}

module.exports = {
  SCALES,
  SCALE_BY_KEY,
  SCALE_OPS,
  SKIP_REASONS,
  SCALE_GATE_SLUGS,
  scaleBlockFor,
  normalizeStagedScales,
  hasScales,
  resolveScale,
  formatScaleNumber,
  describeScaleChange,
  describeScales,
  describeAppliedScales,
  allScalesSkipped,
  heldScalesFrom,
};
