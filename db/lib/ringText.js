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
  forgedSealName: "Wax Seal of the {label}",
  forgedSealDescription: "A wax stamp designed to perfectly imitate an official seal. {mark}",
  forgePickLabel: "Copy the seal of",
  forgeNoRing: "Hold a signet ring to copy its seal.",
  forgeSealless: "That ring bears no seal for you to copy.",

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
  infoterminalNoRing: "The infoterminal patiently waits for you to present your ring… except you aren't wearing one.",
  infoterminalUnregistered: "This ring isn't registered to anyone. Take it to the Meister.",
  // A ring whose account the Meister closed: a ring connects once, so the
  // Meister can't help (docs/systemdocs/MEISTERY.md §5).
  infoterminalClosed: "The infoterminal reads your ring and finds no account behind it.",
  infoterminalPinStranger: "Enter your PIN.",
  infoterminalPinForgot: "Enter your PIN.",
  infoterminalPinLabel: "PIN",
  infoterminalWrongPin: "Wrong PIN.",
  infoterminalDepotTab: "Infoterminals",
  infoterminalDepotHint: "You have no account. The Meister opens one when he registers a ring for you.",
  memoriesPin: "Infoterminal PIN",

  // Registering a ring at the Meister's Terminal: db/lib/meisterTerminalText.js.
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
