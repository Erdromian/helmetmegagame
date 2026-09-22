// The in-game soundtrack's rules, as pure functions — no audio, no clock, no window — so
// they can be run against a fake clock (scripts/audio/sim-schedule.mjs). musicConductor.js
// is the only caller in the app. See docs/systemdocs/SOUND.md §4.

// About three quarters of in-game time is silence, which is the design document's first
// rule: "silence should remain most of the background track". After a piece that lasted d,
// the gap is d × (share / (1 - share)), ±30%, so the ratio holds whatever came up.
export const SILENCE_SHARE = 0.75;
export const MIN_GAP_MS = 120_000;

// THERE IS NO SECOND KIND OF PIECE any more. This used to alternate an ambient bed with a
// track off a general music rotation, on a 35% roll once you had settled in for eight
// minutes. The design document has no such rotation: every one of the nine tracks that was
// in it is either lobby music, the ambience of a particular place, or marked Unused. So
// in-game there is one kind of piece — what this place sounds like — and `nextKind`,
// `MUSIC_CHANCE`, `FLOW_AFTER_MS` and `AMBIENT_GAIN` went with the idea. A long track is
// still a long track; it just belongs somewhere now. See docs/sounds.yaml.

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
