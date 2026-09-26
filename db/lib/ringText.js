// Every line a player reads about signet rings, seals copied from them and the
// infoterminals they open (docs/systemdocs/RINGS.md), in one table so a copy
// pass edits one file. Prisma-free, so a "use client" component may import it.
//
// {braces} are filled in by fillRingText; everything else is literal.

const RING_TEXT = {
  // The ring itself.
  ringName: "Silver Ring",
  ringDescription: "A simple ring engraved with the initials {initials}.",
  ringUnregistered: "It has yet to be registered with the Meister.",
  // Added to a smithed ring the Meister registers to an office's doors.
  ringSealless: "It lacks the signet seal of the original.",
  // The travel note when the worn ring is what opens a way (web/lib/travelCost.js).
  openedByRing: "Your ring grants you access.",
  // The equipment slot (db/lib/equipSlots.js).
  slotTitle: "Finger",
  slotLabel: "on your finger",

  // Smithing a ring, and forging a wax seal from one.
  craftTargetLabel: "Engrave it for",
  craftTargetNone: "You don't know anybody's name to engrave.",
  craftTargetMissing: "Pick who the ring is for.",
  forgedSealName: "Wax Seal ({label})",
  forgedSealDescription: "A wax stamp copied from a signet ring. {mark}",
  forgePickLabel: "Copy the seal of",
  forgeNoRing: "Hold a signet ring to copy its seal.",
  forgeSealless: "That ring leaves no seal to copy. Only an office's own ring does.",

  // Sealing a letter.
  sealNone: "You have nothing that leaves a seal.",
  sealNotASeal: "That doesn't seal letters.",
  sealHint: "Close a letter with an office's signet ring or a wax seal.",
  sealPickBot: "With which seal?",

  // Infoterminals (the ATMs, renamed).
  infoterminalButton: "Infoterminal",
  infoterminalAttribute: "**Infoterminal**: you can reach your treasury account here.",
  infoterminalTitle: "The Infoterminal",
  infoterminalReading: "Reading your ring…",
  infoterminalNoRing: "The infoterminal reads the ring on your finger. You aren't wearing one.",
  infoterminalUnregistered: "This ring isn't registered. Take it to the Meister.",
  infoterminalPinStranger: "This ring isn't yours. Enter the account's PIN.",
  infoterminalPinForgot: "The numbers won't come to you. Enter your PIN.",
  infoterminalPinLabel: "PIN",
  infoterminalWrongPin: "Wrong PIN.",
  infoterminalDepotTab: "Infoterminals",
  infoterminalDepotHint: "You have no account. The Meister opens one when he registers a ring for you.",
  memoriesPin: "Infoterminal PIN",

  // The Meister's terminal.
  registerTitle: "Register a ring",
  registerIntro: "Hold an unregistered ring to register it. Choose whose doors it opens and which account it reaches.",
  registerNone: "You aren't holding an unregistered ring.",
  registerRoles: "Opens the doors of",
  registerAccountNew: "Open a new account for {name}",
  registerAccountExisting: "Link an existing account",
  registerConfirm: "Register",
  registerDone: "Registered. The ring opens the doors of {roles}.",
  registerDoneNone: "Registered. The ring reaches its account and opens no doors.",
};

// Initials end in a full stop ("A.V."), so one set at the end of a sentence
// would print "A.V.." — the doubled stop is folded into one.
function tidyStops(text) {
  return text.replace(/\.\.(?=\s|$)/g, ".");
}

function fillRingText(key, vars = {}) {
  const template = RING_TEXT[key];
  if (template == null) throw new Error(`ringText: no line "${key}"`);
  return tidyStops(template.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] != null ? String(vars[name]) : whole)));
}

module.exports = { RING_TEXT, fillRingText, tidyStops };
