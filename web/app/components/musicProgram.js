"use client";

import {
  LAYERS,
  fadeOutAtEnd,
  onEnded,
  onPlayedSeconds,
  playOn,
  stopLayer,
  warm,
} from "./music";
import { musicIsAudible } from "./soundStore";

// What plays, and when. See docs/systemdocs/SOUND.md §4 for the full step table.
//
// A program is a layer plus a TAPE of steps, walked by runProgram(). The timings are data
// on purpose: a gap, a fade or a loop point is retuned by editing a number here, never by
// editing control flow. There is exactly one live setTimeout per run; everything else
// advances off the element's own `ended` event, so a stalled buffer on a phone delays the
// tape rather than desyncing it.

const WINDS = [
  "wind_4_2.ogg",
  "wind_5_1.ogg",
  "wind_4_1.ogg",
  "wind_2_2.ogg",
  "wind_3_1.ogg",
  "wind_2_1.ogg",
];

export const PROGRAMS = {
  // The door is shut. Wind for about a minute, then — once, and only once per page load —
  // something wakes up underneath it, and then the wind again, forever.
  closed: {
    layer: "ambient",
    steps: [
      {
        id: "wind",
        pick: WINDS,
        loop: true,
        gain: 0.45,
        fadeInMs: 2000,
        holdMs: 60_000,
        fadeOutMs: 2500,
        // Fetched 10s before the hold expires, so the fade-in is not a buffering pause.
        warmAtMs: 50_000,
      },
      {
        id: "waking",
        src: "white_waking.ogg",
        gain: 0.75,
        fadeInMs: 3000,
        fadeOutMs: 4000,
        once: true,
        // Once an hour per browser profile, not once per page load — a refresh used to
        // replay it. The hour is stamped the moment this starts; see remember().
        cooldownMs: 3_600_000,
      },
      { goto: 0 },
    ],
  },

  // The lobby. One song, a five-second tail, fifteen seconds of nothing, again.
  lobby: {
    layer: "music",
    steps: [
      { id: "song", src: "song_game.ogg", gain: 0.6, fadeOutMs: 5000 },
      { silenceMs: 15_000 },
      { goto: 0 },
    ],
  },

  // Rolling a character. Its own track, not the lobby's, but the same shape: the intro is
  // odd, so only the FIRST pass hears it; every pass after that starts at 0:18 and fades in
  // over a second.
  creation: {
    layer: "music",
    steps: [
      { id: "first", src: "b12_combined_start.ogg", startAt: 0, gain: 0.6 },
      { silenceMs: 10_000 },
      { id: "again", src: "b12_combined_start.ogg", startAt: 18, fadeInMs: 1000, gain: 0.6 },
      { silenceMs: 10_000 },
      { goto: 2 },
    ],
  },
};

// `once` steps that have already been spent this page load. A soft navigation keeps the
// module, so walking from /character to /notes does not replay one. A step with a
// `cooldownMs` also remembers when it last played in localStorage, so a refresh or a second
// tab inside the cooldown skips it too. Blocked storage falls back to once per page load.
const consumed = new Set();

const playedKey = (id) => `bascinet:music:${id}`;

function spent(step) {
  if (consumed.has(step.id)) return true;
  if (!step.cooldownMs) return false;
  try {
    const at = Number(window.localStorage.getItem(playedKey(step.id)));
    return Number.isFinite(at) && Date.now() - at < step.cooldownMs;
  } catch {
    return false;
  }
}

function spend(step) {
  consumed.add(step.id);
}

// The cooldown is stamped the moment the step STARTS, and rolled back by forget() if it
// turns out nobody heard it. It used to be paid halfway through instead, which sounds
// kinder and was not: `white_waking` is about five minutes, so the hour was never paid
// unless somebody sat on the page for four solid minutes, and every refresh before that
// replayed it — the `consumed` Set above is all a reload leaves behind.
function remember(step) {
  if (!step.cooldownMs) return;
  try {
    window.localStorage.setItem(playedKey(step.id), String(Date.now()));
  } catch {
    // Storage blocked — the page-load rule above still holds.
  }
}

function forget(step) {
  if (!step.cooldownMs) return;
  try {
    window.localStorage.removeItem(playedKey(step.id));
  } catch {
    // Nothing was written either, so there is nothing to undo.
  }
}

// How much of a cooldown step counts as having heard it. The fade-in alone is 3 s, so this
// is unambiguously "this started" without being a fraction of a file whose length we would
// then have to think about.
const HEARD_MS = 15_000;

/** Which tape, if any, this state should be playing. */
export function resolveProgram(phase, pathname = "") {
  if (!phase) return null;
  // A GM adjudicating has no character of their own, which would otherwise start the
  // character-creation loop under the audit desk. The desks stay quiet.
  if (pathname.startsWith("/gm/")) return null;
  if (phase.phase === "CLOSED") return PROGRAMS.closed;
  if (phase.phase === "LOBBY") return PROGRAMS.lobby;
  if (!phase.hasCharacter) return PROGRAMS.creation;
  return null;
}

function pickSrc(step) {
  if (step.pick) return step.pick[Math.floor(Math.random() * step.pick.length)];
  return step.src ?? null;
}

/**
 * Walk a program. Returns cancel().
 *
 * Re-entrancy is handled by `runId`: every callback compares the id it closed over against
 * the live one, so a cancelled run can never advance the tape it no longer owns.
 */
export function runProgram(program, { onStep } = {}) {
  if (!program || !LAYERS.includes(program.layer)) return () => {};

  const { layer, steps } = program;
  let index = 0;
  let timer = null;
  let warmTimer = null;
  let dropEnded = null;
  let dropFade = null;
  let dropHeard = null;
  let live = true;
  // The cooldown step currently playing, and whether it has been heard for long enough to
  // keep its stamp. Read only by the cancel below.
  let pending = null;
  let heard = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (warmTimer) window.clearTimeout(warmTimer);
    warmTimer = null;
    if (dropEnded) dropEnded();
    dropEnded = null;
    if (dropFade) dropFade();
    dropFade = null;
    if (dropHeard) dropHeard();
    dropHeard = null;
  };

  const advance = () => {
    if (!live) return;
    index = (index + 1) % steps.length;
    enter();
  };

  const enter = () => {
    if (!live) return;
    clear();

    let step = steps[index];
    // `goto` and a spent `once` are both "not a step" — skip on, with a guard against a
    // tape that is nothing but jumps.
    for (let guard = 0; guard < steps.length + 1; guard += 1) {
      if (step && typeof step.goto === "number") {
        index = step.goto;
        step = steps[index];
        continue;
      }
      if (step?.once && spent(step)) {
        index = (index + 1) % steps.length;
        step = steps[index];
        continue;
      }
      break;
    }
    if (!step || typeof step.goto === "number") return;

    onStep?.(step);

    if (step.silenceMs) {
      stopLayer(layer, { fadeMs: 400 });
      timer = window.setTimeout(advance, step.silenceMs);
      return;
    }

    if (step.once) spend(step);
    // Stamped on entry, so a refresh ten seconds in cannot hear this again. The rollback
    // below is what keeps that from being unfair.
    if (step.cooldownMs) {
      pending = step;
      heard = false;
      remember(step);
    }

    const src = pickSrc(step);
    if (!src) {
      advance();
      return;
    }

    playOn(layer, {
      src,
      startAt: step.startAt ?? 0,
      loop: Boolean(step.loop),
      gain: step.gain ?? 1,
      fadeInMs: step.fadeInMs ?? 0,
    });

    // The prefetch is the one timer that is not the tape's, so it gets its own handle
    // rather than racing the tape for `timer`.
    if (step.warmAtMs) {
      const next = steps[(index + 1) % steps.length];
      const ahead = next && !next.once ? pickSrc(next) : next?.src;
      if (ahead && !(next?.once && spent(next))) {
        warmTimer = window.setTimeout(() => warm(ahead), step.warmAtMs);
      }
    }

    if (step.holdMs) {
      // A looping bed never ends on its own, so the hold is what moves the tape.
      timer = window.setTimeout(() => {
        if (!live) return;
        if (step.fadeOutMs) stopLayer(layer, { fadeMs: step.fadeOutMs });
        timer = window.setTimeout(advance, step.fadeOutMs ?? 0);
      }, step.holdMs);
      return;
    }

    // Not what pays the cooldown any more — entry did that. This only decides whether the
    // stamp survives a cancel. Audibility is read HERE rather than at entry, so somebody
    // who unmutes partway through still counts as having heard it.
    if (step.cooldownMs) {
      dropHeard = onPlayedSeconds(layer, HEARD_MS / 1000, () => {
        if (musicIsAudible()) heard = true;
      });
    }
    if (step.fadeOutMs) dropFade = fadeOutAtEnd(layer, step.fadeOutMs);
    dropEnded = onEnded(layer, advance);
  };

  enter();

  return () => {
    live = false;
    // Cut off before anybody really heard it — give the hour back. Only here, never in
    // clear(), which runs on every ordinary step change. A hard tab close runs no React
    // cleanup at all, so closing the page two seconds in keeps the hour: being foolproof
    // matters more here than being generous, and it used to be the other way round.
    if (pending && !heard) forget(pending);
    pending = null;
    clear();
    stopLayer(layer, { fadeMs: 600 });
  };
}
