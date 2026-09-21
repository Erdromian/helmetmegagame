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
import { fileGain } from "./musicGain";
import { musicIsAudible } from "./soundStore";

// What plays, and when. See docs/systemdocs/SOUND.md §4 for the full step table.
//
// A program is a layer plus a TAPE of steps, walked by runProgram(). The timings are data
// on purpose: a gap, a fade or a loop point is retuned by editing a number here, never by
// editing control flow. There is exactly one live setTimeout per run; everything else
// advances off the element's own `ended` event, so a stalled buffer on a phone delays the
// tape rather than desyncing it.
//
// The tapes below are the ones the GAME PHASE picks — the closed door, the lobby, rolling
// a character. The tapes a PLACE picks live in placeAmbience.js and are walked by the
// same runProgram(); they are a separate file because "what is happening" and "where you
// are standing" are different questions and were never going to share a resolver.
//
// NO STEP CARRIES A LEVEL any more unless it means something. Each file's loudness is
// measured into musicGain.js and applied under the step, so a `gain` here now reads as
// "and this one a little under THAT" rather than as an absolute somebody would have to
// re-derive every time a file was re-encoded. The four hand-set numbers that used to be
// on these three tapes are gone: they were doing the levelling job, badly — the files
// they balanced measured twenty decibels apart.

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
        fadeInMs: 2000,
        holdMs: 60_000,
        fadeOutMs: 2500,
        // Fetched 10s before the hold expires, so the fade-in is not a buffering pause.
        warmAtMs: 50_000,
      },
      {
        id: "waking",
        src: "white_waking.ogg",
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
      { id: "song", src: "song_game.ogg", fadeOutMs: 5000 },
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
      { id: "first", src: "b12_combined_start.ogg", startAt: 0 },
      { silenceMs: 10_000 },
      { id: "again", src: "b12_combined_start.ogg", startAt: 18, fadeInMs: 1000 },
      { silenceMs: 10_000 },
      { goto: 2 },
    ],
  },

  // The game's music, under a running game: one track, then minutes of nothing, then
  // another. The gap is the point — nine tracks on a loop is a playlist, and a playlist
  // is something you notice and then get sick of. Coming back every few minutes, it stays
  // something that happens rather than something that is on.
  //
  // It does NOT play everywhere: placeAmbience.js's `music: false` places answer for the
  // Caves, the Depths, the Lifeweb and Space, and MusicDirector.js is what obeys it.
  rotation: {
    id: "rotation",
    layer: "music",
    steps: [
      {
        id: "track",
        pick: [
          "a-thousand-empty-rooms.ogg",
          "haruspex.ogg",
          "surfacing.ogg",
          "graceperiod.ogg",
          "song_game.ogg",
          "holywarlobby.ogg",
          "the_collective.ogg",
          "morning.ogg",
          "newlobby31.ogg",
        ],
        fadeInMs: 3000,
        fadeOutMs: 5000,
      },
      { silenceMs: [120_000, 300_000], fadeOutMs: 5000 },
      { goto: 0 },
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

// What a gap fades out over when its step does not say. Short, because a step that wants
// a long tail says so.
const SILENCE_FADE_MS = 400;

// Which tape owns which layer. Two tapes on one layer is not a crossfade, it is two
// programs fighting over one element, and it is silent until somebody notices the bed
// restarting for no reason. There is no recovery worth attempting — the newcomer wins,
// as it would have anyway — so this only makes it visible.
const owners = new Map();

/** Which tape, if any, this state should be playing. */
export function resolveProgram(phase, pathname = "") {
  if (!phase) return null;
  // A GM adjudicating has no character of their own, which would otherwise start the
  // character-creation loop under the audit desk. The desks stay quiet.
  if (pathname.startsWith("/gm/")) return null;
  // The shut door keeps its own soundtrack whatever else is true. CLOSED is the game not
  // being open, the wind behind it is the point, and white_waking lives on the `ambient`
  // layer there — which the place tape would otherwise be fighting it for.
  if (phase.phase === "CLOSED") return PROGRAMS.closed;
  // A LIVING CHARACTER OUTRANKS THE LOBBY. Somebody standing in a place hears that place;
  // the phase tapes are for people who are not standing anywhere yet.
  //
  // In an ordinary game this line changes nothing, which is what makes it safe: creation
  // is a hard phase gate (character/createActions.js#creationOpen — RUNNING or ENDED, or
  // a GM), Start Game creates no characters of its own, and rolling a role in the lobby
  // only stamps a LobbyEntry. So LOBBY *with* a living character is reachable only by a
  // GM who used the Skip button — somebody testing — and they were the one person being
  // handed the wrong soundtrack for the place they were standing in.
  if (phase.hasCharacter) return null;
  if (phase.phase === "LOBBY") return PROGRAMS.lobby;
  return PROGRAMS.creation;
}

// A step's number may be a RANGE — `silenceMs: [90_000, 260_000]` is "somewhere between
// a minute and a half and four and a bit". That is what keeps a sparse ambience from
// becoming a metronome: the Cathedral's organ room every five minutes exactly is a clock,
// and a clock is the one thing scenery must not sound like.
//
// Rolled ONCE PER ENTRY, into a local. Reading the same field twice and getting two
// answers is how a fade-out gets scheduled to end after the track it was fading.
function roll(value) {
  if (!Array.isArray(value)) return value;
  const [min, max] = value;
  return min + Math.random() * (max - min);
}

// What each `pick` step chose last time. Module scope rather than per run, because a run
// is re-entered constantly — a phase poll, a walk into the next cave — and a run's own
// memory would forget the last drip every time and let it repeat.
const lastPick = new Map();

/**
 * One file off a step. A `pick` never plays the same file twice running: it chooses
 * uniformly from the OTHER files, which is the same distribution as rerolling until it
 * differs, without the unbounded loop.
 *
 * `remember: false` is for the warmAtMs look-ahead, which is a guess about the next step
 * and must not consume the memory — if it did, the prefetch would reliably download the
 * one file the next step is then guaranteed not to pick.
 */
function pickSrc(step, { remember = true } = {}) {
  const list = step?.pick;
  if (!list?.length) return step?.src ?? null;
  if (list.length === 1) return list[0];
  const key = step.id ?? list.join("|");
  const pool = list.filter((file) => file !== lastPick.get(key));
  const next = pool[Math.floor(Math.random() * pool.length)];
  if (remember) lastPick.set(key, next);
  return next;
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
  const token = {};
  if (owners.has(layer) && owners.get(layer) !== token) {
    console.warn(
      `[music] two programs want the "${layer}" layer; the newer one takes it. ` +
        "One of them should be on a different bus.",
    );
  }
  owners.set(layer, token);
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

    // Every ranged field, rolled once, here. Nothing below reads step.<field> again.
    const silence = roll(step.silenceMs);
    const hold = roll(step.holdMs);
    const fadeOut = roll(step.fadeOutMs);
    const fadeIn = roll(step.fadeInMs);
    const gain = roll(step.gain);
    const warmAt = roll(step.warmAtMs);

    if (silence) {
      // A gap honours the step's own fade-out. It used to cut at a flat 400 ms whatever
      // the step asked for, which is audible on a bed that wanted four seconds.
      stopLayer(layer, { fadeMs: fadeOut ?? SILENCE_FADE_MS });
      timer = window.setTimeout(advance, silence);
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
      // The measured level of the file, times the step's own trim. Splitting it this way
      // is what lets a step gain stay a small readable number ("this one a touch under")
      // instead of being an absolute level somebody has to re-derive — see musicGain.js.
      gain: (gain ?? 1) * fileGain(src),
      fadeInMs: fadeIn ?? 0,
    });

    // The prefetch is the one timer that is not the tape's, so it gets its own handle
    // rather than racing the tape for `timer`.
    if (warmAt) {
      const next = steps[(index + 1) % steps.length];
      const ahead = next && !next.once ? pickSrc(next, { remember: false }) : next?.src;
      if (ahead && !(next?.once && spent(next))) {
        warmTimer = window.setTimeout(() => warm(ahead), warmAt);
      }
    }

    if (hold) {
      // A looping bed never ends on its own, so the hold is what moves the tape.
      timer = window.setTimeout(() => {
        if (!live) return;
        if (fadeOut) stopLayer(layer, { fadeMs: fadeOut });
        timer = window.setTimeout(advance, fadeOut ?? 0);
      }, hold);
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
    if (fadeOut) dropFade = fadeOutAtEnd(layer, fadeOut);
    dropEnded = onEnded(layer, advance);
  };

  enter();

  return () => {
    live = false;
    if (owners.get(layer) === token) owners.delete(layer);
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
