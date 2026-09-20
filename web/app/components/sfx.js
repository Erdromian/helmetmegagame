"use client";

import { soundSetting } from "@/app/(app)/chat/soundStore";

// The whole of sound in Bascinet. Two callers, and only two:
//
//   playSfx("mine")           an action you took, heard in your tab alone
//   playSfx(row.sfx)          a line a place said, heard by everyone watching it
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

  // A day's work.
  mine: "gemdrop",
  farm: "seedsplanted",
  smith: "forge",
  craft: "Crowbar",
  write: "sign_this",

  // Hands on somebody.
  heal: "cloth_rip",
  bind: "cablecuff",
  harm: "smallstab",

  // At the table.
  eat: "eatfood",
  drink: "glass_drink1",

  // Word reaching you.
  named: "newBuzzer",
  "radio-send": "radio",
  "radio-hear": "radio_chatter",
  page: "pageturn1",

  // The world, heard by the room.
  "gate-open": "wood_open",
  "gate-shut": "wlocked1",
  turret: "warning-buzzer",
  alarm: "Alarm",
  horn: "crisis",
  lifeweb: "lw_free",
  convert: "oldways_convert",
  spawn: "wonder",
};

// Two of these are LOUD on purpose and the rest are furniture. A quiet cue at the same
// gain as an alarm either buries the cue or makes the alarm a joke, so each carries its
// own level, multiplied by the listener's volume.
const GAIN = {
  alarm: 1,
  horn: 1,
  turret: 0.9,
  named: 0.8,
  refuse: 0.5,
  "refuse-money": 0.6,
  "equip-lock": 0.6,
  "equip-cloth": 0.6,
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

function pool(file) {
  let list = pools.get(file);
  if (!list) {
    list = { next: 0, tracks: [] };
    for (let i = 0; i < POOL; i += 1) {
      const track = new window.Audio(`/assets/sfx/${file}.ogg`);
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
  const file = CUES[name];
  if (!file) return;

  const { on, volume } = soundSetting();
  if (!on || volume <= 0) return;
  if (document.visibilityState !== "visible" && !THROUGH_A_HIDDEN_TAB.has(name)) return;

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

/** Every cue name, for the settings surface and for tests. */
export function cueNames() {
  return Object.keys(CUES);
}
