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
// SEVEN LAYERS, lowest priority first. The highest layer holding a track is the one you
// hear; every layer under it ducks to SILENCE rather than stopping, so when the thing
// above ends, the thing below is still where you left it.
//
//   ambient   the bed the PLACE has — wind outside, a drone in the Depths, the
//             Cathedral's organ room every few minutes (placeAmbience.js)
//   spot      a short sound laid OVER that bed: a gull, a gust, a chapel tone
//   music     the lobby's track — the one place a track simply plays, always
//   event     a siren, an alarm, a thing arriving. Loud and brief
//   room      a jukebox, a gramophone: something switched on in the room
//   player    somebody playing an instrument, one voice each
//   dose      the song of a drug, the moment it is taken (musicConductor.js#interrupt)
//
// Player beats room because a person playing an instrument in front of you is nearer than
// furniture in the corner, and because it is something somebody is DOING. A dose beats
// everything because it is inside your own head: while it plays, the place's bed, its
// spots, the Den's jukebox and anybody's lute all go silent for the one who took it, and
// come back when the song ends. Nothing coexists under it.
//
// THREE RULES ON TOP OF THAT:
//
//   `room` and `player` are MUTUALLY EXCLUSIVE. Starting one stops the other. One
//   jukebox or one lute, never a fight between them.
//
//   `event` COEXISTS with them rather than losing to them. A siren does not stop being
//   a siren because somebody is at the piano — so instead of ducking to nothing it drops
//   to a floor and its lowpass sweeps down, which is the sound of both facts being true
//   at once: a siren heard through a wall. Every other pairing is still winner-takes-all.
//
//   `ambient` COEXISTS UNDER `spot`, AND DOES NOT DUCK AT ALL. This is the one pairing
//   where the layer underneath is meant to go on being fully heard: the design document
//   calls these sounds "played atop ambience", and a gull that silenced the shore it was
//   flying over would be telling the wrong story. What makes a spot audible instead is
//   its LEVEL — musicGain.js's -30 LUFS tier, four decibels over the bed, which is what
//   that tier was always for. If a spot gets lost in a bed, that number is the one to
//   change, not this rule.
//
// `ambient`, `spot` and `dose` are driven by musicConductor.js, `music` by musicProgram.js, both
// through MusicDirector.js, and `player` by InstrumentListener.js, one voice per
// performance (see VOICES below). InstrumentListener.js drives `room` too: the Den's
// jukebox, on loop, through a lowpass of its own (TONED below). `event` is wired in and
// still waiting for a caller.
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

export const LAYERS = ["ambient", "spot", "music", "event", "room", "player", "dose"];

// What a layer does while something above it is playing. The bed keeps rolling, because a
// wind loop restarted at 0:00 under a lute is audible (the Den's jukebox is different: the
// conductor stops the bed outright for it, musicConductor.js#setJukebox); everything else pauses, because
// a 4 MB song should not stream through ten silent minutes of somebody's data plan. An
// event keeps rolling for a different reason: it is short, it is usually still audible
// under whatever beat it, and a siren that pauses and resumes is a siren twice.
const LAYER_MODE = {
  ambient: "continue",
  // A spot is a handful of seconds. Pausing it under a jukebox and resuming it a minute
  // later would land the second half of a gull cry on nothing that explains it.
  spot: "pause",
  music: "pause",
  event: "continue",
  room: "pause",
  player: "pause",
  dose: "pause",
};

// The two extra rules, as data rather than as branches — a sixth bus is a line here.
//
// PERFORMANCE is the set that is mutually exclusive: somebody's music, however it is
// being made. COEXIST names the layers that are NOT silenced by what beats them, and
// says what they do instead — `under` is which winners the rule applies against, `duck`
// is the fraction of its own gain it keeps, `hz` is how dark it goes.
const PERFORMANCE = new Set(["room", "player"]);

// VOICES. A layer key may carry a voice after a colon — "player:<performanceId>" — so two
// people playing in one Location are both heard (SOUND.md, "Performances"). Every rule
// here reads the BASE layer, so voices of one layer never duck or stop each other; they
// only ever lose to, or beat, other layers together.
function baseOf(key) {
  const at = key.indexOf(":");
  return at < 0 ? key : key.slice(0, at);
}
function rankOf(key) {
  return LAYERS.indexOf(baseOf(key));
}
// Where a lowpass is inaudible. A filter parked here is a filter that is not there.
// Declared above COEXIST because COEXIST reads it as it is built.
const OPEN_HZ = 20_000;

const COEXIST = {
  event: { under: PERFORMANCE, duck: 0.35, hz: 700 },
  // A bed under a spot is not ducked and not muffled — `duck: 1` and the filter left where
  // it is parked. See the third rule in the header: the spot's own level is what carries it.
  ambient: { under: new Set(["spot"]), duck: 1, hz: OPEN_HZ },
};
const MUFFLE_MS = 600;

// Layers that carry a lowpass of their OWN, whatever is above them: `room`, because the
// Den's jukebox is "a low quality speaker" (SOUND.md, "The Den's jukebox"). playOn's `hz`
// is where that filter rests while the layer is heard — its parked cutoff, in place of
// OPEN_HZ — and setTone() moves it without restarting the track.
const TONED = new Set(["room"]);

const CROSSFADE_MS = 1200;
// The bed gives way slowly, so a song over it arrives rather than cuts in.
const AMBIENT_HANDOFF_MS = 10_000;
const MUTE_FADE_MS = 400;

// Nothing starts or stops instantly. Applied in playOn() and stopLayer() and NOWHERE
// else — ramp() has deliberate zero-length sets in it (a gain reset before a fade-in, a
// filter put back to open) and a floor down there would leak the top of every track.
const FADE_FLOOR_MS = 250;
// What stopLayer() does when a caller does not say. It used to be 0, which meant every
// caller that forgot cut the sound dead.
const STOP_FADE_MS = 600;
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
    // The muffle, for a COEXIST layer only. Built here or never: a
    // MediaElementAudioSourceNode is made once per element, and re-patching a live graph
    // mid-fade is the one thing worth avoiding. Parked at OPEN_HZ, so its presence is
    // inaudible until something sweeps it.
    filter: null,
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
    if (COEXIST[baseOf(layer)] || TONED.has(baseOf(layer))) {
      entry.filter = audio.createBiquadFilter();
      entry.filter.type = "lowpass";
      entry.filter.frequency.value = OPEN_HZ;
      entry.gainNode.connect(entry.filter);
      entry.filter.connect(masterGain);
    } else {
      entry.gainNode.connect(masterGain);
    }
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

// Sweep a layer's lowpass. EXPONENTIAL, because pitch is logarithmic: a linear ramp down
// from 20 kHz spends its whole first half in frequencies nobody was listening to anyway,
// so the muffle would arrive all at once at the end. A layer with no filter — or a
// browser with no Web Audio — is a no-op, and the gain drop alone still reads as
// "further away", which is the fallback's whole job.
function muffle(entry, hz, ms) {
  const audio = ctx || null;
  if (!entry.filter || !audio) return;
  const f = entry.filter.frequency;
  const now = audio.currentTime;
  // exponentialRampToValueAtTime throws on a target of zero and does nothing useful from
  // one, so both ends are floored well below hearing.
  const to = Math.max(20, hz);
  f.cancelScheduledValues(now);
  f.setValueAtTime(Math.max(20, f.value), now);
  if (ms <= 0) f.setValueAtTime(to, now);
  else f.exponentialRampToValueAtTime(to, now + ms / 1000);
}

function topLayerIndex() {
  let top = -1;
  for (const [key, entry] of layers) {
    if (entry.wanted) top = Math.max(top, rankOf(key));
  }
  return top;
}

// Is this layer making a noise RIGHT NOW? Two ways to be: you won, or you are a
// coexisting layer sitting under a winner you are allowed to sit under.
//
// It exists because two things fire LATER — the deferred pause below, and
// fadeOutAtEnd's timer — and both used to re-derive this as `topLayerIndex() === my
// index`. That was true while there was only ever one audible layer. It is not true now,
// and left alone it would pause a siren that is legitimately playing.
function audibleNow(layer) {
  const entry = layers.get(layer);
  if (!entry?.wanted) return false;
  const top = topLayerIndex();
  if (top < 0) return false;
  if (rankOf(layer) === top) return true;
  const rule = COEXIST[baseOf(layer)];
  return Boolean(rule && rule.under.has(LAYERS[top]));
}

// Which layer is audible, and what every other one does about it. This is the whole
// priority rule: a bus mixer's "snapshot", in thirty lines.
function applyPriority() {
  const top = topLayerIndex();
  const winner = top >= 0 ? LAYERS[top] : null;
  for (const [layer, entry] of layers) {
    if (!entry?.wanted) continue;
    const i = rankOf(layer);
    const mode = LAYER_MODE[baseOf(layer)];

    const rule = COEXIST[baseOf(layer)];
    const under = i !== top && Boolean(rule && winner && rule.under.has(winner));

    if (i === top || under) {
      if (entry.seeking) continue;
      // A coexisting layer is held down and darkened rather than silenced. Both moves
      // take MUFFLE_MS together, because a gain drop without the filter following it
      // sounds like somebody turning a siren down, not like a wall going up.
      ramp(
        entry,
        under ? entry.wanted.gain * rule.duck : entry.wanted.gain,
        under ? MUFFLE_MS : entry.wanted.fadeInMs ?? CROSSFADE_MS,
      );
      muffle(entry, under ? rule.hz : restingHz(entry), MUFFLE_MS);
      // Muted, a song waits paused where it is (a 4 MB file should not stream to nobody);
      // the bed keeps rolling silently, which is what keeps it in time.
      if (muted && mode === "pause") {
        if (!entry.el.paused) entry.el.pause();
        continue;
      }
      if (entry.el.paused) resume(entry);
      continue;
    }

    // Ducked out entirely. Equal-power would matter if two beds crossed; between a bed
    // and a song over it, what matters is that the lower one does not stop.
    const out = layer === "ambient" ? AMBIENT_HANDOFF_MS : CROSSFADE_MS;
    ramp(entry, 0, out);
    muffle(entry, restingHz(entry), 0);
    if (mode === "pause") {
      window.setTimeout(() => {
        if (!entry.wanted || entry.el.paused) return;
        if (!audibleNow(layer)) entry.el.pause();
      }, out);
    }
  }
}

// Where a layer's filter sits while nothing is sweeping it: OPEN_HZ, or a TONED layer's
// own cutoff from playOn/setTone.
function restingHz(entry) {
  return entry.wanted?.hz ?? OPEN_HZ;
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
  { src, startAt = 0, loop = false, gain = 1, fadeInMs = 0, anchor = "local", hz = null } = {},
) {
  if (typeof window === "undefined" || !src) return;

  // One jukebox or one lute. Winner-takes-all would have hidden the quieter of the two
  // rather than resolved it, and "the gramophone is still going under the piano, you
  // just cannot hear it" is a bug you find by turning the piano off.
  // A voice ("player:<id>") stops the OTHER performance layer's voices, never its own.
  if (PERFORMANCE.has(baseOf(layer))) {
    for (const key of [...layers.keys()]) {
      if (PERFORMANCE.has(baseOf(key)) && baseOf(key) !== baseOf(layer)) {
        stopLayer(key, { fadeMs: CROSSFADE_MS });
      }
    }
  }

  const entry = state(layer);
  const url = src.startsWith("/") ? src : `${BASE}${src}`;
  const fadeIn = Math.max(fadeInMs, FADE_FLOOR_MS);

  entry.wanted = { src: url, gain, fadeInMs: fadeIn, hz: TONED.has(baseOf(layer)) && hz ? hz : null };
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
  // Starts already dark, so a muffled track never opens on a sweep down from bright.
  muffle(entry, restingHz(entry), 0);
  // Queued behind the gesture rather than dropped, so the first click drops the listener
  // into the schedule mid-stride instead of restarting the tape.
  onArmed(() => {
    if (entry.wanted?.src !== url) return;
    applyPriority();
  });
}

/**
 * Re-level a layer that is already playing — its gain and, on a TONED layer, its resting
 * cutoff — without restarting or re-seeking it. Walking into a soundproof room is this: the
 * same song, from behind a wall. A layer that is not playing is left alone.
 */
export function setTone(layer, { gain, hz = null } = {}) {
  const entry = layers.get(layer);
  if (!entry?.wanted) return;
  entry.wanted = {
    ...entry.wanted,
    ...(Number.isFinite(gain) ? { gain } : {}),
    hz: TONED.has(baseOf(layer)) && hz ? hz : null,
    // A wall going up is a move of MUFFLE_MS, not a fresh fade-in.
    fadeInMs: MUFFLE_MS,
  };
  applyPriority();
}

/** Take a layer off. Ramps its gain down over `fadeMs`, then pauses and releases it. */
export function stopLayer(layer, { fadeMs = STOP_FADE_MS } = {}) {
  const entry = layers.get(layer);
  if (!entry?.wanted) return;
  const fade = Math.max(fadeMs, FADE_FLOOR_MS);
  entry.wanted = null;
  ramp(entry, 0, fade);
  window.setTimeout(() => {
    if (entry.wanted) return;
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    entry.src = null;
    // Put the filter back, or the next thing this layer plays starts dark.
    muffle(entry, OPEN_HZ, 0);
    // A voice is one performance and never comes back, so its element is let go.
    if (layer !== baseOf(layer) && layers.get(layer) === entry) {
      entry.gainNode?.disconnect();
      layers.delete(layer);
    }
  }, fade);
  applyPriority();
}

/** Whether a layer key is holding a track — false once anything has stopped it, including
 * the other performance layer starting (the one-jukebox-or-one-lute rule). */
export function isWanted(layer) {
  return Boolean(layers.get(layer)?.wanted);
}

/** Every voice key on a layer that is still wanted — "player:<id>" for each performance. */
export function voicesOn(layer) {
  const out = [];
  for (const [key, entry] of layers) {
    if (entry.wanted && baseOf(key) === layer && key !== layer) out.push(key);
  }
  return out;
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
        if (audibleNow(layer)) ramp(entry, 0, fadeMs);
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
  // No Web Audio: the master is folded into each element by ramp(), so nudge every
  // audible one — there can be two now, and the ducked one would otherwise sit at the
  // old master level until its next ramp.
  const level = masterLevel();
  const winner = (() => {
    const top = topLayerIndex();
    return top >= 0 ? LAYERS[top] : null;
  })();
  for (const [layer, entry] of layers) {
    if (!audibleNow(layer)) continue;
    const rule = COEXIST[baseOf(layer)];
    const under = baseOf(layer) !== winner && Boolean(rule && winner && rule.under.has(winner));
    const want = (entry.wanted?.gain ?? 1) * (under ? rule.duck : 1);
    entry.el.volume = Math.min(1, Math.max(0, want * level));
  }
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
        if (entry.wanted && LAYER_MODE[baseOf(layer)] === "pause" && !entry.el.paused) entry.el.pause();
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
export function stopAllMusic({ fadeMs = 800 } = {}) {
  for (const layer of [...layers.keys()]) stopLayer(layer, { fadeMs });
}
