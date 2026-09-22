// Runs the in-game soundtrack rules (web/app/components/musicSchedule.js) against a fake
// clock for six hours and checks the promises SOUND.md §4 makes. No audio involved.
//
//   node scripts/audio/sim-schedule.mjs      (npm run sounds:schedule)
//
// There is one kind of piece now. This used to also assert the music-vs-ambient rules —
// never in the first eight minutes, never twice running — which went when the general
// rotation did; see musicSchedule.js's header for why. What is left is the rule the design
// document actually states: silence is most of it.
import { MIN_GAP_MS, SILENCE_SHARE, gapAfter, pickOne } from "../../web/app/components/musicSchedule.js";

// Rough lengths of what plays: a one-shot's file length, or a texture's span plus its tail.
// The long ones are the tracks that used to be the rotation and are now somebody's place.
const PIECE_S = [395, 464, 440, 380, 231, 165, 23, 11, 12, 18, 5, 166, 111, 66, 51];
const HOURS = 6;
const RUNS = 200;

let fail = false;
const check = (ok, msg) => {
  if (!ok) {
    fail = true;
    console.error("FAIL", msg);
  }
};

let totalQuiet = 0;
let totalTime = 0;
let pieces = 0;
let repeats = 0;
for (let run = 0; run < RUNS; run += 1) {
  let t = 12_000;
  let quiet = 12_000;
  let last = null;
  while (t < HOURS * 3_600_000) {
    const d = pickOne(PIECE_S, last);
    if (d === last) repeats += 1;
    const gap = gapAfter(d * 1000);
    check(gap >= MIN_GAP_MS, `gap ${Math.round(gap)}ms is under the floor`);
    t += d * 1000 + gap;
    quiet += gap;
    pieces += 1;
    last = d;
  }
  totalQuiet += quiet;
  totalTime += t;
}
const share = totalQuiet / totalTime;
console.log(
  `silence ${(share * 100).toFixed(1)}% (target ${SILENCE_SHARE * 100}%), ` +
    `${pieces} pieces over ${RUNS}×${HOURS}h, ${repeats} immediate repeats`,
);
check(share > 0.7 && share < 0.82, `silence share ${share.toFixed(3)} is off target`);
// pickOne's whole job: never the same piece twice running when there is a choice.
check(repeats === 0, `${repeats} pieces repeated back to back`);
process.exit(fail ? 1 : 0);
