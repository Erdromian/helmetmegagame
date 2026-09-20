const { moveWindow, epochSeconds } = require("./lib/turnClock");

// A turn runs 6, 8, 12 or 24 hours (GameConfig.turnLengthHours) and ends on a
// clean America/Chicago boundary. There are no Dawn and Dusk halves any more —
// a turn is a turn, and Turn.dayNumber says which in-game day it belongs to.
// The announcement renders the deadlines as Discord <t:EPOCH:t>/<t:EPOCH:R>
// tags, which needs an actual Unix epoch rather than a text label. Those tags
// are the one place a reader sees their OWN timezone rather than the game's:
// Discord renders them client-side and the bot cannot override it.
//
// The derivation (and the DST-safe local-time-in-a-zone -> UTC conversion it
// needs) lives in db/lib/turnClock.js, which works off the turn's own stored
// endsAt rather than off `now` — see the note there for why that matters.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The in-fiction calendar. Day 1 is April 21st, 1098, and it turns over once
// per in-game day — so every turn sharing a Turn.dayNumber shares a date. This
// has nothing to do with db/lib/turnClock.js: that module owns the real clock
// the deadlines run on, and this one is a label. UTC getters throughout so no timezone or DST
// can shift the day, and the month name and ordinal are written out here
// rather than left to Intl, which would want a locale pinned and still not
// give us "21st".
const GAME_EPOCH = Date.UTC(1098, 3, 21);
const DAY_MS = 24 * 60 * 60 * 1000;

// The bare year, on its own, for the two places that used to hand-type
// "1098": the "Ravenheart …" foot line (PageShell.js, CharacterSheet.js) and
// the top bar's clock block ("Day 14 · 1098 · Turn 27 · 10:28 PM",
// TopBar/ClockBlock.js). One exported constant rather than a third literal —
// it reads off the same epoch gameDate() does, so if the game ever runs long
// enough to cross a year boundary, the day-of-year math would need to move
// here too rather than in a fourth copy.
const GAME_YEAR = new Date(GAME_EPOCH).getUTCFullYear();

function ordinal(n) {
  // 11th, 12th and 13th are the exceptions the last-digit rule gets wrong.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function gameDate(day) {
  const d = new Date(GAME_EPOCH + (day - 1) * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
}

// The FACTS of a turn — the day, the in-world date and the one clock sentence —
// with no dressing on them. Both faces read this and then dress it their own
// way: #turns adds the `-#` subtext header, the ping role and the console footer
// (buildTurnAnnouncement, below), and the web's Game channel lays the same three
// out as a block (db/lib/gameChannel.js). Computing the times twice is how the
// two would come to disagree about when Moves close.
function turnFacts(turn, { clockFrozen = false, frozenReason = null, phase = null } = {}) {
  const day = turn.dayNumber ?? Math.ceil(turn.number / 2);
  const { endsAt, cutoffAt, hasLock } = moveWindow(turn, { clockFrozen });
  const endEpoch = epochSeconds(endsAt);
  const cutoffEpoch = epochSeconds(cutoffAt);
  // The Move cutoff rides on the turn announcement because that is the one
  // place every player reliably reads — and both times are <t:> tags, so each
  // reads them in their own timezone.
  //
  // A FROZEN CLOCK NEVER QUOTES A TIME. A turn row carries an `endsAt` whatever
  // the game is doing, so the two lines below would happily count down to a
  // deadline nobody is keeping — which is exactly what a wiped, not-yet-started
  // game used to show: "Day 1, Turn 1" with a live countdown and nobody playing.
  // Saying what is actually true is more use than a time that means nothing.
  //
  // NOT_RUNNING is two different truths (db/lib/gameState.js#frozenReason) — the
  // lobby and the epilogue — and End Game reposts the console for the still-open
  // turn, so telling a finished game it has not started would be worse than the
  // countdown. `phase` is what tells them apart.
  const clock = frozenClock(frozenReason, phase)
    ?? (hasLock
      ? `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R> | Moves must be sent by <t:${cutoffEpoch}:t>, or <t:${cutoffEpoch}:R>.`
      : `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R>.`);
  return { day, date: gameDate(day), clock };
}

// The one sentence a stopped clock gets, or null when it is running. Out of session comes from db/lib/session.js.
function frozenClock(frozenReason, phase) {
  if (frozenReason === "NOT_IN_SESSION") return "The game isn't in session.";
  if (frozenReason !== "NOT_RUNNING") return null;
  return phase === "ENDED" ? "The game is over." : "The game hasn't started yet.";
}

// Shared by the bot's cron-triggered turn advance and the GM dashboard's
// manual "End turn" action so the announcement text (and the ping logic behind
// it) only exists in one place instead of being duplicated
// per transport (Discord.js channel.send vs. REST postMessage).
function buildTurnAnnouncement(turn, note, options = {}) {
  const { day, date, clock } = turnFacts(turn, options);
  const pingRoleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  const ping = pingRoleId ? `<@&${pingRoleId}>` : "";
  // The bookkeeping rides in `-#` subtext so it does not compete with the line
  // players actually read. There used to be a one-word scene line above the
  // clock — "Dawn." or "Dusk." — and with the phases gone it has nothing left
  // to say, so the ping it carried moves onto the clock line rather than
  // sitting alone on a line of its own.
  const header = `-# Day ${day}, Turn ${turn.number} | ${date}`;
  const body = `${header}\n\n${ping ? `${ping}\n` : ""}${clock}`;
  return note ? `${body}\n\n${note}` : body;
}

module.exports = { gameDate, GAME_YEAR, turnFacts, frozenClock, buildTurnAnnouncement };
