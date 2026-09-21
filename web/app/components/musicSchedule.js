// The in-game soundtrack's rules, as pure functions — no audio, no clock, no window — so
// they can be run against a fake clock (scripts/audio/sim-schedule.mjs). musicConductor.js
// is the only caller in the app. See docs/systemdocs/SOUND.md §4.

// About three quarters of in-game time is silence. After a piece that lasted d, the gap
// is d × (share / (1 - share)), ±30%, so the ratio holds whatever mix of pieces came up.
export const SILENCE_SHARE = 0.75;
export const MIN_GAP_MS = 120_000;

// Music is what comes once you have settled in, never the first thing you hear.
export const FLOW_AFTER_MS = 8 * 60_000;
export const MUSIC_CHANCE = 0.35;

// Ambient sits under the music, so a song stands out when it arrives.
export const AMBIENT_GAIN = 0.85;

// A piece that never reports its end (a file that failed to load) is let go after this.
// Far past the longest file, so it can only ever catch a broken one — a song paused under
// somebody's performance for a while still gets to finish.
export const PIECE_WATCHDOG_MS = 30 * 60_000;

const between = (rand, min, max) => min + rand() * (max - min);

/** How long to stay quiet after a piece that played for `durationMs`. */
export function gapAfter(durationMs, rand = Math.random) {
  const ratio = SILENCE_SHARE / (1 - SILENCE_SHARE);
  return Math.max(MIN_GAP_MS, durationMs * ratio * between(rand, 0.7, 1.3));
}

/** "music" or "ambient" for the next piece. */
export function nextKind({ inGameMs, lastKind, musicAllowed, hasAmbient = true }, rand = Math.random) {
  const musicOk = musicAllowed && inGameMs >= FLOW_AFTER_MS && lastKind !== "music";
  if (!musicOk) return hasAmbient ? "ambient" : null;
  if (!hasAmbient) return "music";
  return rand() < MUSIC_CHANCE ? "music" : "ambient";
}

/** One item off a list, never the one played last time when there is a choice. */
export function pickOne(list, last, rand = Math.random) {
  if (!list?.length) return null;
  if (list.length === 1) return list[0];
  const pool = list.filter((item) => item !== last);
  return pool[Math.floor(rand() * pool.length)];
}

/** A number, or a `[min, max]` range rolled once. */
export function roll(value, rand = Math.random) {
  return Array.isArray(value) ? between(rand, value[0], value[1]) : value;
}
