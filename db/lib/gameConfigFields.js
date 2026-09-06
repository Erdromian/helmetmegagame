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
//
// Labels and help are GM-facing prose (CLAUDE.md prime directive): a line
// drafted here carries ‡, a line Bascinet wrote does not.

const GROUPS = [
  { key: "creation", name: "Character creation" },
  { key: "economy", name: "Economy" },
  { key: "carry", name: "Carrying" },
  { key: "desires", name: "Desires" },
  { key: "clock", name: "Turn clock" },
  { key: "catatonic", name: "Catatonic" },
  { key: "features", name: "Features" },
  { key: "discord", name: "Discord" },
];

// type: "int" | "float" | "bool". min/max clamp an int or float on save.
// `note` is the one-line remark that used to sit under a toggle.
const FIELDS = [
  // --- Character creation --------------------------------------------------
  {
    key: "startingTagPoints", type: "int", group: "creation", default: 12, min: 0, max: 100,
    label: "Starting Tag Points",
    help: "The point-buy budget every new character starts with, before the role's own bonus and the Cursed penalty. ‡",
  },
  {
    key: "maxDrawbackTags", type: "int", group: "creation", default: 6, min: 0, max: 20,
    label: "Max drawback tags",
    help: "How many negative-cost tags a build may take. A build stops at whichever drawback ceiling it reaches first. ‡",
  },
  {
    key: "maxDrawbackPoints", type: "int", group: "creation", default: 13, min: 0, max: 60,
    label: "Max drawback points",
    help: "How many points those drawbacks may claim back in total, as a positive number. ‡",
  },
  {
    key: "playerCount", type: "int", group: "creation", default: 80, min: 1, max: 1000,
    label: "Expected players (until Start)",
    help: "The denominator for every weighted seat until Start Game stamps the real count from the lobby. A role with weight 6 gets six seats per hundred of this. ‡",
  },
  {
    key: "creationWindowHours", type: "int", group: "creation", default: 24, min: 1, max: 168,
    label: "Creation window (hours)",
    help: "How long an assigned seat stays locked to its player after Start Game. Past it the seat opens to late join. The reminder DM goes out six hours before. ‡",
  },
  {
    key: "leaderWhitelistEnabled", type: "bool", group: "creation", default: true,
    label: "Require the whitelist for gated roles",
    help: "Require the @Whitelist role to pick a whitelisted role. A card without it renders greyed, and says “Whitelist only” on hover. The same role gates the whitelisted antagonist opt-ins in the lobby. ‡",
  },

  // --- Economy ---------------------------------------------------------------
  {
    key: "productionCoefficient", type: "float", group: "economy", default: 0.93, min: 0, max: 5, step: 0.05,
    label: "Production coefficient",
    help: "Multiplies every labor rate. 1 is the table as written; 0.93 is the launch tuning. ‡",
  },
  {
    key: "lifewebDecayPerTurn", type: "int", group: "economy", default: 10, min: 0, max: 100,
    label: "Lifeweb decay / turn",
    help: "How much blood the Lifeweb loses every turn advance. ‡",
  },
  {
    key: "equipSlots", type: "int", group: "economy", default: 10, min: 1, max: 20,
    label: "Equip slots",
    help: "How many tags a character may have equipped at once. The per-body-part rule is separate. ‡",
  },
  {
    key: "noticeExpiryTurns", type: "int", group: "economy", default: 10, min: 1, max: 100,
    label: "Notice lifespan (turns)",
    help: "How many turns a paper pinned to a noticeboard stays up before it blows away, counting the turn it was pinned in. ‡",
  },

  // --- Carrying --------------------------------------------------------------
  {
    key: "carryWeightLbs", type: "int", group: "carry", default: 120, min: 1, max: 2000,
    label: "Carry cap: lb ‡",
    help: "How many POUNDS of gear a character can carry before they're Overburdened. Skills, injuries and Assets — a horse, a cart, a house — never weigh anything. Strong, Pack Mule and an equipped Cart multiply it. Past 1.5× this, goods can't be theirs at all. ‡",
  },
  {
    key: "carryResourceCap", type: "int", group: "carry", default: 25, min: 1, max: 1000,
    label: "Carry cap: ⬢ ‡",
    help: "How many ⬢ a character can carry before they're Overburdened. Income still lands; they just lose their free zone move until they stash some. Strong, Pack Mule and an equipped Cart multiply it. ‡",
  },
  {
    key: "freeZoneMovesPerTurn", type: "int", group: "carry", default: 1, min: 0, max: 5,
    label: "Free zone moves ‡",
    help: "Zone crossings a character gets each turn before crossing starts spending their Move. An equipped mount adds 1 on top; being Overburdened takes them all away. ‡",
  },
  {
    key: "locationMoveCooldownSeconds", type: "int", group: "carry", default: 60, min: 0, max: 3600,
    label: "Walk cooldown (seconds) ‡",
    help: "How long a character waits between two walks from one location to another inside the same zone. Crossing into another zone is gated by the Move instead, so this never touches it. 0 removes the wait. ‡",
  },

  // --- Desires ---------------------------------------------------------------
  {
    key: "desiresEnabled", type: "bool", group: "desires", default: true,
    label: "Desire system",
    help: "Let players claim Desires on /character. Turning this off shows “Temporarily disabled.” in place of the Desire panel and blocks a claim server-side. GMs can still award one — catalog or free text — from a character's Dev Panel regardless.",
  },
  {
    key: "desireSlots", type: "int", group: "desires", default: 2, min: 1, max: 5,
    label: "Desire slots",
    help: "How many Desire slots every character gets. Each slot cools down independently of the others, and the bottom one is the slot an Addiction binds. Lowering this hides a slot rather than deleting what was claimed in it.",
  },
  {
    key: "desireSlotLockTurns", type: "int", group: "desires", default: 2, min: 0, max: 20,
    label: "Desire slot lock",
    help: "Whole turns a slot stays shut after a Desire is claimed into it. At 2, a claim on turn 40 leaves that slot shut through turn 42 and open on 43. Remember a turn is a whole real day, and an in-game day is two of them.",
  },

  // --- Turn clock ------------------------------------------------------------
  {
    key: "autoTurnAdvanceDisabled", type: "bool", group: "clock", default: false,
    label: "Pause automatic turn advance",
    help: "The nightly cron skips its advance while this is on. “Advance turn now” on the Turn section still works.",
    note: "Survives a restart, like everything on this page. Turns also never tick outside the Running phase. ‡",
  },
  {
    key: "messageWipeEnabled", type: "bool", group: "clock", default: false,
    label: "Wipe messages at Dawn",
    help: "The transcript is already recorded at send time, this only deletes (see docs/systemdocs/CHANNELS.md).",
  },
  {
    key: "autoReconcileEnabled", type: "bool", group: "clock", default: false,
    label: "Auto-reconcile after turn advance",
    help: "Run the channel doctor's cheap reconcile (roles vs. the database) automatically after every turn advance — it always runs when the bot restarts.",
  },

  // --- Catatonic -------------------------------------------------------------
  {
    key: "catatonicEnabled", type: "bool", group: "catatonic", default: true,
    label: "Catatonic (AFK) flagging",
    help: "Idle turns before a character goes Catatonic (AFK). Flags a character Catatonic (AFK) after that many turns with no move filed and nothing said in character — clears the moment they act or speak again.",
  },
  {
    key: "catatonicTurns", type: "int", group: "catatonic", default: 4, min: 1, max: 60,
    label: "Catatonic after N idle turns",
    help: "Turns with no move filed and nothing said in character before the flag goes on. ‡",
  },
  {
    key: "catatonicDeathTurns", type: "int", group: "catatonic", default: 4, min: 0, max: 60,
    label: "Death after N Catatonic turns (0 = off)",
    help: "The one automatic death in the game: a character who stays Catatonic this many turns straight dies at turn close — full cleanup, no GM confirm. Covers AFK players and players who left the server (their characters go Catatonic on the spot instead of dying). 0 turns it off; the player gets a warning DM one turn before.",
  },

  // --- Features --------------------------------------------------------------
  {
    key: "avatarUploadsEnabled", type: "bool", group: "features", default: false,
    label: "Player avatar uploads",
    help: "Allow players to upload their own profile picture.",
  },
  {
    key: "portraitMakerEnabled", type: "bool", group: "features", default: false,
    label: "Portrait maker",
    help: "Show the “Customize Appearance” portrait maker on /character.",
  },
  {
    key: "portraitFantasyPartsEnabled", type: "bool", group: "features", default: false,
    label: "Portrait fantasy parts",
    help: "Allow the portrait maker's fantasy parts.",
  },
  {
    key: "archiveTravelEvents", type: "bool", group: "features", default: false,
    label: "Archive travel events",
    help: "Record arrivals/departures in the archive.",
  },

  // --- Discord ---------------------------------------------------------------
  {
    key: "tupperAutocorrectEnabled", type: "bool", group: "discord", default: true,
    label: "Tupper autocorrect",
    help: "Capitalize sentence starts in Tupper messages before proxying.",
  },
  {
    key: "nicknameSyncEnabled", type: "bool", group: "discord", default: false,
    label: "Nickname sync",
    help: "Sync Discord nicknames to “{base} | Character Name” on profile/character changes.",
  },
];

// Real columns that are not knobs. The check script exempts these; the form
// never shows them.
const INTERNAL_KEYS = [
  "id",
  "turnsConsoleChannelId",
  "turnsConsoleMessageId",
  "restInvalidCount",
  "restInvalidWindowStart",
  "restBreakerOpenUntil",
  "radioCategoryId",
  "cerberonChannelId",
  "intercomChannelId",
];

const FIELDS_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

function fieldsInGroup(groupKey) {
  return FIELDS.filter((f) => f.group === groupKey);
}

// Turns one posted form value into the column's value, clamped. A missing or
// unparsable number falls back to the current value, never to the default —
// a GM who cleared a box did not ask for the launch setting back.
function parseField(field, raw, current) {
  if (field.type === "bool") return raw === "on" || raw === "true";
  const text = raw == null ? "" : String(raw).trim();
  if (text === "") return current ?? field.default;
  const n = field.type === "float" ? Number.parseFloat(text) : Number.parseInt(text, 10);
  if (Number.isNaN(n)) return current ?? field.default;
  const lo = field.min ?? -Infinity;
  const hi = field.max ?? Infinity;
  return Math.min(hi, Math.max(lo, n));
}

// Every field off a FormData, as the `data` for a gameConfig.update.
function parseConfigForm(formData, current = {}) {
  const data = {};
  for (const field of FIELDS) {
    data[field.key] = parseField(field, formData.get(field.key), current[field.key]);
  }
  return data;
}

module.exports = { GROUPS, FIELDS, FIELDS_BY_KEY, INTERNAL_KEYS, fieldsInGroup, parseField, parseConfigForm };
