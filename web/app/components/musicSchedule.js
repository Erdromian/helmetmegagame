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

// "The most specific ambience track to a situation will be selected over more general
// tracks, with some variation to avoid a single track looping." A place is a stack of tiers,
// most specific first (placeAmbience.js), and this is how hard the top of the stack wins:
// the first tier more than half the time, and each one under it less. Renormalised over the
// tiers a place actually has, so a place with two tiers splits 0.55 : 0.25 as 69% : 31%.
// Numbers, not control flow — retune by editing them. Past the fourth tier, each further
// one gets the last weight.
export const TIER_WEIGHTS = [0.55, 0.25, 0.12, 0.08];

/**
 * One piece off a stack of tiers (`[[piece…], …]`, most specific first), never the piece
 * whose `src` is `lastSrc` when there is anything else. A tier holding only the last piece
 * drops out of the roll rather than repeating it.
 */
export function pickTiered(tiers, lastSrc, rand = Math.random) {
  const stack = (tiers ?? []).filter((t) => t?.length);
  if (!stack.length) return null;
  const live = stack
    .map((t, i) => ({ t: t.filter((p) => p.src !== lastSrc), w: TIER_WEIGHTS[i] ?? TIER_WEIGHTS.at(-1) }))
    .filter((x) => x.t.length);
  // Nothing here but the piece that just played. Better it again than silence for ever.
  if (!live.length) return stack[0][0];
  const total = live.reduce((sum, x) => sum + x.w, 0);
  let r = rand() * total;
  for (const x of live) {
    r -= x.w;
    if (r < 0) return x.t[Math.floor(rand() * x.t.length)];
  }
  const tail = live.at(-1).t;
  return tail[tail.length - 1];
}

/** A number, or a `[min, max]` range rolled once. */
export function roll(value, rand = Math.random) {
  return Array.isArray(value) ? between(rand, value[0], value[1]) : value;
}
