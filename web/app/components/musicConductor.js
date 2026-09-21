"use client";

import { fadeOutAtEnd, onEnded, playOn, stopLayer } from "./music";
import { fileGain } from "./musicGain";
import {
  AMBIENT_GAIN,
  PIECE_WATCHDOG_MS,
  gapAfter,
  nextKind,
  pickOne,
  roll,
} from "./musicSchedule";

// The in-game soundtrack. ONE timeline, one piece at a time:
//
//     [piece] → [silence] → [piece] → [silence] → …
//
// A piece is an ambient file for the place you are standing in (placeAmbience.js) or one
// of the game's music tracks. Ambient and music never overlap, so nothing on this
// timeline ever ducks, replaces or cuts off anything else on it. A piece plays to its end.
// The only thing that interrupts one is a performance — a jukebox or somebody playing —
// and music.js handles that on its own: the music layer pauses under it and picks up
// again after, and the ambient layer goes quiet under it.
//
// Walking somewhere new does not touch what is playing. It changes what "here" means, and
// the NEXT piece is picked from the new place. The one exception: music playing as you
// walk into a place with `music: false` fades out over ten seconds, because a song
// following you into the Caves breaks the one thing the Caves are for.
//
// Module scope, so a soft navigation (/character → /chat) never restarts it.
// MusicDirector.js calls start() and stop() when in-game play begins and ends, and
// setPlace() whenever where you are standing changes. The rules live in musicSchedule.js.

export const MUSIC_TRACKS = [
  "a-thousand-empty-rooms.ogg",
  "haruspex.ogg",
  "surfacing.ogg",
  "graceperiod.ogg",
  "song_game.ogg",
  "holywarlobby.ogg",
  "the_collective.ogg",
  "morning.ogg",
  "newlobby31.ogg",
];

const MUSIC_FADE_IN_MS = 3000;
const MUSIC_TAIL_MS = 5000;
const AMBIENT_FADE_IN_MS = 3000;
const ONESHOT_TAIL_MS = 2000;
const TEXTURE_TAIL_MS = 6000;
const LEAVE_FOR_QUIET_MS = 10_000;
// Before the first piece of a visit, and while waiting for the page to learn where you are.
const FIRST_WAIT_MS = [5_000, 20_000];
const NO_PLACE_RETRY_MS = 30_000;

let running = false;
let here = null;
let enteredAt = null; // when this page first started in-game play; never reset by stop()
let lastKind = null;
const lastSrc = { music: null, ambient: null };

let timer = null;
let piece = null; // { layer, startedAt, drops: [] }

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
  const kind = nextKind({
    inGameMs: Date.now() - enteredAt,
    lastKind,
    musicAllowed: here.music,
    hasAmbient: here.pieces.length > 0,
  });
  if (!kind) {
    wait(NO_PLACE_RETRY_MS, playNext);
    return;
  }

  let layer;
  let item;
  if (kind === "music") {
    layer = "music";
    const src = pickOne(MUSIC_TRACKS, lastSrc.music);
    lastSrc.music = src;
    item = { src, loop: false };
  } else {
    layer = "ambient";
    item = pickOne(here.pieces, lastSrc.ambient);
    lastSrc.ambient = item;
  }
  lastKind = kind;

  const gain = (roll(item.gain) ?? 1) * fileGain(item.src) * (kind === "ambient" ? AMBIENT_GAIN : 1);
  playOn(layer, {
    src: item.src,
    loop: item.loop,
    gain,
    fadeInMs: kind === "music" ? MUSIC_FADE_IN_MS : AMBIENT_FADE_IN_MS,
  });
  piece = { layer, kind, startedAt: Date.now(), drops: [] };
  debug(`${kind}: ${item.src}${item.loop ? " (texture)" : ""}`);

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
    piece.drops.push(fadeOutAtEnd(layer, kind === "music" ? MUSIC_TAIL_MS : ONESHOT_TAIL_MS));
    piece.drops.push(onEnded(layer, finish));
  }
  const watchdog = window.setTimeout(finish, PIECE_WATCHDOG_MS);
  piece.drops.push(() => window.clearTimeout(watchdog));
}

/** In-game play has begun (or resumed) on this page. */
export function start() {
  if (running || typeof window === "undefined") return;
  running = true;
  enteredAt ??= Date.now();
  wait(roll(FIRST_WAIT_MS), playNext);
}

/** In-game play is over on this page — the phase changed, or this is a GM desk. */
export function stop() {
  if (!running) return;
  running = false;
  clearTimer();
  if (piece) {
    stopLayer(piece.layer, { fadeMs: 600 });
    dropPiece();
  }
}

/** Where the listener is standing now: a placeAmbience.js pool, or null. Never cuts. */
export function setPlace(next) {
  here = next;
  if (piece?.kind === "music" && next && !next.music) {
    const { layer, startedAt } = piece;
    dropPiece();
    stopLayer(layer, { fadeMs: LEAVE_FOR_QUIET_MS });
    piece = { layer, kind: "music", startedAt, drops: [] };
    const t = window.setTimeout(finish, LEAVE_FOR_QUIET_MS);
    piece.drops.push(() => window.clearTimeout(t));
  }
}
