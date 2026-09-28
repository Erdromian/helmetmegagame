// The Blood Abilities menu (docs/systemdocs/VAMPIRE.md §6 — design doc pages
// 4-5). Pure catalog + cost/cooldown math, no Prisma import, same posture as
// db/lib/vampire.js so both bot/ and web/ can import this by subpath.
//
// "Exchange blood for temporary boons." Each entry: `bloodCost` (deducted
// from Character.vampireBloodLevel immediately, before the effect applies —
// the design doc's own order), `cooldownConstant` (the design doc's table,
// e.g. Blood Strength is "4n" — `n` there is the doc's own name for the dev-
// panel variable `v`; both mean the same knob). The turns-cooldown is
// `Math.round(cooldownConstant * v)`, `v` = GameConfig.vampireBloodAbilityCooldownVariable —
// rounded the way db/lib/vampire.js#perTurnRate rounds
// the meter rates, and for the same reason: a GM
// tuning knob multiplies a per-ability constant, never a live number read
// mid-transaction.
//
// `requiredTagSlug`: the purchasable tag (docs/tags.yaml, `status-vampire-boons`
// group, TAGS.md §3a's group-`requiredTag` gate) that must be HELD before
// this ability is even offered — "gated behind certain skills," the design
// doc's own words. `null` means every vampire has it from the seat alone
// (Blood Strength, Regeneration, Enthral, Nourish — the doc's own table
// leaves their "Required Tag(s)" column blank).
//
// `itemCost`: Corrupt alone — consumes one `heart` item (docs/tags.yaml),
// the game's existing harvested-organ slug; there is no separate
// "human-heart" item in the catalog, and `heart`'s own description is
// already "Someone's once beating heart, now in the palm of your hand."
//
// Deliberately NOT gated on ACT/incapacitation (db/lib/incapacitation.js):
// the design doc explicitly has a Dying vampire (ACT-blocked) casting
// Regeneration to save themselves ("not dying until they are... finished off
// or use regeneration") — a uniform ACT gate would make that impossible. So
// none of the ten abilities check it; a GM who judges a specific use absurd
// (Bat Form while bound, say) adjudicates it by hand the same way a Gambit
// is adjudicated, not by a code refusal.
const ABILITIES = Object.freeze([
  {
    key: "blood-strength",
    name: "Blood Strength",
    description: "Power surges through your veins, granting you inhuman strength.",
    bloodCost: 30,
    cooldownConstant: 4,
    requiredTagSlug: null,
    grantsTagSlugs: ["blood-strength"],
  },
  {
    key: "regeneration",
    name: "Regeneration",
    description: "Heals your immortal body, removing all non-burn injury tags.",
    bloodCost: 20,
    cooldownConstant: 2,
    requiredTagSlug: null,
    // Effect is coded in the action file (removeNonBurnWoundTags), not a
    // plain grant list — it reads the held roster of health-wound/
    // health-infection/health-illness tags at cast time.
    effect: "cure-non-burn-wounds",
  },
  {
    key: "corrupt",
    name: "Corrupt",
    description: "Withers a heart into a black heart. Implanting it into someone may turn them into a vampire.",
    bloodCost: 70,
    cooldownConstant: 6,
    requiredTagSlug: "corruptor",
    itemCost: { slug: "heart", quantity: 1 },
    grantsTagSlugs: ["black-heart"],
  },
  {
    key: "celerity",
    name: "Celerity",
    description: "Grants great dexterity and agility.",
    bloodCost: 25,
    cooldownConstant: 2,
    requiredTagSlug: "celerity",
    grantsTagSlugs: ["agility"],
  },
  {
    key: "resilience",
    name: "Resilience",
    description: "Toughens the skin and tempers the bones. Your body becomes far more resilient.",
    bloodCost: 30,
    cooldownConstant: 2,
    requiredTagSlug: null,
    grantsTagSlugs: ["resilient"],
  },
  {
    key: "bat-form",
    name: "Bat Form",
    description: "Allows you to quickly fly to any region. You must not be incapacitated.",
    bloodCost: 50,
    cooldownConstant: 4,
    requiredTagSlug: "bat-form",
    effect: "teleport",
    // The one ability the design doc itself conditions on capacity ("You
    // must not be incapacitated") — the only ACT check among the ten,
    // because it names the condition explicitly rather than leaving it to
    // GM judgment like every other line in this table.
    requiresAct: true,
  },
  {
    key: "solidarity",
    name: "Solidarity",
    description: "Allows you to send a message to all other vampire characters.",
    bloodCost: 30,
    cooldownConstant: 2,
    requiredTagSlug: "solidarity",
    effect: "broadcast",
  },
  {
    key: "obfuscate",
    name: "Obfuscate",
    description: "Wrap yourself in a cloak of darkness, hiding your presence.",
    bloodCost: 40,
    cooldownConstant: 4,
    requiredTagSlug: "obfuscate",
    grantsTagSlugs: ["hidden"],
  },
  {
    key: "enthral",
    name: "Enthral",
    description:
      "Gives the victim a taste of your immortal blood, turning them into your thrall. They must be incapacitated.",
    bloodCost: 50,
    cooldownConstant: 4,
    requiredTagSlug: null,
    effect: "enthral",
    requiresIncapacitatedTarget: true,
  },
  {
    key: "nourish",
    name: "Nourish",
    description: "Allows your ever demanding thrall to feed from your eternal life force, sustaining them.",
    bloodCost: 30,
    cooldownConstant: 2,
    requiredTagSlug: null,
    effect: "nourish",
    requiresThrallTarget: true,
  },
]);

const ABILITIES_BY_KEY = new Map(ABILITIES.map((a) => [a.key, a]));

function abilityByKey(key) {
  return ABILITIES_BY_KEY.get(key) ?? null;
}

// Rounded the way db/lib/vampire.js#perTurnRate rounds —
// a GM's `v` change takes effect on the next cast, never retroactively
// resizes a cooldown already running (nothing stores the multiplier used;
// each check re-reads live GameConfig, which is fine here since — unlike the
// per-turn meter rates — a cast is a single instant, not a duration spanning
// a turn boundary).
function abilityCooldownTurns(ability, v) {
  const variable = Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.round(ability.cooldownConstant * variable));
}

// Character.vampireBloodAbilityCooldowns is a JSON map, ability key -> the
// turn number it becomes usable again (the turn AFTER the one it was cast
// on's cooldown expires). A JSON column rather than one Int? column per
// ability (the codebase's usual `*LastTurn` idiom, db/lib/gameConfigFields.js
// area) because this is the first per-CHARACTER, multi-ability cooldown
// tracker in the game — ten columns for one Threat's ten abilities would be
// a lot of schema surface for a seat this small, and `Character.avatarData`
// is already this app's precedent for a flexible per-character JSON field.
function cooldownReadyTurn(cooldowns, key) {
  const raw = cooldowns && typeof cooldowns === "object" ? cooldowns[key] : null;
  return Number.isFinite(raw) ? raw : 0;
}

function isOnCooldown(cooldowns, key, openTurnNumber) {
  return cooldownReadyTurn(cooldowns, key) > openTurnNumber;
}

module.exports = {
  ABILITIES,
  abilityByKey,
  abilityCooldownTurns,
  cooldownReadyTurn,
  isOnCooldown,
};
