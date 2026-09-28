// The registry behind GameConfig: every knob a GM can edit, declared once.
//
// Three things used to have to agree by hand — the Prisma column, the form on
// /gm/dev, and the parser behind it — and they had drifted: noticeExpiryTurns
// had a column and no control, and four per-game columns had no wipe-reset.
// Now the form renders THIS list, the parser walks THIS list, and
// `npm run db:check-config` diffs it against the schema so a new column
// without an entry here fails the push instead of quietly becoming
// unreachable.
//
// `internal` names the columns that are real but not knobs: Discord pointers
// and the REST breaker, written by code and never by a form.

const GROUPS = [
  { key: "creation", name: "Character creation" },
  { key: "economy", name: "Economy" },
  { key: "carry", name: "Carrying" },
  { key: "mood", name: "Mood" },
  { key: "desires", name: "Desires" },
  { key: "clock", name: "Turn clock" },
  { key: "catatonic", name: "Catatonic" },
  { key: "vampire", name: "Vampire" },
  { key: "features", name: "Features" },
  { key: "discord", name: "Discord" },
];

// type: "int" | "float" | "bool" | "select". min/max clamp an int or float on save; a select declares its `options` as
// { value, label } and the parser takes the value's own type from the option, so one branch serves an Int column
// (turnLengthHours) and an enum one (gameMode) alike.
const FIELDS = [
  // --- Character creation --------------------------------------------------
  {
    key: "startingTagPoints", type: "int", group: "creation", default: 8, min: 0, max: 100,
    label: "Starting Tag Points",
  },
  {
    key: "maxDrawbackTags", type: "int", group: "creation", default: 6, min: 0, max: 20,
    label: "Max drawback tags",
  },
  {
    key: "maxDrawbackPoints", type: "int", group: "creation", default: 8, min: 0, max: 60,
    label: "Max drawback points",
  },
  {
    key: "playerCount", type: "int", group: "creation", default: 80, min: 1, max: 1000,
    label: "Fate seats, readied + 10% (until Start)",
  },
  {
    key: "creationWindowHours", type: "int", group: "creation", default: 12, min: 1, max: 168,
    label: "Creation window (hours)",
  },
  {
    key: "playtestModeEnabled", type: "bool", group: "creation", default: false,
    label: "Playtest",
    info: "Only GMs, playtesters, and contributors can join",
  },
  {
    key: "playtestRequiresRole", type: "bool", group: "creation", default: true,
    label: "Require Playtest role",
    info: "Only matters while Playtest is on. On: only GMs, playtesters, and contributors can join. Off: anyone with the Player role can join too",
  },

  // --- Economy ---------------------------------------------------------------
  {
    key: "productionCoefficient", type: "float", group: "economy", default: 0.9, min: 0, max: 5, step: 0.05,
    label: "Production coefficient",
  },
  {
    key: "lifewebDecayPerTurn", type: "int", group: "economy", default: 19, min: 0, max: 100,
    label: "Lifeweb decay / turn",
  },
  {
    key: "noticeExpiryTurns", type: "int", group: "economy", default: 10, min: 1, max: 100,
    label: "Notice lifespan (turns)",
  },
  {
    key: "vaultReservePercent", type: "int", group: "economy", default: 25, min: 0, max: 500,
    label: "Vault stock (% of starting balances)",
    info: "Each new character's starting bank balance puts this share of it into the Keep's Vault as coin, so the Vault opens holding this percentage of what everyone (bar the Baron) starts with in the bank. Applies to characters created after it is changed. See DEPOT.md §0g",
  },
  {
    key: "farmMaxCrops", type: "int", group: "economy", default: 100, min: 1, max: 500,
    label: "Plants per farm",
    info: "How many crops one Farm action plants. Each has a 1-in-6 chance to wither; every survivor is 1 Foodstuff. See db/lib/soilery.js",
  },
  {
    key: "craftYieldTiming", type: "select", group: "economy", default: "IMMEDIATE",
    options: [
      { value: "IMMEDIATE", label: "Same turn" },
      { value: "STAGED", label: "At the turn push" },
    ],
    label: "Crafted items arrive",
    info: "Same turn: the item lands the moment the player presses Craft. At the turn push: the Move, ingredients and ⬢ are still spent on the press, but the item is staged and lands when the turn pushes. See CRAFTING.md §3a",
  },
  {
    key: "stableCapacity", type: "int", group: "economy", default: 10, min: 1, max: 200,
    label: "Stable capacity",
    info: "Most arelitz (adults, unruly, and brood) one Stable room may hold before the excess is evicted",
  },
  {
    key: "stableOverflowRoomSlug", type: "string", group: "economy", default: "town-3-1",
    label: "Stable overflow room",
    info: "Room slug an overflowing Stable evicts its excess arelitz to. A missing or unresolvable slug skips the eviction rather than deleting anything.",
  },

  // --- Carrying --------------------------------------------------------------
  {
    key: "carryWeightLbs", type: "int", group: "carry", default: 71, min: 1, max: 2000,
    label: "Carry cap: lb",
  },
  // No second cap for ⬢ any more: they are a one-pound item, so they push
  // against the pound cap above beside the gear and the column is gone from the
  // schema. A dead entry here would fail db:check-config, not just sit unread.
  {
    key: "freeZoneMovesPerTurn", type: "float", group: "carry", default: 1, min: 0, max: 5, step: 0.5,
    label: "Free travel a turn",
  },
  {
    key: "locationMoveCooldownSeconds", type: "int", group: "carry", default: 30, min: 0, max: 3600,
    label: "Walk cooldown (seconds)",
  },

  // --- Mood ------------------------------------------------------------------
  {
    key: "moodIntensity", type: "float", group: "mood", default: 1, min: 0, max: 4, step: 0.1,
    label: "Mood intensity",
  },

  // --- Desires ---------------------------------------------------------------
  {
    key: "desireSlots", type: "int", group: "desires", default: 2, min: 1, max: 5,
    label: "Desire slots",
  },
  {
    key: "desireSlotLockTurns", type: "int", group: "desires", default: 1, min: 0, max: 20,
    label: "Desire slot lock",
  },

  // --- Turn clock ------------------------------------------------------------
  {
    key: "autoTurnAdvanceDisabled", type: "bool", group: "clock", default: false,
    label: "Pause automatic turn advance",
  },
  {
    key: "turnLengthHours", type: "select", group: "clock", default: 24,
    options: [6, 8, 12, 24].map((h) => ({ value: h, label: `${h} hours` })),
    label: "Turn length",
    info: "Takes effect at the next turn, never the open one. Adjudication window: 2 hours on 6 and 8, 3 on 12 and 24.",
  },
  {
    key: "turnsPerDay", type: "int", group: "clock", default: 0, min: 0, max: 24,
    label: "Turns per in-game day (0 = at midnight)",
    info: "0 rolls the day at midnight Chicago, so the turn length decides. Any other number rolls it after that many turns. Takes effect at the next turn; days already played keep their number.",
  },
  {
    key: "gameMode", type: "select", group: "clock", default: "PERSISTENT",
    options: [
      { value: "PERSISTENT", label: "Persistent" },
      { value: "SESSIONS", label: "Sessions" },
    ],
    label: "Game type",
    info: "Sessions freezes the whole game between sittings. Schedule one in the Sessions panel.",
  },
  {
    key: "roleplayBetweenSessions", type: "bool", group: "clock", default: true,
    label: "Allow roleplaying in between sessions",
    info: "Between sittings players may still talk. Everything else is shut either way. Sessions only.",
  },

  // --- Catatonic -------------------------------------------------------------
  {
    key: "catatonicTurns", type: "int", group: "catatonic", default: 4, min: 1, max: 60,
    label: "Catatonic after N idle turns",
  },
  {
    key: "catatonicDeathTurns", type: "int", group: "catatonic", default: 4, min: 0, max: 60,
    label: "Death after N Catatonic turns (0 = off)",
  },

  // --- Vampire -----------------------------------------------------------
  {
    key: "vampireBloodDecayPerDay", type: "int", group: "vampire", default: 34, min: 0, max: 100,
    label: "Blood decay / day",
    info: "Scaled by the closing turn's own length — 3 days to empty a full meter at the default.",
  },
  {
    key: "vampireHumanityRegenPerDay", type: "int", group: "vampire", default: 10, min: 0, max: 100,
    label: "Humanity regen / day",
    info: "Scaled the same way. Stops entirely once a vampire holds Bestial.",
  },
  {
    key: "vampireBloodAbilityCooldownVariable", type: "int", group: "vampire", default: 5, min: 0, max: 50,
    label: "Blood ability cooldown variable (v)",
    info: "Multiplies each Blood Ability's own constant (4 for Blood Strength, 2 for Regeneration, etc) to get its cooldown in turns, rounded.",
  },

  // --- Features --------------------------------------------------------------
  {
    key: "avatarUploadsEnabled", type: "bool", group: "features", default: true,
    label: "Player avatar uploads",
  },
  {
    key: "archiveTravelEvents", type: "bool", group: "features", default: false,
    label: "Archive travel events",
  },
  {
    key: "playPanelEnabled", type: "bool", group: "features", default: true,
    label: "Play page",
  },
  {
    key: "anonymizeStrangers", type: "bool", group: "features", default: true,
    label: "Unknown faces go unnamed",
    info: "On: somebody you have never met reads as \"a young man\" until you learn their name. Off: every uncovered face shows its real name to everyone; only a hood hides anyone",
  },

  // --- Discord ---------------------------------------------------------------
  {
    key: "tupperAutocorrectEnabled", type: "bool", group: "discord", default: true,
    label: "Tupper autocorrect",
  },
];

// Real columns that are not knobs. The check script exempts these; the form
// never shows them.
const INTERNAL_KEYS = [
  "id",
  // Retired: nothing writes a Discord nickname any more. Column kept, knob gone.
  "nicknameSyncEnabled",
  "turnsConsoleChannelId",
  "turnsConsoleMessageId",
  "restInvalidCount",
  "restInvalidWindowStart",
  "restBreakerOpenUntil",
  // The Play page (CHAT.md §7): the two wipe watermarks, one per cadence.
  "feedWipeSeq",
  "feedWipeSummarySeq",
  // Not a knob on purpose. The wipe is how the game works, so there is no
  // form control for it; the column is a hand-flippable escape hatch for the
  // day Discord starts rate-limiting the sweep. See db/lib/messageWipe.js.
  "messageWipeEnabled",
  "radioCategoryId",
  "cerberonChannelId",
  "freq27065ChannelId",
  "freq243000ChannelId",
  // Deadchat (db/lib/deadchat.js). Provisioned, not configured — like the radio
  // ids above, it is here so the registry check does not read it as drift.
  "deadchatCategoryId",
  "deadchatChannelId",
  // Party chat (db/lib/partyChat.js): the parent channel each party's private
  // thread hangs off, under the Gameplay category. Provisioned by the mirror.
  "gameplayCategoryId",
  "partyChannelId",
  // Retired 2026-09-13: the per-slot rules in db/lib/equipSlots.js are the
  // whole equipment limit. The column stays, unread, so nothing drops a value.
  "equipSlots",
  // Retired as knobs 2026-09-09. All three are rules of the game now, not
  // preferences: the whitelist always gates a gated role, the portrait maker
  // is always open, and the fantasy parts are always off. The code hardcodes
  // each answer; the columns stay so nothing drops a value.
  "leaderWhitelistEnabled",
  "portraitMakerEnabled",
  "portraitFantasyPartsEnabled",
  // The Oracle (docs/systemdocs/ORACLE.md). Edited from its own section at
  // /gm/dev?s=oracle, never from the generic Configuration form: the registry
  // has no field type for a textarea, and rendering an API key as a text box
  // would put a live credential on screen. See web/app/(app)/gm/dev/oracleActions.js.
  "oracleEnabled",
  "oraclePlaytest",
  "oracleProvider",
  "oracleBaseUrl",
  "oracleModel",
  "oracleApiKey",
  "oracleApiKeySetAt",
  "oracleApiKeySetBy",
  "oracleMemoryTurns",
  "oracleIncludeChat",
  "oracleCorrespondentPrompt",
  "oracleEditorPrompt",
  "oracleAppendPrompt",
];

function fieldsInGroup(groupKey) {
  return FIELDS.filter((f) => f.group === groupKey);
}

// Turns one posted form value into the column's value, clamped. A missing or
// unparsable number falls back to the current value, never to the default —
// a GM who cleared a box did not ask for the launch setting back.
function parseField(field, raw, current) {
  if (field.type === "bool") return raw === "on" || raw === "true";
  if (field.type === "select") {
    // Matched by string, returned as the option's own type. Anything not on the list falls back to `current` for the same
    // reason a cleared number box does — a value the registry does not recognise is a bug or a tampered form, and neither
    // is a request to reset the knob.
    const hit = field.options.find((o) => String(o.value) === String(raw));
    return hit ? hit.value : (current ?? field.default);
  }
  const text = raw == null ? "" : String(raw).trim();
  if (text === "") return current ?? field.default;
  if (field.type === "string") return text;
  const n = field.type === "float" ? Number.parseFloat(text) : Number.parseInt(text, 10);
  if (Number.isNaN(n)) return current ?? field.default;
  const lo = field.min ?? -Infinity;
  const hi = field.max ?? Infinity;
  return Math.min(hi, Math.max(lo, n));
}

// Every field off a FormData, as the `data` for a gameConfig.update.
//
// A form may render only some groups (the Turn clock group lives in the Turn
// section, the rest in Configuration). When it does, it posts a `__configGroups`
// marker naming the groups it showed, and we parse only those fields — because
// an absent checkbox parses to `false`, and parsing every field off a partial
// form would silently clear the bools the form never rendered. No marker means
// the whole registry, so any other caller is unchanged.
function parseConfigForm(formData, current = {}) {
  const raw = formData.get("__configGroups");
  const only = raw ? String(raw).split(",").filter(Boolean) : null;
  const fields = only ? FIELDS.filter((f) => only.includes(f.group)) : FIELDS;
  const data = {};
  for (const field of fields) {
    data[field.key] = parseField(field, formData.get(field.key), current[field.key]);
  }
  return data;
}

module.exports = { GROUPS, FIELDS, INTERNAL_KEYS, fieldsInGroup, parseConfigForm };
