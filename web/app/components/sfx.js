"use client";

import { onSoundChange, soundSetting } from "./soundStore";

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
  // The bomb's keypad (docs/systemdocs/NUKE.md §3): a button pressed for every key,
  // the machine's tones when the sequence is right, a countdown for arming, and the
  // old arming clunk — "something mechanical unsealing" — for taking it back.
  // A wrong sequence is the terminal's warble, `console-refuse`.
  "nuke-key": ["keyhit_02", "keyhit_03", "keyhit_04", "keyhit_05", "keyhit_06"],
  "nuke-ping": "beep5",
  "nuke-arm": "countdown",
  "nuke-disarm": "nuke_activator",

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
  "convert-ask": "they_contact1",
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

  // The telephone. The library's own phone sounds, plus two borrowed: the
  // cradle is the UI click, because OpenSourceWeb never recorded one, and a
  // number that goes nowhere is the terminal's warble. `phone-ring-far` is the
  // same bell one Location away, heard through the walls: its own file, the bell
  // run through a lowpass (scripts/audio/build-assets.sh), so it is muffled and
  // not merely quieter.
  "phone-ring": "phone_ring",
  "phone-ring-far": "phone_ring_far",
  "phone-error": "console_error",
  "phone-calling": "phone_calling",
  "phone-pickup": "phone_pickup",
  "phone-busy": "phone_busy",
  "phone-drop": "click",
  "coin-insert": "coininsert",

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
//   -40  somewhere else. A phone ringing a Location over, through the walls.
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
  // The bomb's keypad. Each key is the refusal's own family of file (keyhit_01),
  // but pressed eight times running, so it sits down with the boots at -29 off the
  // pool's average (-15.98); the green light is furniture at -23, off -3.91.
  "nuke-key": 0.22,
  "nuke-ping": 0.11,
  "radio-send": 0.17,
  "radio-hear": 0.23,

  // The telephone, all but the bell. These are heard by one person with a
  // receiver against their ear, so they sit with the furniture however loud
  // the file is — and two of these files are the hottest in the folder.
  "phone-calling": 0.06,
  "phone-busy": 0.06,
  "phone-pickup": 0.16,
  "phone-drop": 0.16,
  "coin-insert": 0.1,
  // The terminal's warble, at the level console-refuse already measured it at.
  "phone-error": 0.17,
  // The bell through a wall, and barely: -40, under everything on this list and
  // eight below the drone, 24dB under the ring it comes from. Somebody listening
  // for it catches it in a quiet moment; nobody else notices it at all. The
  // lowpass already took the file to -35.6 against the bell's -8.4.
  "phone-ring-far": 0.6,

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
  // Arming is -20 off -6.45, the level the old arming clunk played at; that clunk
  // now disarms, at the gain it already had.
  "nuke-arm": 0.21,
  "nuke-disarm": 0.27,

  // The world, heard by the room. `crate` and `gate-open` are the same file at two levels,
  // and so are `write`/`pin` against `seal-break`/`tear` — a box in your hands is not a
  // gate across the zone. The pool is per file but the volume is set per play, so this is
  // an ordinary thing to want.
  "gate-open": 0.35,
  "gate-shut": 0.43,
  spawn: 0.34,
  convert: 0.34,
  "convert-ask": 0.4,
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
  //
  // A DELIBERATE OVERRIDE, and the only one in this table: the derived value is 1
  // (pop measures under the -26 tier, so the formula clamps), and this is that
  // judged BY EAR to be too loud for a cue that fires every time anybody speaks.
  // A third as loud, which is 10*log2(1/3) = -15.85 dB and so 10^(-15.85/20).
  // Do NOT "fix" this back to the measured value: re-running scripts/audio/measure.sh
  // will say 1 and be right about the measurement and wrong about the room.
  message: 0.161,

  // Made to be heard. The intercom belongs here and not with the world: a PA is a
  // loudspeaker, which is the same argument db/lib/intercom.js makes for its full-size text.
  intercom: 0.43,
  // The bell of a telephone, and the one phone cue up here rather than down
  // with the furniture: it is the only one nobody is holding a receiver for.
  // It has to carry across a room somebody is not looking at, which is the
  // same job the alarm below has.
  "phone-ring": 0.4,
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
// Keys under a finger: each one still keeps the per-name floor, but none of them counts
// toward the burst or is stopped by it. Eight digits pressed out at speed are four in
// every half second, and the machine's answer to the eighth — its green-light tones, or
// its warble — would be the fifth, and silently dropped (docs/systemdocs/NUKE.md §3).
const OUTSIDE_THE_BURST = new Set(["nuke-key"]);
const lastPlayed = new Map();
let recent = [];

// A backgrounded tab narrating a town somebody is not reading is how a person mutes the
// site for good. Only being named reaches you when the tab is behind something else —
// that one is a notification, which is the whole point of it.
//
// A ringing phone is the second, on the same argument: a tab that stayed quiet through
// it has cost somebody the call. It is also the one cue a player is MEANT to be
// interrupted by — the whole point of a phone is that it reaches you when you were doing
// something else. The phone's held tones (below) keep to the same rule.
const THROUGH_A_HIDDEN_TAB = new Set(["named", "phone-ring"]);

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
  // A phone that started ringing before the first click is still ringing.
  applyPhoneTones();
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

  const { sfx: on, volume } = soundSetting();
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
  const bursty = !OUTSIDE_THE_BURST.has(name);
  recent = recent.filter((at) => now - at < BURST.window);
  if (bursty && recent.length >= BURST.max) return;
  lastPlayed.set(name, now);
  if (bursty) recent.push(now);

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

// MUSIC DOES THE OPPOSITE, ON PURPOSE (./music.js). A drone belongs to a room somebody is
// reading, so a hidden tab should not be droning at an empty chair. A soundtrack belongs to
// the session, and one that cuts out the moment you check Discord is worse than one that
// does not — the player has a mute button in the top bar for that. Do not unify these two
// handlers; they are answering different questions.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stopSfxLoops();
  });
}

// --- the telephone's held tones --------------------------------------------------------
//
// A phone makes three sounds that are STATES rather than events (PHONES.md §8): the bell
// while it rings, the long tone a caller hears until somebody picks up, and the busy tone
// of a line the far end hung up on. They are not the drones above, on purpose. A drone
// belongs to the room being read and any ordinary cue stops it; a ringing phone must keep
// ringing through the `message` pop of every line said beside it, and through a hidden
// tab, until the thing it is waiting for happens. So these live on their own map, set as a
// whole from the feed's `phones` frame (web/lib/phoneFrame.js) and never touched by
// playSfx, stopSfxLoops or the visibility handler.
//
// Two slots, one track each: `ring` is phone-ring or phone-ring-far (the bell here, or one
// Location over), `handset` is phone-calling or phone-busy (what is at your own ear).
// null in a slot is silence.
const tones = new Map();
let wantedTones = { ring: null, handset: null };

function applyPhoneTones() {
  if (typeof window === "undefined") return;
  const { sfx: on, volume } = soundSetting();
  for (const slot of ["ring", "handset"]) {
    const cue = armed && on && volume > 0 ? wantedTones[slot] : null;
    const held = tones.get(slot);
    if (held && held.cue === cue) {
      held.track.volume = Math.min(1, Math.max(0, volume * (GAIN[cue] ?? 0.45)));
      continue;
    }
    if (held) {
      tones.delete(slot);
      try {
        held.track.pause();
        held.track.removeAttribute("src");
      } catch {
        // Already off the map; nothing else to do.
      }
    }
    const file = cue ? fileFor(cue) : null;
    if (!file) continue;
    try {
      const track = new window.Audio(src(file));
      track.loop = true;
      track.volume = Math.min(1, Math.max(0, volume * (GAIN[cue] ?? 0.45)));
      tones.set(slot, { cue, track });
      const started = track.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    } catch {
      // An element that will not build is not worth an error.
    }
  }
}

/**
 * Set what the telephone is holding in this tab: `{ ring, handset }`, each a cue name or
 * null. Idempotent — the same state twice leaves a playing tone where it is rather than
 * restarting it, so a frame that changes nothing is silent.
 */
export function setPhoneTones({ ring = null, handset = null } = {}) {
  wantedTones = { ring, handset };
  applyPhoneTones();
}

if (typeof window !== "undefined") {
  // The speaker switch and the slider reach a tone that is already playing.
  onSoundChange(applyPhoneTones);
}

/** Every cue name, for the settings surface and for tests. */
export function cueNames() {
  return Object.keys(CUES);
}
