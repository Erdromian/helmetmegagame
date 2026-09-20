// The thirty seconds between pressing Launch and the Charon leaving
// (docs/systemdocs/CHARON.md). Modelled on db/lib/riteSweep.js — a bot-driven
// pass with no state of its own — but on a five-second tick rather than a
// minute, because a thirty/fifteen/zero countdown cannot be read off a clock
// that only moves sixty seconds at a time.
//
// The countdown lives in the DATABASE, as CharonLaunch.launchAt, and not in a
// setTimeout. That is what makes it survive things: a player closing the tab,
// the bot restarting mid-count, a deploy landing at the worst possible moment.
// If the bot is down past launchAt entirely, the first tick after it comes back
// writes whatever beats it owes and launches the ship — late, but never lost.
//
// Idempotence comes off the FEED rather than off a flag, the way
// db/lib/gameChannel.js#postTurnToGame does it: before writing a beat, look for
// it. That means a tick that crashes halfway through, or two ticks overlapping,
// cannot say the same sentence twice — and it means there is no bookkeeping
// column to get out of step with what players actually saw.
//
// Takes `prisma` as a parameter, off the @lifeweb/db barrel; require it by path.

const {
  charonState,
  completeLaunch,
  shipLine,
  LINES,
  SECOND_BEAT_MS,
  COUNTDOWN_MS,
  shipPlace,
} = require("./charon");
const { placeKeyForLocation } = require("./placeKey");

/**
 * Has this exact sentence already gone into the ship's feed since the countdown
 * that is running now started? Scoped to `since` rather than to all of history,
 * so a second launch attempt after a cancel is not silenced by the first one's
 * lines still sitting in the archive.
 */
async function alreadySaid(prisma, text, since) {
  // Through shipPlace, not by slug: the ground Location survives a launch as a
  // RETIRED row, and looking for a beat in the wrong feed would say it had never
  // been written and write it again.
  const ship = await shipPlace(prisma);
  if (!ship) return true; // no ship, nothing to say into — treat as said, so nothing loops

  const placeKey = placeKeyForLocation(ship.id);
  if (!placeKey) return true;

  const hit = await prisma.archiveEntry.findFirst({
    where: { placeKey, source: "SYSTEM", content: text, createdAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(hit);
}

/**
 * One tick. Returns what it did, for the caller's log line.
 *
 * The first beat is NOT written here — pressLaunch writes it at the moment of
 * the press, so the person who pressed the button hears the locks come off
 * immediately rather than up to five seconds later.
 */
async function runCharonSweep(prisma) {
  const state = await charonState(prisma);
  if (!state.countingDown) return { said: 0, launched: false };

  const launchAt = new Date(state.launchAt).getTime();
  const now = Date.now();
  // Everything this countdown has said was said after it started, and it started
  // one countdown-length before it is due to end. Doubled for slack, so a clock
  // that drifted a little does not make the sweep think it has said nothing yet.
  const since = new Date(launchAt - COUNTDOWN_MS * 2);

  let said = 0;

  if (now >= launchAt - SECOND_BEAT_MS && now < launchAt) {
    if (!(await alreadySaid(prisma, LINES.second, since))) {
      await shipLine(prisma, LINES.second);
      said += 1;
    }
    return { said, launched: false };
  }

  if (now >= launchAt) {
    // The fifteen-second beat too, if the bot was down through it. Better a
    // late line than a countdown that skipped a number.
    if (!(await alreadySaid(prisma, LINES.second, since))) {
      await shipLine(prisma, LINES.second);
      said += 1;
    }
    if (!(await alreadySaid(prisma, LINES.third, since))) {
      await shipLine(prisma, LINES.third);
      said += 1;
    }
    const result = await completeLaunch(prisma);
    return { said, launched: result.launched, moved: result.moved ?? [] };
  }

  return { said, launched: false };
}

module.exports = { runCharonSweep };
