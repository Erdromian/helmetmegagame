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
const layers = new Map();

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
  masterGain.gain.value = soundSetting().volume;
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
    endedListeners: new Set(),
    fallbackRamp: null,
    // True between "we have asked to start at 0:18" and the element actually being
    // there. applyPriority() will not press play while it is set — see playOn().
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
  const master = soundSetting().volume;
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
      if (entry.el.paused) entry.el.play().catch(() => {});
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

// ---------------------------------------------------------------- the API

/** Put a track on a layer. Returns at once; the fade and the priority pass are scheduled. */
export function playOn(layer, { src, startAt = 0, loop = false, gain = 1, fadeInMs = 0 } = {}) {
  if (typeof window === "undefined" || !src) return;
  const entry = state(layer);
  const url = src.startsWith("/") ? src : `${BASE}${src}`;

  entry.wanted = { src: url, gain, fadeInMs };
  if (entry.src !== url) {
    entry.src = url;
    entry.el.src = url;
    entry.el.preload = "auto";
    entry.el.load();
  }
  entry.el.loop = loop;

  // The seek has to land BEFORE the first frame is heard. `currentTime` cannot be set
  // until metadata is in, so a naive version starts at 0:00, seeks a moment later, and
  // leaks exactly the few milliseconds of intro the 0:18 offset exists to skip.
  // applyPriority() holds off while `seeking` is set, and the seek itself calls it.
  if (startAt > 0) {
    entry.seeking = true;
    const seek = () => {
      const done = () => {
        entry.seeking = false;
        applyPriority();
      };
      entry.el.addEventListener("seeked", done, { once: true });
      try {
        entry.el.currentTime = startAt;
      } catch {
        // Past the end, or a stream that will not seek. Better the intro than silence.
        entry.el.removeEventListener("seeked", done);
        done();
      }
    };
    if (entry.el.readyState >= 1) seek();
    else entry.el.addEventListener("loadedmetadata", seek, { once: true });
  } else {
    entry.seeking = false;
  }

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

/** Called when the layer's track ends. Returns an unsubscribe. */
export function onEnded(layer, cb) {
  const entry = state(layer);
  entry.endedListeners.add(cb);
  return () => entry.endedListeners.delete(cb);
}

/** The master trim, 0..1. Ramped briefly so dragging the slider is not zippery. */
export function setMasterVolume(value) {
  const audio = ensureContext();
  const level = Math.min(1, Math.max(0, Number(value) || 0));
  if (audio && masterGain) {
    const now = audio.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(level, now + 0.08);
    return;
  }
  // No Web Audio: the master is folded into each element by ramp(); nudge the audible one.
  const top = topLayerIndex();
  if (top < 0) return;
  const entry = layers.get(LAYERS[top]);
  if (entry) entry.el.volume = Math.min(1, Math.max(0, (entry.wanted?.gain ?? 1) * level));
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

/** Everything off, now. The director calls this when music is muted. */
export function stopAllMusic({ fadeMs = 400 } = {}) {
  for (const layer of LAYERS) stopLayer(layer, { fadeMs });
}
