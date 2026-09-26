// The Feedback composer's numbers, split out from db/lib/feedback.js for the
// reason db/lib/dmPolicy.js gives: the dialog is a client component, and one
// require of @lifeweb/db from there drags PrismaClient into the browser
// bundle. ZERO REQUIRES, EVER.

// Under Discord's 2000 with room for the quoting and the subtext line.
const MAX_FEEDBACK_LENGTH = 1500;

// Five notes in any ten minutes from one person. This used to be a flat three
// minutes between notes, which is exactly the wait it was meant to spare
// somebody writing up two bugs in a row — players hit it on their second
// report. Five leaves room for a run of separate bugs while keeping a script
// or a stuck loop from flooding #bugs. The Send button is already disabled
// while a note is in flight, so a double click was never the risk.
const FEEDBACK_BURST = 5;
const FEEDBACK_WINDOW_MS = 10 * 60 * 1000;

// How long until this person may send another note, in ms — 0 means now.
// `times` is when their recent notes were written (Dates or epoch ms, any
// order); anything older than the window is ignored, so the caller may pass
// more than it needs.
function feedbackWaitMs(times, now = Date.now()) {
  const counting = times
    .map((t) => (t instanceof Date ? t.getTime() : Number(t)))
    .filter((t) => now - t < FEEDBACK_WINDOW_MS)
    .sort((a, b) => a - b);
  if (counting.length < FEEDBACK_BURST) return 0;
  // The note whose ageing out brings the count back under the cap.
  return counting[counting.length - FEEDBACK_BURST] + FEEDBACK_WINDOW_MS - now;
}

function feedbackWaitMessage(waitMs) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60000));
  return `You've sent a lot of feedback in the last few minutes. You can send more in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

module.exports = {
  MAX_FEEDBACK_LENGTH,
  FEEDBACK_BURST,
  FEEDBACK_WINDOW_MS,
  feedbackWaitMs,
  feedbackWaitMessage,
};
