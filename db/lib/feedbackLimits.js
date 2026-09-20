// The Feedback composer's numbers, split out from db/lib/feedback.js for the
// reason db/lib/dmPolicy.js gives: the dialog is a client component, and one
// require of @lifeweb/db from there drags PrismaClient into the browser
// bundle. ZERO REQUIRES, EVER.

// Under Discord's 2000 with room for the quoting and the subtext line.
const MAX_FEEDBACK_LENGTH = 1500;

// Three minutes between notes from one person. Long enough that a stuck retry
// button cannot flood the channel, short enough that somebody writing up two
// separate bugs is not made to wait around.
const FEEDBACK_COOLDOWN_MS = 3 * 60 * 1000;
const FEEDBACK_COOLDOWN_MESSAGE = "You sent feedback too recently.";

module.exports = { MAX_FEEDBACK_LENGTH, FEEDBACK_COOLDOWN_MS, FEEDBACK_COOLDOWN_MESSAGE };
