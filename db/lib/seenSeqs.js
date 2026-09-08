// "Has this stream already sent that row?", with a bound on how much it
// remembers.
//
// The feed's SSE stream used to answer this with a high-water mark — a single
// `lastSeq`, and anything at or below it was assumed sent. That is wrong the
// moment a row arrives late, which happens for ordinary reasons: `seq` is a
// Postgres sequence, allocated in order but neither committed nor fanned out
// in order. A row that lost that race sat below the mark, was dropped at the
// gate, was excluded from every later catch-up (which asks for `gt`), and was
// skipped by a fresh page load too. It never reached the website, while
// Discord had it all along.
//
// Two generations rather than one growing Set: when the live one fills it
// becomes the spare and a fresh one takes over, so memory is capped at about
// 2 × max while nothing is forgotten sooner than `max` rows after it was sent.
// Forgetting early is cheap anyway — the browser keys its own Map on seq
// (web/app/(app)/play/feedStore.js#applyRow) and treats a repeat as a no-op —
// so this exists to keep the wire quiet, not for correctness.
function makeSeenSeqs(max = 1000) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError("makeSeenSeqs needs a positive integer");
  let live = new Set();
  let spare = new Set();
  return {
    has(key) {
      return live.has(key) || spare.has(key);
    },
    add(key) {
      live.add(key);
      if (live.size >= max) {
        spare = live;
        live = new Set();
      }
    },
    // Live + spare, for a test or a log line. Not the number of DISTINCT keys
    // remembered when a key sits in both, which only happens if it was re-added
    // after a flip.
    get size() {
      return live.size + spare.size;
    },
  };
}

module.exports = { makeSeenSeqs };
