"use client";

import { soundSetting } from "@/app/(app)/chat/soundStore";

// The whole of sound in Bascinet. Three callers, and only three:
//
//   playSfx("mine")           an action you took, heard in your tab alone
//   playSfx(row.sfx)          a line a place said, heard by everyone watching it
//   playSfx(dm.sfx)           a line addressed to you, heard by you wherever you stand
//
// Everything else — which sound a gate makes, whether a refusal buzzes — is decided at the
// call site and arrives here as a NAME. That is the point: a sound is a property of the
// thing that happened, not a feature with its own plumbing.
//
// Names are the game's vocabulary, not the library's filenames. `keyhit_01` and `wlocked1`
// say nothing about what they mean here, and the file behind a meaning should be swappable
// without touching a single call site. CUES below is that map, and it is also the list of
// what belongs in web/public/assets/sfx (see its ATTRIBUTION.md).

const CUES = {
  // What an action says back to the person who took it.
  success: "chime",
  "success-soft": "console_success",
  refuse: "keyhit_01",
  "refuse-money": "buzz-two",
  coin: "coin_m",

  // Putting something on.
  "equip-lock": "click",
  "equip-cloth": "rustle1",
  "equip-shield": "shield2",
  "equip-blade": "knife_equip",
  "equip-mail": "body-hauberk-1",
  "equip-gun": "unholster",
  "equip-revolver": "revolver_close",

  // Your own boots. Eight files a piece, picked at random, so walking the map twice does
  // not sound like the same step twice.
  "step-carpet": ["carpet_step1", "carpet_step2", "carpet_step3", "carpet_step4",
    "carpet_step5", "carpet_step6", "carpet_step7", "carpet_step8"],
  "step-wood": ["wood_step2", "wood_step3", "wood_step4", "wood_step5", "wood_step6",
    "wood_step7", "wood_step8"],
  "step-earth": ["dirt1.wav", "dirt2.wav", "dirt3.wav", "dirt4.wav", "grass1.wav",
    "grass2.wav", "grass3.wav", "grass4.wav"],

  // Hands on other people's things.
  loot: "torch_pickup",
  pocket: "zip",
  stash: "drawer_sound",

  // A day's work.
  mine: "gemdrop",
  farm: "seedsplanted",
  smith: "forge",
  craft: "Crowbar",
  write: "sign_this",

  // Hands on somebody.
  heal: "cloth_rip",
  bind: "cablecuff",
  unbind: "axe_sheath",
  harm: "smallstab",
  butcher: "slash",

  // Getting into things.
  "seal-break": "poster_ripped",
  crate: "wood_open",
  dig: "dig_shovel",
  photo: "polaroid1",
  "nuke-arm": "nuke_activator",
  "nuke-ping": "confirm1",

  // At the table.
  eat: "eatfood",
  drink: "glass_drink1",

  // Word reaching you.
  named: "newBuzzer",
  message: "pop",
  held: "net_captured",
  "blade-drawn": "sword_unsheath_01",
  "radio-send": "radio",
  "radio-hear": "radio_chatter",
  page: "pageturn1",

  // The world, heard by the room.
  "gate-open": "wood_open",
  "gate-shut": "wlocked1",
  turret: "warning-buzzer",
  intercom: "radio3",
  gavel: "gavel",
  gunfire: "smg_fire_new",
  alarm: "Alarm",
  bell: "cathedral-bell",
  horn: "crisis",
  lifeweb: "lw_free",
  convert: "oldways_convert",
  initiate: "wonder_secret_known",
  spawn: "wonder",
  teleport: "teleport",
  gib: "squishy",
  boom: "explosionfar3",
  rise: "rebirth",
  quake: "cavein",
  landing: "train_arrive",
  pin: "sign_this",
  tear: "poster_ripped",
  banish: "bishop_banish",
  // The Charon's locks, and the terminal refusing. The forced one is the ship
  // committing to leave; the plain one is that being taken back.
  "airlock-force": "airlock_open_force",
  airlock: "airlock_open",
  "console-refuse": "console_error",
  "rite-loop": "loop_altar",

  // The Den's slot machine. Coins in, then one of three answers.
  "slot-spin": "coin_m",
  "slot-win": "gemdrop",
  "slot-jackpot": "wonder",
  "slot-lose": "newBuzzer",
};

// The cues that do not stop on their own. A rite holds the altar's drone under the room
// from the moment it goes tense until it fires or the window shuts — the only sound in the
// game that is a STATE rather than an event. `maxMs` is the hard stop: a tab that never
// hears the closing line must not be left droning, so the cap is the rite's own grace
// window with slack, and nothing here can outlive it.
const LOOPS = {
  "rite-loop": { maxMs: 8 * 60 * 1000 },
};

// Levels are MEASURED, not guessed. The files come from one library but not one mastering
// session: across the set they span 27dB, so a gain picked by ear on a hot file makes a
// bag of turnips louder than the cathedral bell. Every cue below is scaled so that it
// lands on the target for the kind of thing it is:
//
//   -29  your own boots, heard every time you walk.
//   -26  furniture. You put something on, you moved something, a line went out.
//   -23  a thing you did. A day's work, a hand on somebody, a meal.
//   -20  the world, heard by the room. A gate, a gun, a body coming apart.
//   -16  made to be heard. The alarm, the bell, the horn.
//   -32  the drone.
//
// The number is the file's K-weighted level (BS.1770 pre-filter, peak 50ms window) and the
// gain is 10^((target - measured)/20) — for a cue with several files, off their average, so
// one loud step in eight does not drag the other seven down. So a NEW CUE IS MEASURED AND
// GETS ITS OWN ENTRY: it does not ride the fallback below, which exists only so a forgotten
// one still plays. `named` sits with the world rather than the alarms on purpose — it is a
// notification, not a siren.
const GAIN = {
  // Your own boots.
  "step-carpet": 0.6,
  "step-wood": 0.57,
  "step-earth": 0.54,

  // Furniture.
  "equip-lock": 0.23,
  "equip-cloth": 0.98,
  "equip-shield": 0.13,
  "equip-blade": 0.15,
  "equip-mail": 0.18,
  "equip-gun": 0.56,
  "equip-revolver": 0.18,
  loot: 0.13,
  pocket: 0.32,
  stash: 0.29,
  page: 1,
  photo: 0.19,
  write: 0.15,
  pin: 0.15,
  coin: 0.12,
  "slot-spin": 0.12,
  "slot-win": 0.2,
  "slot-jackpot": 0.24,
  "slot-lose": 0.14,
  "success-soft": 0.18,
  "seal-break": 0.3,
  tear: 0.3,
  refuse: 0.4,
  "refuse-money": 0.12,
  "nuke-ping": 0.31,
  "radio-send": 0.17,
  "radio-hear": 0.23,

  // A thing you did.
  success: 0.16,
  mine: 0.22,
  farm: 0.42,
  smith: 0.18,
  craft: 0.51,
  dig: 0.46,
  heal: 0.42,
  bind: 0.18,
  unbind: 0.27,
  harm: 0.11,
  butcher: 0.16,
  eat: 0.56,
  drink: 1,
  crate: 0.25,
  "nuke-arm": 0.27,

  // The world, heard by the room. `crate` and `gate-open` are the same file at two levels,
  // and so are `write`/`pin` against `seal-break`/`tear` — a box in your hands is not a
  // gate across the zone. The pool is per file but the volume is set per play, so this is
  // an ordinary thing to want.
  "gate-open": 0.35,
  "gate-shut": 0.43,
  spawn: 0.34,
  convert: 0.34,
  initiate: 0.29,
  teleport: 0.38,
  lifeweb: 0.14,
  rise: 0.34,
  quake: 0.32,
  landing: 0.21,
  gib: 0.52,
  boom: 0.28,
  gunfire: 0.14,
  turret: 0.36,
  named: 0.27,
  gavel: 0.22,
  // -6.65 measured, the hottest file in the folder after the gavel.
  banish: 0.22,
  // The Charon. -6.58 and -9.34 measured, both to the world's -20; the forced
  // airlock is the hottest file in the folder, which is about right for a ship
  // deciding to leave. The terminal's refusal goes to the refusal target at
  // -26 instead, off -10.83 — it answers one person, not the room.
  "airlock-force": 0.21,
  airlock: 0.29,
  "console-refuse": 0.17,
  // Addressed to one person. These arrive on a DM rather than on a line a place said, and
  // they sit with the world rather than the alarms for the same reason `named` does.
  held: 1,
  "blade-drawn": 0.19,

  // Heard every time somebody speaks, so it lives down with the boots. `pop` is the
  // quietest file in the library and still only just clears the floor at this target.
  message: 1,

  // Made to be heard. The intercom belongs here and not with the world: a PA is a
  // loudspeaker, which is the same argument db/lib/intercom.js makes for its full-size text.
  intercom: 0.43,
  alarm: 0.48,
  bell: 0.77,
  horn: 0.37,

  // The drone.
  "rite-loop": 0.16,
};

// A held key or a double-click must not machine-gun. Per NAME, not global: mining while a
// gate opens is two different things happening, and both should be heard. The global floor
// underneath it is what stops a burst of scene rows arriving at once from sounding like a
// fire drill.
const FLOOR_MS = 120;
const BURST = { max: 4, window: 500 };
const lastPlayed = new Map();
let recent = [];

// A backgrounded tab narrating a town somebody is not reading is how a person mutes the
// site for good. Only being named reaches you when the tab is behind something else —
// that one is a notification, which is the whole point of it.
const THROUGH_A_HIDDEN_TAB = new Set(["named"]);

// Three elements per cue, cycled. One would cut itself off mid-sound on a quick repeat,
// which is audibly worse than two overlapping.
const POOL = 3;
const pools = new Map();

// Browsers refuse audio until the page has seen a real gesture, so the first sound of a
// session is dropped however loud the volume is. Nothing to be done about that but wait
// for the gesture — never a "click to enable sound" dialog, which spends a modal on
// something that fixes itself the moment somebody uses the page.
let armed = false;

function arm() {
  armed = true;
  window.removeEventListener("pointerdown", arm);
  window.removeEventListener("keydown", arm);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
}

// A cue may name one file or several. Several means pick one per play, which is what keeps
// a footstep from being a metronome. The extension is .ogg unless the name carries its own
// — the dirt and grass steps are the library's only wavs.
function fileFor(name) {
  const entry = CUES[name];
  if (!entry) return null;
  return Array.isArray(entry) ? entry[Math.floor(Math.random() * entry.length)] : entry;
}

function src(file) {
  return `/assets/sfx/${file.includes(".") ? file : `${file}.ogg`}`;
}

function pool(file) {
  let list = pools.get(file);
  if (!list) {
    list = { next: 0, tracks: [] };
    for (let i = 0; i < POOL; i += 1) {
      const track = new window.Audio(src(file));
      track.preload = "auto";
      list.tracks.push(track);
    }
    pools.set(file, list);
  }
  return list;
}

/**
 * Play a cue by name. Silently does nothing for an unknown name, on the server, before the
 * page has been clicked, or while the listener has sound off — every caller can hand this
 * whatever it has without checking first.
 */
export function playSfx(name) {
  if (!name || typeof window === "undefined" || !armed) return;
  const file = fileFor(name);
  if (!file) return;

  const { on, volume } = soundSetting();
  if (!on || volume <= 0) return;
  if (document.visibilityState !== "visible" && !THROUGH_A_HIDDEN_TAB.has(name)) return;

  // A drone, not an event. Starting one already running is a no-op rather than a second
  // copy — two lines about the same rite must not stack two altars.
  if (LOOPS[name]) {
    startLoop(name, file, volume);
    return;
  }
  // Any ordinary cue in the same breath as a drone means the moment the drone was waiting
  // for has arrived: the rite fired, somebody died, the room moved on. Stop it.
  stopSfxLoops();

  const now = Date.now();
  if (now - (lastPlayed.get(name) ?? 0) < FLOOR_MS) return;
  recent = recent.filter((at) => now - at < BURST.window);
  if (recent.length >= BURST.max) return;
  lastPlayed.set(name, now);
  recent.push(now);

  try {
    const list = pool(file);
    const track = list.tracks[list.next];
    list.next = (list.next + 1) % list.tracks.length;
    track.volume = Math.min(1, Math.max(0, volume * (GAIN[name] ?? 0.7)));
    track.currentTime = 0;
    // A refused play is the browser's business, not the player's. Swallowed, never surfaced.
    const started = track.play();
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    // An element that will not build (no codec, storage refused) is not worth an error.
  }
}

// --- the drones ------------------------------------------------------------------------
const running = new Map();

function startLoop(name, file, volume) {
  if (running.has(name)) return;
  try {
    const track = new window.Audio(src(file));
    track.loop = true;
    track.volume = Math.min(1, Math.max(0, volume * (GAIN[name] ?? 0.45)));
    const stop = window.setTimeout(() => stopSfxLoop(name), LOOPS[name].maxMs);
    running.set(name, { track, stop });
    const started = track.play();
    if (started && typeof started.catch === "function") started.catch(() => stopSfxLoop(name));
  } catch {
    // Same as above: an element that will not build is not worth an error.
  }
}

/** Stop one drone. Safe to call for a name that is not running. */
export function stopSfxLoop(name) {
  const held = running.get(name);
  if (!held) return;
  running.delete(name);
  window.clearTimeout(held.stop);
  try {
    held.track.pause();
    held.track.removeAttribute("src");
  } catch {
    // Nothing to do about a track that will not stop; it is already off the map.
  }
}

/**
 * Stop every drone. Called when an ordinary cue plays, when the reader moves to another
 * place, and when the tab goes behind something else — a drone belongs to the room being
 * read, and the moment that stops being true it should be silent.
 */
export function stopSfxLoops() {
  for (const name of [...running.keys()]) stopSfxLoop(name);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stopSfxLoops();
  });
}

/** Every cue name, for the settings surface and for tests. */
export function cueNames() {
  return Object.keys(CUES);
}
