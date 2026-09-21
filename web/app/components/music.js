"use client";

import { soundSetting } from "./soundStore";

// The music bus. Full write-up in docs/systemdocs/SOUND.md — this header is only what you
// need to read the file.
//
// NOT part of sfx.js, and it never should be. That module plays events: a cue is short,
// it is rate limited, it is dropped in a hidden tab, and its one drone is killed by the
// next ordinary cue and capped by `maxMs`. Every one of those rules is right for a rite
// and fatal for a soundtrack.
//
// FOUR LAYERS, lowest priority first. The highest layer holding a track is the one you
// hear; every layer under it ducks to SILENCE rather than stopping, so when the thing
// above ends, the thing below is still where you left it.
//
//   ambient   the default bed — wind, room tone
//   music     event and situation music — the lobby, a special room, a sting
//   room      a jukebox, a gramophone: something switched on in the room
//   player    somebody playing a piano or a guitar
//
// Player beats room because a person playing an instrument in front of you is nearer than
// furniture in the corner, and because it is something somebody is DOING.
//
// Only `ambient` and `music` have callers today (musicProgram.js). `room` and `player`
// are reachable by playOn("room", …) and wired into the priority rule; that is the whole
// of the scaffolding and it costs three strings.
//
// MUTING IS A DUCK, NOT A STOP. The music switch pulls the master gain to silence and
// leaves every layer exactly as it was — same track, same place, same tape — so unmuting
// picks up where the listener would be now, not from the top. See setMusicMuted().
//
// ANCHORS say what "where you would be now" means for a track. A `local` track (the
// default) is a private tape: pause it and it waits for you. An anchored track —
// `anchor: { startedAt }` — is somebody else's performance, a lute or a jukebox, and it
// does not wait: whenever it comes back into earshot (unmute, the layer above it ending,
// walking in halfway through) it is sought to `now - startedAt` first. positionFor() is
// the one place that answers the question.
//
// WEB AUDIO, with <audio> elements as the sources. Everything here is a fade — 3s in, 4s
// out, 5s out, 1s in, plus the crossfade on takeover — and a GainNode ramp is scheduled
// on the audio clock, where a busy main thread cannot make it stutter. The element stays
// because it STREAMS: white_waking is 4 MB and would be ~40 MB of resident float PCM
// through decodeAudioData, and the element hands over `duration`, `currentTime` (this is
// how the 0:18 resume works) and `ended` for nothing.

export const LAYERS = ["ambient", "music", "room", "player"];

// What a layer does while something above it is playing. The bed keeps rolling, because a
// wind loop restarted at 0:00 under a jukebox is audible; everything else pauses, because
// a 4 MB song should not stream through ten silent minutes of somebody's data plan.
const LAYER_MODE = { ambient: "continue", music: "pause", room: "pause", player: "pause" };

const CROSSFADE_MS = 1200;
const MUTE_FADE_MS = 400;
// How far an element may sit from where it ought to be before resuming it seeks. Wider
// than a seek's own landing error, or resume() would seek, land 50ms off, and seek again.
const DRIFT_S = 1;
const BASE = "/assets/music/";

// ---------------------------------------------------------------- the arming gate

// Browsers refuse audio until the page has seen a real gesture. sfx.js has its own copy of
// this, deliberately: it needs a boolean and this needs to resume() an AudioContext inside
// the handler itself (iOS will not take it a tick later). Exporting a mutable `armed` out
// of sfx.js would be a worse coupling than these few lines. Leave them duplicated.
let armed = false;
const armWaiters = new Set();

function arm() {
  if (armed) return;
  armed = true;
  ensureContext()?.resume?.().catch(() => {});
  window.removeEventListener("pointerdown", arm);
  window.removeEventListener("keydown", arm);
  for (const cb of [...armWaiters]) {
    armWaiters.delete(cb);
    cb();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", arm);
  window.addEventListener("keydown", arm);
  // A locked phone suspends the context; coming back should not mean silence forever.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx?.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  });
}

export function musicArmed() {
  return armed;
}

/** Run `cb` once a gesture has landed — immediately if one already has. Returns a cancel. */
export function onArmed(cb) {
  if (armed) {
    cb();
    return () => {};
  }
  armWaiters.add(cb);
  return () => armWaiters.delete(cb);
}

// ---------------------------------------------------------------- the graph

let ctx = null;
let masterGain = null;
let muted = false;
const layers = new Map();

// What the master gain should be: the slider, or nothing while the music switch is off.
function masterLevel() {
  return muted ? 0 : soundSetting().volume;
}

function rampMaster(to, ms) {
  if (!ctx || !masterGain) return false;
  const now = ctx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(to, now + ms / 1000);
  return true;
}

function ensureContext() {
  if (ctx !== null) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  // No Web Audio: ramp() falls back to the element's own volume. One branch, not a second
  // engine — see ramp().
  if (!Ctor) {
    ctx = false;
    return null;
  }
  ctx = new Ctor();
  masterGain = ctx.createGain();
  masterGain.gain.value = masterLevel();
  masterGain.connect(ctx.destination);
  return ctx;
}

function state(layer) {
  let entry = layers.get(layer);
  if (entry) return entry;

  const el = new window.Audio();
  el.preload = "none";
  // Never a <link rel="preload">: that would pull megabytes on every page view for a
  // phase most viewers are not in. warm() is the only prefetch, and a program asks for it.
  el.crossOrigin = "anonymous";

  entry = {
    el,
    gainNode: null,
    src: null,
    wanted: null,
    // "local", or { startedAt } in epoch ms. See the header and positionFor().
    anchor: "local",
    startAt: 0,
    endedListeners: new Set(),
    fallbackRamp: null,
    // True between "we have asked to be at 0:18" and the element actually being there.
    // applyPriority() will not press play while it is set — see seekTo().
    seeking: false,
  };

  const audio = ensureContext();
  if (audio) {
    entry.gainNode = audio.createGain();
    entry.gainNode.gain.value = 0;
    // Once an element is routed through a source node its output goes ONLY through the
    // graph. element.volume still multiplies, so it is pinned at 1 and never touched again.
    el.volume = 1;
    audio.createMediaElementSource(el).connect(entry.gainNode);
    entry.gainNode.connect(masterGain);
  } else {
    el.volume = 0;
  }

  el.addEventListener("ended", () => {
    for (const cb of [...entry.endedListeners]) cb();
  });

  layers.set(layer, entry);
  return entry;
}

// Ramp a layer's gain to `to` over `ms`. Web Audio where we have it; a rAF loop on
// element.volume where we do not.
function ramp(entry, to, ms) {
  const audio = ctx || null;
  if (entry.gainNode && audio) {
    const g = entry.gainNode.gain;
    const now = audio.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (ms <= 0) g.setValueAtTime(to, now);
    else g.linearRampToValueAtTime(to, now + ms / 1000);
    return;
  }
  if (entry.fallbackRamp) cancelAnimationFrame(entry.fallbackRamp);
  const from = entry.el.volume;
  const started = performance.now();
  const master = masterLevel();
  const step = () => {
    const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - started) / ms);
    entry.el.volume = Math.min(1, Math.max(0, (from + (to - from) * t) * master));
    entry.fallbackRamp = t < 1 ? requestAnimationFrame(step) : null;
  };
  step();
}

function topLayerIndex() {
  let top = -1;
  for (let i = 0; i < LAYERS.length; i += 1) {
    if (layers.get(LAYERS[i])?.wanted) top = i;
  }
  return top;
}

// Which layer is audible, and what every other one does about it. This is the whole
// priority rule: a bus mixer's "snapshot", in twenty lines.
function applyPriority() {
  const top = topLayerIndex();
  LAYERS.forEach((layer, i) => {
    const entry = layers.get(layer);
    if (!entry?.wanted) return;
    if (i === top) {
      if (entry.seeking) return;
      ramp(entry, entry.wanted.gain, entry.wanted.fadeInMs ?? CROSSFADE_MS);
      // Muted, a song waits paused where it is (a 4 MB file should not stream to nobody);
      // the bed keeps rolling silently, which is what keeps it in time.
      if (muted && LAYER_MODE[layer] === "pause") {
        if (!entry.el.paused) entry.el.pause();
        return;
      }
      if (entry.el.paused) resume(entry);
      return;
    }
    // Ducked. Equal-power would matter if two beds crossed; between a bed and a song
    // over it, what matters is that the lower one does not stop.
    ramp(entry, 0, CROSSFADE_MS);
    if (LAYER_MODE[layer] === "pause") {
      window.setTimeout(() => {
        if (!entry.wanted || entry.el.paused) return;
        if (LAYERS.indexOf(layer) !== topLayerIndex()) entry.el.pause();
      }, CROSSFADE_MS);
    }
  });
}

// Where this track ought to be, in seconds, right now. `undefined` for a local track —
// it is wherever it is. For an anchored one, the performance's own clock; `null` once a
// non-looping performance has finished, so there is nothing left to hear.
function positionFor(entry) {
  if (entry.anchor === "local") return undefined;
  const at = (Date.now() - entry.anchor.startedAt) / 1000 + entry.startAt;
  const total = entry.el.duration;
  if (!Number.isFinite(total) || total <= 0) return Math.max(0, at);
  if (entry.el.loop) return ((at % total) + total) % total;
  return at >= total ? null : Math.max(0, at);
}

// Move an element to `target` (seconds, or a function answering it once metadata is in),
// then let applyPriority() decide whether it plays. The seek has to land BEFORE the first
// frame is heard: `currentTime` cannot be set until metadata is in, so a naive version
// starts at 0:00, seeks a moment later, and leaks the very audio the seek exists to skip.
// applyPriority() holds off while `seeking` is set.
function seekTo(entry, target) {
  entry.seeking = true;
  const go = () => {
    const done = () => {
      entry.seeking = false;
      applyPriority();
    };
    const at = typeof target === "function" ? target() : target;
    if (at == null) {
      done();
      return;
    }
    entry.el.addEventListener("seeked", done, { once: true });
    try {
      entry.el.currentTime = at;
    } catch {
      // Past the end, or a stream that will not seek. Better the intro than silence.
      entry.el.removeEventListener("seeked", done);
      done();
    }
  };
  if (entry.el.readyState >= 1) go();
  else entry.el.addEventListener("loadedmetadata", go, { once: true });
}

// Bring a paused element back into earshot. Every path that un-pauses goes through here —
// unmute, the layer above ending, the first gesture — so an anchored track is never
// resumed at the place it was left, only at the place its performance has reached.
function resume(entry) {
  const at = positionFor(entry);
  if (at === null) {
    // The performance ended while nobody was listening. Tell the tape, as `ended` would.
    for (const cb of [...entry.endedListeners]) cb();
    return;
  }
  if (at !== undefined && Math.abs(entry.el.currentTime - at) > DRIFT_S) {
    seekTo(entry, () => positionFor(entry));
    return;
  }
  entry.el.play().catch(() => {});
}

// ---------------------------------------------------------------- the API

/** Put a track on a layer. Returns at once; the fade and the priority pass are scheduled. */
export function playOn(
  layer,
  { src, startAt = 0, loop = false, gain = 1, fadeInMs = 0, anchor = "local" } = {},
) {
  if (typeof window === "undefined" || !src) return;
  const entry = state(layer);
  const url = src.startsWith("/") ? src : `${BASE}${src}`;

  entry.wanted = { src: url, gain, fadeInMs };
  entry.anchor = anchor && typeof anchor.startedAt === "number" ? { startedAt: anchor.startedAt } : "local";
  entry.startAt = startAt;
  if (entry.src !== url) {
    entry.src = url;
    entry.el.src = url;
    entry.el.preload = "auto";
    entry.el.load();
  }
  entry.el.loop = loop;

  // An anchored track starts wherever the performance has got to; a local one at startAt.
  // A finished performance answers null, and seekTo hands that to resume(), which ends it.
  if (entry.anchor !== "local") seekTo(entry, () => positionFor(entry));
  else if (startAt > 0) seekTo(entry, startAt);
  else entry.seeking = false;

  ramp(entry, 0, 0);
  // Queued behind the gesture rather than dropped, so the first click drops the listener
  // into the schedule mid-stride instead of restarting the tape.
  onArmed(() => {
    if (entry.wanted?.src !== url) return;
    applyPriority();
  });
}

/** Take a layer off. Ramps its gain down over `fadeMs`, then pauses and releases it. */
export function stopLayer(layer, { fadeMs = 0 } = {}) {
  const entry = layers.get(layer);
  if (!entry?.wanted) return;
  entry.wanted = null;
  ramp(entry, 0, fadeMs);
  window.setTimeout(() => {
    if (entry.wanted) return;
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    entry.src = null;
  }, fadeMs);
  applyPriority();
}

/**
 * Schedule a fade-out that ENDS when the track does — the lobby's 5-second tail. Read off
 * `duration` once metadata lands rather than guessed, so a track nobody re-measured after
 * a re-encode still fades in the right place.
 */
export function fadeOutAtEnd(layer, fadeMs) {
  const entry = layers.get(layer);
  if (!entry || fadeMs <= 0) return () => {};
  let timer = null;
  const schedule = () => {
    const total = entry.el.duration;
    if (!Number.isFinite(total)) return;
    const left = (total - entry.el.currentTime) * 1000 - fadeMs;
    timer = window.setTimeout(
      () => {
        if (entry.wanted && topLayerIndex() === LAYERS.indexOf(layer)) ramp(entry, 0, fadeMs);
      },
      Math.max(0, left),
    );
  };
  if (entry.el.readyState >= 1) schedule();
  else entry.el.addEventListener("loadedmetadata", schedule, { once: true });
  return () => {
    if (timer) window.clearTimeout(timer);
  };
}

/**
 * Call `cb` once the layer's track has actually been PLAYED this far through, as a
 * fraction of its duration. Off `currentTime`, not a timer, so a buffering phone or a
 * ducked layer counts what was heard rather than what was scheduled. Fires at most once,
 * and never if the listener is dropped first — which is the point: a player who closes the
 * page halfway through was not woken. Returns an unsubscribe.
 */
export function onPlayedFraction(layer, fraction, cb) {
  const entry = state(layer);
  let done = false;
  const check = () => {
    if (done) return;
    const total = entry.el.duration;
    if (!Number.isFinite(total) || total <= 0) return;
    if (entry.el.currentTime / total < fraction) return;
    done = true;
    entry.el.removeEventListener("timeupdate", check);
    cb();
  };
  entry.el.addEventListener("timeupdate", check);
  return () => {
    done = true;
    entry.el.removeEventListener("timeupdate", check);
  };
}

/**
 * Fires once the layer's track has played at least `seconds` of itself. Returns an
 * unsubscribe. The same shape as onPlayedFraction, but an absolute bar — for a threshold
 * that should not scale with how long the file happens to be.
 */
export function onPlayedSeconds(layer, seconds, cb) {
  const entry = state(layer);
  let done = false;
  const check = () => {
    if (done) return;
    if (!(entry.el.currentTime >= seconds)) return;
    done = true;
    entry.el.removeEventListener("timeupdate", check);
    cb();
  };
  entry.el.addEventListener("timeupdate", check);
  return () => {
    done = true;
    entry.el.removeEventListener("timeupdate", check);
  };
}

/** Called when the layer's track ends. Returns an unsubscribe. */
export function onEnded(layer, cb) {
  const entry = state(layer);
  entry.endedListeners.add(cb);
  return () => entry.endedListeners.delete(cb);
}

/** The master trim, 0..1. Ramped briefly so dragging the slider is not zippery. */
export function setMasterVolume() {
  ensureContext();
  if (rampMaster(masterLevel(), 80)) return;
  // No Web Audio: the master is folded into each element by ramp(); nudge the audible one.
  const top = topLayerIndex();
  if (top < 0) return;
  const entry = layers.get(LAYERS[top]);
  if (entry) entry.el.volume = Math.min(1, Math.max(0, (entry.wanted?.gain ?? 1) * masterLevel()));
}

/**
 * The music switch. Muting pulls the master to silence and touches nothing else — no
 * track is stopped, no tape is rewound — then pauses the songs once they are inaudible so
 * they stop streaming. Unmuting brings the master back and lets resume() put each layer
 * where it belongs: a local track where it was left, an anchored one where it has got to.
 */
export function setMusicMuted(next) {
  const want = Boolean(next);
  if (want === muted) return;
  muted = want;
  ensureContext();
  if (!rampMaster(masterLevel(), MUTE_FADE_MS)) setMasterVolume();
  if (muted) {
    window.setTimeout(() => {
      if (!muted) return;
      for (const [layer, entry] of layers) {
        if (entry.wanted && LAYER_MODE[layer] === "pause" && !entry.el.paused) entry.el.pause();
      }
    }, MUTE_FADE_MS);
    return;
  }
  onArmed(applyPriority);
}

/** Fetch a file without playing it, so a fade-in is not a buffering pause. */
export function warm(src) {
  if (typeof window === "undefined" || !src) return;
  const url = src.startsWith("/") ? src : `${BASE}${src}`;
  const el = new window.Audio();
  el.preload = "auto";
  el.src = url;
  el.load();
}

/**
 * Everything off, now. For when there is nothing that SHOULD be playing — no phase, a GM
 * desk. Never for the mute switch: that is setMusicMuted(), which keeps the place.
 */
export function stopAllMusic({ fadeMs = 400 } = {}) {
  for (const layer of LAYERS) stopLayer(layer, { fadeMs });
}
