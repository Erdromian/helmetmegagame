"use client";

import { fadeOutAtEnd, onEnded, playOn, stopLayer } from "./music";
import { fileGain } from "./musicGain";
import { PIECE_WATCHDOG_MS, gapAfter, pickOne, roll } from "./musicSchedule";

// The in-game soundtrack. ONE timeline, one piece at a time:
//
//     [piece] → [silence] → [piece] → [silence] → …
//
// A piece is whatever the place you are standing in sounds like (placeAmbience.js), and it
// plays to its end. Nothing on this timeline ever ducks, replaces or cuts off anything else
// on it, because there is only ever one thing on it. The only thing that interrupts a piece
// is a performance — a jukebox or somebody playing — and music.js handles that on its own.
//
// Walking somewhere new does not touch what is playing. It changes what "here" means, and
// the NEXT piece is picked from the new place.
//
// Module scope, so a soft navigation (/character → /chat) never restarts it.
// MusicDirector.js calls start() and stop() when in-game play begins and ends, and
// setPlace() whenever where you are standing changes. The rules live in musicSchedule.js.

const AMBIENT_FADE_IN_MS = 3000;
const ONESHOT_TAIL_MS = 2000;
const TEXTURE_TAIL_MS = 6000;
// Before the first piece of a visit, and while waiting for the page to learn where you are.
const FIRST_WAIT_MS = [5_000, 20_000];
const NO_PLACE_RETRY_MS = 30_000;

// How long between spots. THIS RANGE IS OURS, not the document's — it says what a spot is
// for ("very specific circumstances") and never how often. Sparse on purpose: a gull every
// forty seconds is a clock, and a clock is the one thing scenery must not sound like.
const SPOT_GAP_MS = [45_000, 180_000];
const SPOT_FADE_IN_MS = 1500;
const SPOT_TAIL_MS = 2500;

let running = false;
let here = null;
let lastSrc = null;
let lastSpot = null;

let timer = null;
let piece = null; // { layer, startedAt, drops: [] }
// Spots run on a SECOND, independent timeline. The document says they are "played atop
// ambience/silence" — atop silence too — so a spot does not wait for a bed to be playing,
// and the two never need to know about each other. music.js's third rule is what keeps them
// from fighting: a bed under a spot is not ducked.
let spotTimer = null;
let spotDrops = [];

const debug = (...args) => {
  try {
    if (window.localStorage.getItem("bascinet:musicdebug")) console.debug("[music]", ...args);
  } catch {
    // Storage blocked; no log.
  }
};

function clearTimer() {
  if (timer) window.clearTimeout(timer);
  timer = null;
}

function wait(ms, then) {
  clearTimer();
  timer = window.setTimeout(then, ms);
}

function dropPiece() {
  if (!piece) return;
  for (const drop of piece.drops) drop();
  piece = null;
}

function clearSpot() {
  if (spotTimer) window.clearTimeout(spotTimer);
  spotTimer = null;
  for (const drop of spotDrops) drop();
  spotDrops = [];
}

/** One short sound over whatever is or is not playing, then a long wait, then another. */
function playNextSpot() {
  if (!running) return;
  const spots = here?.spots ?? [];
  if (!spots.length) {
    spotTimer = window.setTimeout(playNextSpot, NO_PLACE_RETRY_MS);
    return;
  }

  const item = pickOne(spots, lastSpot);
  lastSpot = item;
  playOn("spot", {
    src: item.src,
    loop: item.loop,
    gain: (roll(item.gain) ?? 1) * fileGain(item.src),
    fadeInMs: SPOT_FADE_IN_MS,
  });
  debug(`spot: ${item.src}${item.loop ? " (texture)" : ""}`);

  const after = () => {
    clearSpot();
    spotTimer = window.setTimeout(playNextSpot, roll(SPOT_GAP_MS));
  };

  if (item.loop) {
    const span = roll(item.spanMs);
    const t = window.setTimeout(() => {
      stopLayer("spot", { fadeMs: SPOT_TAIL_MS });
      const t2 = window.setTimeout(after, SPOT_TAIL_MS);
      spotDrops.push(() => window.clearTimeout(t2));
    }, span);
    spotDrops.push(() => window.clearTimeout(t));
  } else {
    spotDrops.push(fadeOutAtEnd("spot", SPOT_TAIL_MS));
    spotDrops.push(onEnded("spot", after));
    // Same watchdog reasoning as a piece: a file that never loads never ends.
    const watchdog = window.setTimeout(after, PIECE_WATCHDOG_MS);
    spotDrops.push(() => window.clearTimeout(watchdog));
  }
}

// The piece is over, by its own end. Silence, scaled to how long it played.
function finish() {
  if (!piece) return;
  const played = Date.now() - piece.startedAt;
  const layer = piece.layer;
  dropPiece();
  stopLayer(layer, { fadeMs: 400 });
  const gap = gapAfter(played);
  debug(`${layer} done after ${Math.round(played / 1000)}s; quiet for ${Math.round(gap / 1000)}s`);
  wait(gap, playNext);
}

function playNext() {
  if (!running) return;
  if (!here) {
    wait(NO_PLACE_RETRY_MS, playNext);
    return;
  }
  if (!here.pieces.length) {
    wait(NO_PLACE_RETRY_MS, playNext);
    return;
  }

  const layer = "ambient";
  const item = pickOne(here.pieces, lastSrc);
  lastSrc = item;

  // The file's measured level times the piece's own trim, and nothing else. There used to
  // be a further ×0.85 here to leave room for a song to stand out over the bed; with no
  // rotation there is no song to make room for, and the tier in musicGain.js is the level
  // this was meant to be playing at all along.
  const gain = (roll(item.gain) ?? 1) * fileGain(item.src);
  playOn(layer, { src: item.src, loop: item.loop, gain, fadeInMs: AMBIENT_FADE_IN_MS });
  piece = { layer, startedAt: Date.now(), drops: [] };
  debug(`${here.id}: ${item.src}${item.loop ? " (texture)" : ""}`);

  if (item.loop) {
    // A texture has no end of its own; its span is the end it was always going to have.
    const span = roll(item.spanMs);
    const t = window.setTimeout(() => {
      stopLayer(layer, { fadeMs: TEXTURE_TAIL_MS });
      const t2 = window.setTimeout(finish, TEXTURE_TAIL_MS);
      piece?.drops.push(() => window.clearTimeout(t2));
    }, span);
    piece.drops.push(() => window.clearTimeout(t));
  } else {
    piece.drops.push(fadeOutAtEnd(layer, ONESHOT_TAIL_MS));
    piece.drops.push(onEnded(layer, finish));
  }
  const watchdog = window.setTimeout(finish, PIECE_WATCHDOG_MS);
  piece.drops.push(() => window.clearTimeout(watchdog));
}

/** In-game play has begun (or resumed) on this page. */
export function start() {
  if (running || typeof window === "undefined") return;
  running = true;
  wait(roll(FIRST_WAIT_MS), playNext);
  // The spots start later than the first bed, so the first thing anybody hears in a place is
  // the place itself rather than something happening in it.
  spotTimer = window.setTimeout(playNextSpot, roll(SPOT_GAP_MS));
}

/** In-game play is over on this page — the phase changed, or this is a GM desk. */
export function stop() {
  if (!running) return;
  running = false;
  clearTimer();
  clearSpot();
  stopLayer("spot", { fadeMs: 600 });
  if (piece) {
    stopLayer(piece.layer, { fadeMs: 600 });
    dropPiece();
  }
}

/**
 * Where the listener is standing now: a placeAmbience.js pool, or null. NEVER cuts what is
 * playing — the piece in the air finishes and the next one comes from the new place. There
 * used to be an exception for a song following you into a `music: false` place; with no
 * rotation there is no song to follow you, and those places have beds of their own now.
 */
export function setPlace(next) {
  here = next;
}
