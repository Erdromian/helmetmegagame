const { turnEndsAt, moveWindow, epochSeconds } = require("./lib/turnClock");

// Turns advance at 0:00 America/Chicago (bot/src/events/ready.js's cron
// schedule), once a real day, strictly alternating DAWN/DUSK — every turn opens
// at midnight and runs until the next midnight, so an in-game day (a DAWN and
// the DUSK after it) spans two real days. The announcement renders this as a
// Discord <t:EPOCH:t>/<t:EPOCH:R> tag (per-viewer local time + relative
// countdown), which needs an actual Unix epoch rather than a text label.
//
// The derivation (and the DST-safe local-time-in-a-zone -> UTC conversion it
// needs) moved to db/lib/turnClock.js, which works off the turn's own
// startedAt rather than off `now` — see the note there for why that matters.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The in-fiction calendar. Day 1 is April 21st, 1098, and it turns over once
// per in-game day — so a DAWN and the DUSK after it share a date, which is
// what `day` (ceil(turn.number / 2)) already gives us. This has nothing to do
// with db/lib/turnClock.js: that module owns the real clock the deadlines run
// on, and this one is a label. UTC getters throughout so no timezone or DST
// can shift the day, and the month name and ordinal are written out here
// rather than left to Intl, which would want a locale pinned and still not
// give us "21st".
const GAME_EPOCH = Date.UTC(1098, 3, 21);
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Shared by the bot's cron-triggered turn advance and the GM dashboard's
// manual "End turn" action so the announcement text (and the ping logic behind
// it) only exists in one place instead of being duplicated
// per transport (Discord.js channel.send vs. REST postMessage).
function buildTurnAnnouncement(turn, note, { clockFrozen = false } = {}) {
  const day = Math.ceil(turn.number / 2);
  const phaseLabel = turn.phase === "DAWN" ? "Dawn" : "Dusk";
  const pingRoleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  const ping = pingRoleId ? ` <@&${pingRoleId}>` : "";
  const { endsAt, cutoffAt, hasLock } = moveWindow(turn, { clockFrozen });
  const endEpoch = epochSeconds(endsAt);
  const cutoffEpoch = epochSeconds(cutoffAt);
  // The Move cutoff rides on the turn announcement because that is the one
  // place every player reliably reads — and both times are <t:> tags, so each
  // reads them in their own timezone.
  const clock = hasLock
    ? `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R> | Moves must be sent by <t:${cutoffEpoch}:t>, or <t:${cutoffEpoch}:R>.`
    : `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R>.`;
  // The bookkeeping rides in `-#` subtext so it does not compete with the one
  // line players actually read — which half of the day it is.
  const header = `-# Day ${day}, Turn ${turn.number} | ${gameDate(day)}`;
  const scene = `${phaseLabel}.${ping}`;
  const body = `${header}\n\n${scene}\n${clock}`;
  return note ? `${body}\n\n${note}` : body;
}

module.exports = { gameDate, buildTurnAnnouncement };
