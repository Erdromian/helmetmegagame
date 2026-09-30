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
// The tapes below are the ones the GAME PHASE picks: the closed door, and the lobby. Under
// a running game with a character, musicConductor.js takes over instead, and what a PLACE
// sounds like lives in placeAmbience.js.
//
// THERE IS NO CREATION TAPE. Rolling a character happens in the lobby, so it hears the
// lobby, which is also the whole of what the design document says about it — see
// docs/sounds.yaml, where the file that used to play here is one of the 23 marked Unused.
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

// THE LOBBY. "A track is always playing, and all players in the lobby hear the same track
// looping. Tracks loop for roughly an hour before another track starts looping." — the
// design document, and the one rule here that is about more than one listener.
//
// Which track is therefore NOT a choice this browser gets to make. It comes off the wall
// clock: the hour number picks the track, and the same hour number is the anchor, so a
// player arriving forty minutes in is sought forty minutes into the loop rather than
// starting it again (music.js#positionFor wraps for a looping track). Two browsers agree
// because neither of them decided anything.
//
// A shared rotation is the reason there is no `pick` here and no Math.random anywhere near
// it: `pick` rolls per browser, which is exactly the thing that would break.
const LOBBY_SLOT_MS = 60 * 60 * 1000;

// "Lobby Music", every one, from both documents. "Only lobby music tracks can play during
// lobby." The new document's lobby tracks for a game where the Count is in play or the
// gamemode is OS13 are not here: neither exists yet (docs/sounds.yaml, `needs`).
const LOBBY_TRACKS = [
  "a-thousand-empty-rooms.ogg",
  "beyondretrieval.ogg",
  "newlobby31.ogg",
  "outpost.ogg",
  "track3.ogg",
  "track13.ogg",
  "red-calx.ogg",
  "conflict-and-climax.ogg",
  "friction.ogg",
  "manunkind.ogg",
  "stone-in-focus.ogg",
];

// "Rare Lobby Music", so it takes one slot in twelve rather than a turn in the rotation.
// The slot number decides, not a roll, for the same reason as above — a rare track that
// only some of the lobby could hear would not be rare, it would be broken.
const RARE_TRACK = "white_waking.ogg";
const RARE_ONE_IN = 12;

export function lobbySlot(now = Date.now()) {
  return Math.floor(now / LOBBY_SLOT_MS);
}

export function lobbyTrackFor(slot) {
  if (slot % RARE_ONE_IN === 0) return RARE_TRACK;
  // The rare slots are skipped rather than overwritten, so the ordinary rotation is not
  // quietly short of one track every twelfth hour.
  const ordinary = slot - Math.floor(slot / RARE_ONE_IN) - 1;
  return LOBBY_TRACKS[((ordinary % LOBBY_TRACKS.length) + LOBBY_TRACKS.length) % LOBBY_TRACKS.length];
}

/** Milliseconds until the track changes over. The tape's `hold`, so it advances on the hour. */
export function lobbySlotRemaining(now = Date.now()) {
  return LOBBY_SLOT_MS - (now % LOBBY_SLOT_MS);
}

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

  // The lobby, and rolling a character, which happens in it. One track, looping, the same
  // one for everybody, changing on the hour. `shared` is what makes it the same one —
  // see lobbyTrackFor() above. No silence between: the document says a track is ALWAYS
  // playing here, which is the opposite of the ambient bus's mostly-silence rule.
  lobby: {
    layer: "music",
    steps: [{ id: "hour", shared: true, loop: true, fadeInMs: 2000, fadeOutMs: 4000 }, { goto: 0 }],
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

// The tape runProgram is walking right now, or null. Read by resolveProgram, so a GM desk
// can keep one going without ever starting one.
let current = null;

/** Which tape, if any, this state should be playing. */
export function resolveProgram(phase, pathname = "") {
  if (!phase) return null;
  // A GM desk never STARTS a phase tape: a GM adjudicating has no character of their own,
  // which would otherwise start the lobby loop under the audit desk the moment they loaded
  // it. But a tape already playing when they walk onto one plays on — music does not cut out
  // for a change of page — until the phase itself wants something else. What a desk hears
  // in a running game is ambience, and that is MusicDirector's, not a tape.
  if (pathname.startsWith("/gm/")) {
    const wanted = resolveProgram(phase, "/");
    return wanted && wanted === current ? wanted : null;
  }
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
  //
  // With no living character it is the lobby, whatever the phase says. Creation is not a
  // phase of its own — it is what /character renders for somebody with no character once
  // the game is past LOBBY (LOBBY.md §1) — and it happens in the lobby, so it hears the
  // lobby. This used to be two rows, the second of them a tape of its own.
  if (phase.hasCharacter) return null;
  // Two more listeners with no living character are not in the lobby either, once a game is
  // running. A GHOST hears the dead ("Ambience while a ghost"), and a GM hears whatever place
  // they are looking at in Chat. Both are the conductor's, so no tape.
  if (phase.phase === "RUNNING" && (phase.ghost || phase.gm)) return null;
  return PROGRAMS.lobby;
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
  current = program;
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

    // A SHARED step takes its track, its position and its length off the wall clock rather
     // than from its own fields, so that every listener is on the same one. One `now` for
    // all three: reading the clock twice can straddle the changeover and pair one hour's
    // track with the next hour's anchor.
    const now = Date.now();
    const slot = step.shared ? lobbySlot(now) : null;
    const shared = slot === null ? null : { src: lobbyTrackFor(slot), startedAt: slot * LOBBY_SLOT_MS };

    // Every ranged field, rolled once, here. Nothing below reads step.<field> again.
    const silence = roll(step.silenceMs);
    const hold = shared ? lobbySlotRemaining(now) : roll(step.holdMs);
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

    const src = shared ? shared.src : pickSrc(step);
    if (!src) {
      advance();
      return;
    }

    playOn(layer, {
      src,
      startAt: step.startAt ?? 0,
      loop: Boolean(step.loop),
      // An anchored track is sought to where the hour has got to, so somebody opening the
      // lobby forty minutes in joins the loop forty minutes in rather than restarting it.
      ...(shared ? { anchor: { startedAt: shared.startedAt } } : {}),
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
    if (current === program) current = null;
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
