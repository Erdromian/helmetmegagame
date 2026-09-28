"use client";

import { fadeOutAtEnd, onEnded, playOn, stopLayer } from "./music";
import { fileGain } from "./musicGain";
import { PIECE_WATCHDOG_MS, gapAfter, pickOne, pickTiered, roll } from "./musicSchedule";
import { placeHas } from "./placeAmbience";

// The in-game soundtrack. ONE timeline, one piece at a time:
//
//     [piece] → [silence] → [piece] → [silence] → …
//
// A piece is whatever the place you are standing in sounds like (placeAmbience.js), picked
// off its stack of tiers so the most specific track usually wins. It plays to its end —
// "Ambience tracks continue to completion" — with exactly two exceptions, both the
// document's:
//
//   - "…unless they are interrupted by an ambience interrupting SFX". interrupt() fades the
//     piece out and plays the interrupter in its place, to its own end.
//   - "…or the character leaves the specific zone in which they can play, in which case
//     they fade out." setPlace() fades the piece if the new place could never have picked
//     it. Walking from the Town into the Undertown keeps a general or a fortress track
//     going, because it can play in both; walking into space does not.
//
// A GM with no character "stands" in whatever place they have open in Chat, so for them the
// second rule is switching Chat to a place the piece cannot play in. Going back to a GM
// panel is not leaving anywhere: the piece plays on to its end. What a GM panel does is
// HOLD the timeline (setHold) — nothing new starts there, not a piece and not a spot, until
// the GM is back on a page that is not one.
//
// A performance — a jukebox or somebody playing — still covers a piece rather than ending
// it, and music.js handles that on its own.
//
// Module scope, so a soft navigation (/character → /chat) never restarts it.
// MusicDirector.js calls start() and stop() when in-game play begins and ends, setPlace()
// whenever where you are standing changes, and setHold() as a GM goes on and off the desks. The rules live in musicSchedule.js.

const AMBIENT_FADE_IN_MS = 3000;
const ONESHOT_TAIL_MS = 2000;
const TEXTURE_TAIL_MS = 6000;
// A piece whose place you walked out of, and a piece an interrupter cuts.
const LEAVE_FADE_MS = 4000;
const INTERRUPT_FADE_MS = 1500;
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
// An interrupter asked for before start(): the first thing played once it does.
let pending = null;
// While held, a piece or a spot that comes due is not played; the flag remembers that it
// came due, so lifting the hold can start it.
let held = false;
let heldNext = false;
let heldSpot = false;

let timer = null;
let piece = null; // { layer, src, startedAt, drops: [], leaving }
// Spots run on a SECOND, independent timeline. The document says they are "played atop
// ambience/silence" — atop silence too — so a spot does not wait for a bed to be playing,
// and the two never need to know about each other. music.js's third rule is what keeps them
// from fighting: a bed under a spot is not ducked.
let spotTimer = null;
let spotDrops = [];
let spotSrc = null;

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
  spotSrc = null;
}

function scheduleSpot(ms) {
  spotTimer = window.setTimeout(playNextSpot, ms);
}

/** One short sound over whatever is or is not playing, then a long wait, then another. */
function playNextSpot() {
  if (!running) return;
  if (held) {
    heldSpot = true;
    return;
  }
  const spots = here?.spots ?? [];
  if (!spots.length) {
    scheduleSpot(NO_PLACE_RETRY_MS);
    return;
  }

  const item = pickOne(spots, lastSpot);
  lastSpot = item;
  spotSrc = item.src;
  playOn("spot", {
    src: item.src,
    loop: item.loop,
    gain: (roll(item.gain) ?? 1) * fileGain(item.src),
    fadeInMs: SPOT_FADE_IN_MS,
  });
  debug(`spot: ${item.src}${item.loop ? " (texture)" : ""}`);

  const after = () => {
    clearSpot();
    scheduleSpot(roll(SPOT_GAP_MS));
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

// The piece is over, by its own end or by fading out. Silence, scaled to how long it played.
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
  if (held) {
    heldNext = true;
    return;
  }
  const item = here ? pickTiered(here.tiers, lastSrc) : null;
  if (!item) {
    wait(NO_PLACE_RETRY_MS, playNext);
    return;
  }
  play(item, here.id);
}

function play(item, label) {
  const layer = "ambient";
  lastSrc = item.src;

  // The file's measured level times the piece's own trim, and nothing else. The tier in
  // musicGain.js is the level this was meant to be playing at.
  const gain = (roll(item.gain) ?? 1) * fileGain(item.src);
  playOn(layer, { src: item.src, loop: item.loop, gain, fadeInMs: AMBIENT_FADE_IN_MS });
  piece = { layer, src: item.src, startedAt: Date.now(), drops: [], leaving: false };
  debug(`${label}: ${item.src}${item.loop ? " (texture)" : ""}`);

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

/** The piece in the air can no longer play here: fade it, then the ordinary gap. */
function leave() {
  if (!piece || piece.leaving) return;
  piece.leaving = true;
  debug(`left the place ${piece.src} plays in; fading`);
  stopLayer(piece.layer, { fadeMs: LEAVE_FADE_MS });
  const t = window.setTimeout(finish, LEAVE_FADE_MS);
  piece.drops.push(() => window.clearTimeout(t));
}

/** In-game play has begun (or resumed) on this page. */
export function start() {
  if (running || typeof window === "undefined") return;
  running = true;
  if (pending) {
    const item = pending;
    pending = null;
    play(item, "interrupt");
  } else {
    wait(roll(FIRST_WAIT_MS), playNext);
  }
  // The spots start later than the first bed, so the first thing anybody hears in a place is
  // the place itself rather than something happening in it.
  scheduleSpot(roll(SPOT_GAP_MS));
}

/** In-game play is over on this page — the phase changed, or nobody is listening. */
export function stop() {
  if (!running) return;
  running = false;
  pending = null;
  heldNext = false;
  heldSpot = false;
  clearTimer();
  clearSpot();
  stopLayer("spot", { fadeMs: 600 });
  if (piece) {
    stopLayer(piece.layer, { fadeMs: 600 });
    dropPiece();
  }
}

/**
 * Hold the timeline, or let it go. Held, nothing NEW starts — a piece or a spot that comes
 * due waits — but whatever is already playing plays on to its end. Let go, anything that
 * came due while held starts after the same short wait as a first visit. A silence gap
 * still counting down just carries on, so bouncing on and off a GM panel never cuts the
 * silence short.
 */
export function setHold(on) {
  held = Boolean(on);
  if (held || !running) return;
  if (heldNext) {
    heldNext = false;
    wait(roll(FIRST_WAIT_MS), playNext);
  }
  if (heldSpot) {
    heldSpot = false;
    scheduleSpot(roll(SPOT_GAP_MS));
  }
}

/**
 * Where the listener is standing now: a placeAmbience.js stack, or null. What plays NEXT
 * comes from here. What is playing NOW carries on if it could have been picked here too,
 * and fades out if it could not. A null place (the payload has not landed, a key that
 * names nowhere) says nothing about where anybody went, so it never fades anything.
 */
export function setPlace(next) {
  here = next;
  if (!running || !next) return;
  if (piece && !piece.leaving && !placeHas(next, piece.src)) leave();
  if (spotSrc && !(next.spots ?? []).some((s) => s.src === spotSrc)) {
    clearSpot();
    stopLayer("spot", { fadeMs: SPOT_TAIL_MS });
    scheduleSpot(roll(SPOT_GAP_MS));
  }
}

/**
 * "An ambience interrupting SFX": the piece in the air fades out, and `item` (a
 * placeAmbience.js piece) plays in its place, to its own end, followed by the ordinary gap.
 * Asked for before start(), it is the first thing start() plays.
 */
export function interrupt(item) {
  if (!item || typeof window === "undefined") return;
  if (!running) {
    pending = item;
    return;
  }
  clearTimer();
  if (piece) {
    const layer = piece.layer;
    dropPiece();
    stopLayer(layer, { fadeMs: INTERRUPT_FADE_MS });
    wait(INTERRUPT_FADE_MS, () => play(item, "interrupt"));
  } else {
    play(item, "interrupt");
  }
}
