// The names of the sounds the game makes. Both faces of the web app read this list: a
// server call site stamps a token onto the line it is already writing (ArchiveEntry.sfx),
// and web/app/components/sfx.js maps the same token to a file under /assets/sfx.
//
// A TOKEN, never a filename and never a path. The browser looks a token up in its own map,
// so a row carrying junk plays nothing rather than fetching something — and the sound a
// meaning makes can be swapped by editing one line in one file instead of every call site.
//
// Deliberately NOT exported from the @lifeweb/db barrel and deliberately free of requires:
// it is reachable from a client component, and one require of @lifeweb/db there drags
// PrismaClient into the browser bundle (db/lib/dmKinds.js says the same about itself).
// Require it by path.

const SFX = {
  // What an action says back to whoever clicked it. These ride the guarded() envelope
  // (web/lib/actionResult.js), not a row, so they never leave the actor's own tab.
  OK: "success",
  OK_QUIET: "success-soft",
  REFUSE: "refuse",
  REFUSE_MONEY: "refuse-money",
  COIN: "coin",

  EQUIP_LOCK: "equip-lock",
  EQUIP_CLOTH: "equip-cloth",
  EQUIP_SHIELD: "equip-shield",
  EQUIP_BLADE: "equip-blade",
  EQUIP_MAIL: "equip-mail",
  EQUIP_GUN: "equip-gun",
  EQUIP_REVOLVER: "equip-revolver",

  // Your own boots, and nobody else's. Which one you hear is the ground you landed on
  // rather than a choice any call site makes — see groundSfx below.
  STEP_CARPET: "step-carpet",
  STEP_WOOD: "step-wood",
  STEP_EARTH: "step-earth",

  // Hands on other people's things.
  LOOT: "loot",
  POCKET: "pocket",
  STASH: "stash",

  MINE: "mine",
  FARM: "farm",
  SMITH: "smith",
  CRAFT: "craft",
  WRITE: "write",

  HEAL: "heal",
  BIND: "bind",
  HARM: "harm",
  BUTCHER: "butcher",
  UNBIND: "unbind",
  SEAL_BREAK: "seal-break",
  CRATE: "crate",
  DIG: "dig",
  PHOTO: "photo",
  NUKE_ARM: "nuke-arm",
  NUKE_PING: "nuke-ping",

  EAT: "eat",
  DRINK: "drink",

  // Word reaching one person.
  NAMED: "named",
  RADIO_SEND: "radio-send",
  RADIO_HEAR: "radio-hear",
  // Nothing plays this yet: there is no open-a-document surface. Kept so the file it
  // points at has a reason to be in the folder when one arrives.
  PAGE: "page",

  // The world, heard by everyone reading the place it happened in. These ride
  // ArchiveEntry.sfx on a line that is being written anyway.
  GATE_OPEN: "gate-open",
  GATE_SHUT: "gate-shut",
  TURRET: "turret",
  GUNFIRE: "gunfire",
  ALARM: "alarm",
  // The bell and the horn are no longer the same noise. The bell is a cathedral bell
  // (a CC0 recording, not OpenSourceWeb — web/public/assets/sfx/ATTRIBUTION.md); the
  // horn is the Bastard's Deep Beast Horn and nothing else rings it.
  BELL: "bell",
  HORN: "horn",
  LIFEWEB: "lifeweb",
  CONVERT: "convert",
  INITIATE: "initiate",
  SPAWN: "spawn",
  TELEPORT: "teleport",
  GIB: "gib",
  BOOM: "boom",
  RISE: "rise",
  QUAKE: "quake",
  LANDING: "landing",
  PIN: "pin",
  TEAR: "tear",

  // The one cue that does not stop on its own. A rite that has gone tense holds the
  // altar's drone under the room until it fires or the window closes — see the loop
  // rules in web/app/components/sfx.js.
  RITE_LOOP: "rite-loop",
};

const NAMES = new Set(Object.values(SFX));

// The ground under a zone. Five zones in docs/zones.yaml and three surfaces between them:
// the Fortress is carpeted, the Town is boards over the Undertown, and everywhere else is
// dirt. A zone nobody has taught this function gets dirt, which is the safe guess — nothing
// in the game is built on carpet by accident.
function groundSfx(zoneSlug) {
  if (zoneSlug === "fortress") return SFX.STEP_CARPET;
  if (zoneSlug === "town") return SFX.STEP_WOOD;
  return SFX.STEP_EARTH;
}

/** True for a token this file names. The gate on anything that reaches the wire. */
function isSfx(name) {
  return typeof name === "string" && NAMES.has(name);
}

module.exports = { SFX, isSfx, groundSfx };
