// Every verb a player starts, as the Discord bot knows it — the slash command
// that types it, the section of the Actions menu it sits in, and the flag that
// hides or greys it. ZERO requires, ever, like itemVerbs.js: a list, not code.
//
// The web's own list is web/app/components/actionRegistry.js, which carries
// icons and so cannot be read from here. The `show`/`gate` names and the
// greyed sentences below are copied from it on purpose, and
// db/test/actionCatalog.test.js reads that file as text and fails if a mode is
// added there without a line here — so a new verb on the web cannot quietly
// stay missing from Discord.
//
// On top of the registry this lists the verbs a player starts from somewhere
// else on the web — the trumpet on the sheet, a Move's edit box, the Here
// list's Pick up — so the Discord Actions menu is the one place for all of
// them (docs/systemdocs/COMMANDS.md §2g).
//
// Fields:
//   mode        the registry's mode where there is one; a new key otherwise.
//   label       what the menu and the command's reply call it.
//   section     where the Actions menu lists it: "work" (what this place
//               offers), "self", "others", "role", "paper" — or "place" for
//               the verbs tied to one room, which get a button on that room's
//               post instead and never appear in the menu.
//   show/gate   pool keys from db/lib/actionPools.js. Falsy `show` hides the
//               verb; falsy `gate` greys it, with `gateReason` unless the
//               pools carry a sharper sentence.
//   command     the slash command, and `sub` its subcommand (null for a
//               command that is the verb itself).
//   description the slash command's own line, 100 characters at most.
//   run         "native" when the bot does it itself, "link" when the reply
//               is a link to the web's dialog for it (web: true means that
//               dialog opens from /character?act=<mode>).
//   open        a read that stays clickable between sessions (SESSIONS.md §5).

// A button that starts one verb outright — a room's own fixture for a verb
// tied to it (db/lib/placeAffordances.js), routed by the bot to the same start
// as the verb's command.
const ACTION_START_PREFIX = "act:start:";

const SECTIONS = [
  { key: "work", label: "Work here" },
  { key: "self", label: "Yourself" },
  { key: "others", label: "Someone here" },
  { key: "role", label: "Your role" },
  { key: "paper", label: "Paper" },
];

const ACTIONS = [
  // --- Work this place offers. Every one HIDES where the ground is wrong,
  // which is where you stand, not who stands near you. ------------------------
  { mode: "extract", label: "Harvest Godflesh", section: "work", show: "canSeeExtract", gate: "canExtract", gateReason: "You have nothing to cut with.", command: "work", sub: "harvest", description: "Harvest Godflesh, once a turn. Costs no Move.", run: "native" },
  { mode: "refine", label: "Refine", section: "work", show: "canSeeRefine", gate: "canRefine", gateReason: "There's no Godflesh here to refine.", command: "work", sub: "refine", description: "Spend your Move refining Godflesh into Squeeze.", run: "native" },
  { mode: "mine", label: "Mine", section: "work", show: "canSeeMine", gate: "canMine", gateReason: "You're worn out.", command: "work", sub: "mine", description: "Spend your Move mining (or gathering) where you stand.", run: "native" },
  { mode: "farm", label: "Farm", section: "work", show: "canSeeFarm", gate: "canFarm", gateReason: "You're worn out.", command: "work", sub: "farm", description: "Spend your Move sowing the fields.", run: "native" },
  { mode: "breakin", label: "Break In", section: "work", show: "canSeeBreakIn", gate: "canBreakIn", gateReason: "You don't know how to break in an arelitz.", command: "work", sub: "breakin", description: "Spend your Move breaking in an unruly arelitz.", run: "native" },
  { mode: "package", label: "Package", section: "work", show: "canSeePackage", command: "item", sub: "package", description: "Pack up to 150 lb of what you carry into one crate.", run: "link", web: true },

  // --- Yourself ---------------------------------------------------------------
  { mode: "craft", label: "Craft", section: "self", gate: "canCraft", gateReason: "You know no recipe you could make right now.", command: "item", sub: "craft", description: "Smith, craft, brew or cook.", run: "link", web: true },
  { mode: "destroy", label: "Destroy", section: "self", gate: "canDestroy", gateReason: "You're carrying nothing you could destroy.", command: "item", sub: "destroy", description: "Destroy something you're carrying.", run: "native" },
  { mode: "consume", label: "Consume", section: "self", gate: "canConsume", gateReason: "Nothing you're carrying can be used up.", command: "item", sub: "consume", description: "Eat, drink or use something up.", run: "link", web: true },
  { mode: "poison", label: "Poison", section: "self", show: "canPoison", command: "item", sub: "poison", description: "Lace a meal or drink you're holding with poison.", run: "native" },
  { mode: "equip", label: "Equip", section: "self", show: "canEquip", command: "item", sub: "equip", description: "Put on or take up something you're carrying.", run: "native", open: true },
  { mode: "unequip", label: "Unequip", section: "self", show: "canUnequip", command: "item", sub: "unequip", description: "Take off something you have on.", run: "native", open: true },
  { mode: "transfer", label: "Transfer", section: "self", command: "item", sub: "transfer", description: "Give, drop or pick up things and Resources.", run: "link", web: true },
  { mode: "play", label: "Play Instrument", section: "self", show: "canSeePlay", gate: "canPlay", gateReason: "Equip an instrument first.", command: "perform", sub: "start", description: "Start playing a song on the instrument in your hands.", run: "native" },
  { mode: "stopplay", label: "Stop playing", section: "self", show: "isPerforming", command: "perform", sub: "stop", description: "Stop the song you're playing.", run: "native" },
  { mode: "trumpet", label: "Sound the trumpet", section: "self", show: "hasTrumpet", command: "sound", sub: "trumpet", description: "Sound your trumpet for the whole town to hear.", run: "native" },
  { mode: "horn", label: "Sound the Deep Beast Horn", section: "self", show: "hasHorn", command: "sound", sub: "horn", description: "Sound the Deep Beast Horn.", run: "native" },
  { mode: "disguise", label: "Disguise", section: "self", show: "canDisguise", command: "disguise", sub: null, description: "Put on a false name and face for 3 turns.", run: "native" },
  { mode: "learn", label: "Learn skill", section: "self", gate: "canLearn", gateReason: "Nobody here can teach you.", command: "lesson", sub: "learn", description: "Ask someone here to teach you a skill.", run: "native", web: true },
  { mode: "teach", label: "Teach skill", section: "self", gate: "canTeach", gateReason: "You have nothing to teach that anyone here could learn.", command: "lesson", sub: "teach", description: "Offer to teach someone here a skill you have.", run: "native", web: true },
  { mode: "confess", label: "Confess", section: "self", gate: "canConfess", gateReason: "You have nothing to confess.", command: "confess", sub: null, description: "Confess a tag to a chaplain standing here.", run: "native", web: true },
  { mode: "breakrestraints", label: "Break restraints", section: "self", show: "canBreakRestraints", command: "captive", sub: "escape", description: "Make a Gambit to break your own restraints.", run: "native" },
  { mode: "stepstone", label: "Stepstone", section: "self", show: "hasStepstone", command: "stepstone", sub: null, description: "Break the stone and stand somewhere else.", run: "native" },
  { mode: "steal", label: "Steal", section: "self", command: "take", sub: "steal", description: "Steal from a room without it showing you did.", run: "link", web: true },
  { mode: "combat", label: "Combat mode", section: "self", command: "combat", sub: null, description: "Turn combat mode on or off. Required to attack/intercept or defend yourself.", run: "native" },
  { mode: "mymove", label: "My Move", section: "self", show: "hasOpenTurn", command: "mymove", sub: null, description: "See the Move you filed this turn, and edit or withdraw it.", run: "native", open: true },
  { mode: "rename", label: "Drink the Mulligan Potion", section: "self", show: "hasMulligan", command: "mulligan", sub: null, description: "Drink the Mulligan Potion and take a new name.", run: "link" },
  { mode: "desire", label: "Claim a Desire", section: "self", command: "desire", sub: null, description: "Claim a Desire from the catalog.", run: "link" },
  { mode: "blood", label: "Blood abilities", section: "self", show: "isVampire", command: "blood", sub: null, description: "Use one of your blood abilities.", run: "link" },

  // --- Someone here. The metagaming rule: nothing here greys on who is
  // standing near you (actionRegistry.js's header). -----------------------------
  { mode: "examine", label: "Look at", section: "others", gate: "canExamine", gateReason: "You can't see well enough right now.", command: "look", sub: null, description: "Look someone here over.", run: "native", open: true, web: true },
  { mode: "kiss", label: "Kiss", section: "others", gate: "canKiss", gateReason: "You can't kiss right now.", command: "kiss", sub: null, description: "Ask someone here for a kiss.", run: "native", web: true },
  { mode: "search", label: "Search", section: "others", command: "search", sub: null, description: "Ask to search someone here.", run: "native", web: true },
  { mode: "attack", label: "Attack", section: "others", command: "attack", sub: null, description: "Attack someone here. Both of you are held until the turn ends.", run: "native", web: true },
  { mode: "intercept", label: "Intercept", section: "others", command: "intercept", sub: "set", description: "Lie in wait here for someone.", run: "native", web: true },
  { mode: "interceptstop", label: "Stop intercepting", section: "others", show: "isIntercepting", command: "intercept", sub: "stop", description: "Stop lying in wait.", run: "native" },
  { mode: "bring", label: "Pick someone up", section: "others", command: "escort", sub: "bring", description: "Take someone here along with you when you travel.", run: "native" },
  { mode: "putdown", label: "Put someone down", section: "others", show: "hasParty", command: "escort", sub: "putdown", description: "Stop taking someone along with you.", run: "native" },
  { mode: "heal", label: "Heal", section: "others", gate: "canHeal", gateReason: "You have no Medical training.", command: "medic", sub: "heal", description: "Treat someone's wounds, or your own.", run: "link", web: true },
  { mode: "miracle", label: "Perform Miracle", section: "others", show: "canMiracle", gate: "canMiracleNow", gateReason: "You've used both miracles this turn.", command: "medic", sub: "miracle", description: "Cure someone else's wound by miracle.", run: "native", web: true },
  { mode: "bind", label: "Bind", section: "others", command: "captive", sub: "bind", description: "Tie someone up.", run: "native", web: true },
  { mode: "free", label: "Free", section: "others", command: "captive", sub: "free", description: "Cut someone loose.", run: "native", web: true },
  { mode: "crucify", label: "Crucify", section: "others", show: "canCrucify", command: "captive", sub: "crucify", description: "Put someone standing here on the cross.", run: "native", web: true },
  { mode: "shackle", label: "Shackle", section: "others", show: "canShackle", command: "captive", sub: "shackle", description: "Shackle someone bound.", run: "native", web: true },
  { mode: "torture", label: "Torture", section: "others", show: "canTorture", command: "captive", sub: "torture", description: "Torture someone bound or helpless.", run: "link", web: true },
  { mode: "mutilate", label: "Mutilate", section: "others", show: "canMutilate", command: "captive", sub: "mutilate", description: "Cut a piece off someone tied up, or off a body.", run: "link", web: true },
  { mode: "brand", label: "Brand", section: "others", show: "canBrand", command: "captive", sub: "brand", description: "Permanently brand someone bound or helpless.", run: "native", web: true },
  { mode: "harm", label: "Harm", section: "others", command: "captive", sub: "harm", description: "Further injure someone bound or helpless.", run: "link", web: true },
  { mode: "loot", label: "Loot", section: "others", command: "take", sub: "loot", description: "Go through the pockets of someone who can't stop you.", run: "link", web: true },
  { mode: "pickpocket", label: "Pickpocket", section: "others", gate: "canPickpocket", gateReason: "You don't know how to pick a pocket.", command: "take", sub: "pickpocket", description: "Pick someone's pocket.", run: "link", web: true },
  { mode: "applycollar", label: "Apply Collar", section: "others", show: "canApplyCollar", command: "collar", sub: "apply", description: "Lock a collar around someone's neck.", run: "native", web: true },
  { mode: "unlockcollar", label: "Unlock Collar", section: "others", show: "canUnlockCollar", command: "collar", sub: "unlock", description: "Unlock someone's collar.", run: "native", web: true },
  { mode: "detonatecollar", label: "Detonate", section: "others", show: "canDetonateCollar", command: "collar", sub: "detonate", description: "Detonate a slave collar.", run: "native", web: true },
  { mode: "butcher", label: "Butcher", section: "others", gate: "canButcher", gateReason: "You aren't a Butcher.", command: "body", sub: "butcher", description: "Butcher a body.", run: "link", web: true },
  { mode: "bury", label: "Bury person", section: "others", command: "body", sub: "bury", description: "Bury a body. It lifts the player's curse.", run: "native", web: true },
  { mode: "engrave", label: "Engrave", section: "others", command: "body", sub: "engrave", description: "Carve a name on a headstone. It lifts the player's curse.", run: "native", web: true },

  // --- Your role. Every row HIDES for anyone who doesn't hold the seat. --------
  { mode: "pointerdevice", label: "Use pointer device", section: "role", show: "hasPointerDevice", command: "item", sub: "pointer", description: "Check where the other pointer device is.", run: "native", open: true },
  { mode: "recall", label: "Recall comrades", section: "role", show: "isThanati", command: "thanati", sub: "recall", description: "Remember the other Thanati cultists.", run: "native" },
  { mode: "recover", label: "Recover equipment", section: "role", show: "isThanati", gate: "canRecover", gateReason: "You have both.", command: "thanati", sub: "recover", description: "Recover your mask and robes.", run: "native" },
  { mode: "hideout", label: "Set hideout", section: "role", show: "isThanatiLeader", command: "thanati", sub: "hideout", description: "Set the room the cult buys its gear from.", run: "native", web: true },
  { mode: "purchase", label: "Purchase gear", section: "role", show: "isThanati", gate: "atHideout", gateReason: "You aren't standing at the hideout.", command: "thanati", sub: "gear", description: "Buy gear at the hideout.", run: "link", web: true },
  { mode: "warrant", label: "Arrest warrant", section: "role", show: "canWarrant", command: "warrant", sub: "issue", description: "Declare somebody fit for arrest.", run: "native", web: true },
  { mode: "unwarrant", label: "Remove warrant", section: "role", show: "canWarrant", command: "warrant", sub: "remove", description: "Take somebody's warrant down.", run: "native", web: true },
  { mode: "wantedlist", label: "Check wanted", section: "role", show: "isCerberon", command: "warrant", sub: "list", description: "Read the warrant book.", run: "native", open: true },
  { mode: "excommunicate", label: "Excommunicate", section: "role", show: "isBishop", command: "bishop", sub: "excommunicate", description: "Excommunicate a Post-Christian.", run: "native", web: true },
  { mode: "unexcommunicate", label: "Lift an excommunication", section: "role", show: "isBishop", command: "bishop", sub: "lift", description: "Lift an excommunication.", run: "native" },
  { mode: "reinforce", label: "Call reinforcements", section: "role", show: "isBastard", command: "reinforcements", sub: null, description: "Pay for reinforcements to join the game.", run: "native" },

  // --- Paper ------------------------------------------------------------------
  { mode: "readpaper", label: "Read a paper", section: "paper", show: "hasPaper", command: "paper", sub: "read", description: "Read a letter, note or book you're carrying.", run: "native", open: true },
  { mode: "write", label: "Write", section: "paper", show: "canRead", gate: "canWrite", gateReason: "You can't see to write right now.", command: "paper", sub: "write", description: "Write on a sheet of paper you're carrying.", run: "native", web: true },
  { mode: "seal", label: "Seal letter", section: "paper", show: "hasSeal", gate: "canSeal", gateReason: "You have no written letter to close.", command: "paper", sub: "seal", description: "Close a letter with an office's signet ring or a wax seal.", run: "native", web: true },
  { mode: "bird", label: "Send bird", section: "paper", show: "hasBird", gate: "canSendBirdToday", gateReason: "Your bird has already flown today.", command: "paper", sub: "bird", description: "Send a letter you're holding by bird.", run: "link", web: true },
  { mode: "birdReply", label: "Answer a letter", section: "paper", show: "hasBirdReply", command: "paper", sub: "reply", description: "Answer a letter a bird brought you.", run: "native" },

  // --- Tied to one room: a button on that room's post, never the menu. -------
  { mode: "sendmoney", label: "Send money", section: "place", command: "money", sub: "send", description: "Send money from your account, at the Depot.", run: "native" },
  { mode: "credit", label: "Merchant credit", section: "place", command: "money", sub: "credit", description: "Draw on or repay the Merchant's credit line, at the Depot.", run: "native" },
  { mode: "selltax", label: "Set the sell tax", section: "place", command: "selltax", sub: null, description: "Set the Depot's sell tax, from the Meister's office.", run: "native" },
];

const BY_MODE = new Map(ACTIONS.map((a) => [a.mode, a]));

function actionFor(mode) {
  return BY_MODE.get(mode) ?? null;
}

// The verb a typed command names, or null.
function actionForCommand(command, sub = null) {
  return ACTIONS.find((a) => a.command === command && (a.sub ?? null) === (sub ?? null)) ?? null;
}

// Every command, with its subcommands in catalog order: what
// bot/src/lib/commands.js registers.
function commandGroups() {
  const groups = new Map();
  for (const action of ACTIONS) {
    if (!groups.has(action.command)) groups.set(action.command, []);
    groups.get(action.command).push(action);
  }
  return [...groups].map(([command, actions]) => ({ command, actions }));
}

// Where a verb stands for one character, from db/lib/actionPools.js's pools:
// "hidden", "greyed" (with the sentence), or "ready".
function actionState(action, pools) {
  if (action.show && !pools?.[action.show]) return { state: "hidden", reason: null };
  if (action.gate && !pools?.[action.gate]) {
    return { state: "greyed", reason: pools?.gateReason?.[action.mode] ?? action.gateReason ?? null };
  }
  return { state: "ready", reason: null };
}

module.exports = { ACTION_START_PREFIX, SECTIONS, ACTIONS, actionFor, actionForCommand, commandGroups, actionState };
