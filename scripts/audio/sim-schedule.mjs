// Runs the in-game soundtrack rules (web/app/components/musicSchedule.js) against a fake
// clock for six hours and checks the promises SOUND.md §4 makes. No audio involved.
//
//   node scripts/audio/sim-schedule.mjs
import {
  FLOW_AFTER_MS,
  SILENCE_SHARE,
  gapAfter,
  nextKind,
} from "../../web/app/components/musicSchedule.js";

// Rough lengths of what actually plays: music tracks, and the ambient pieces (a one-shot's
// file length, or a texture's span plus its tail).
const MUSIC_S = [380, 442, 165, 338, 231, 256, 290, 216, 197];
const AMBIENT_S = [395, 464, 440, 23, 11, 12, 18, 5, 166, 111, 66, 51];
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
let musicPieces = 0;
let ambientPieces = 0;
for (let run = 0; run < RUNS; run += 1) {
  let t = 12_000;
  let quiet = 12_000;
  let last = null;
  while (t < HOURS * 3_600_000) {
    const kind = nextKind({ inGameMs: t, lastKind: last, musicAllowed: true });
    check(!(kind === "music" && t < FLOW_AFTER_MS), `music at ${t}ms, before the flow`);
    check(!(kind === "music" && last === "music"), "two music tracks in a row");
    const list = kind === "music" ? MUSIC_S : AMBIENT_S;
    const d = list[Math.floor(Math.random() * list.length)] * 1000;
    if (kind === "music") musicPieces += 1;
    else ambientPieces += 1;
    const gap = gapAfter(d);
    t += d + gap;
    quiet += gap;
    last = kind;
  }
  totalQuiet += quiet;
  totalTime += t;
}
const share = totalQuiet / totalTime;
console.log(
  `silence ${(share * 100).toFixed(1)}% (target ${SILENCE_SHARE * 100}%), ` +
    `music ${musicPieces} / ambient ${ambientPieces} pieces over ${RUNS}×${HOURS}h`,
);
check(share > 0.7 && share < 0.82, `silence share ${share.toFixed(3)} is off target`);
process.exit(fail ? 1 : 0);
