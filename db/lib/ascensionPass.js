// Ravenheart burns. The Rite of Ascension's other half, and the second way a
// game can end (docs/systemdocs/THANATI.md §9, docs/systemdocs/LOBBY.md §7).
//
// ORDERING IS LOAD-BEARING, for the reason nukeExplosionPass.js gives and one
// more of its own. It must run AFTER the staged push and tagExpiry, because
// the one thing that calls this off is the cult leader dying — and a killing
// adjudicated this turn has to beat the clock. If this ran first, a town that
// stormed the hideout and won would still burn.
//
// NOBODY DIES HERE. The bomb kills everyone above ground; this ends the game
// and changes the sky. That is what Bascinet's spec says, and it is a
// different event: the nuke leaves survivors underground with a game to keep
// playing, and this leaves nothing to play.
//
// DB writes only. The Discord fan-out comes back as `broadcast` for the
// side-effect thunk, the catatonicDeathPass.js contract — a pass that posts
// inside the turn transaction is a pass that wedges a turn on a 429.
//
// Takes `prisma` as a parameter — see db/lib/dm.js.

// What every #summary reads, verbatim from Bascinet. No @everyone: the warning
// two turns ago was the one worth waking somebody for, and by the time this
// posts there is nothing left to do about it.
const ASCENSION_LINE = "Ravenheart is consumed by ravenous hellfire and swallowed into the earth.";

const IDLE = Object.freeze({ fired: false, cancelled: false, broadcast: null });

async function runAscensionPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({ where: { id: 1 } });

  // Not armed, or armed for a turn that has not come yet. Returning an object
  // rather than null matters: null means "did not run, retry forever" and
  // would wedge every turn from here on.
  const armedTurn = state?.ascensionArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) return { turnNumber: turn.number, ...IDLE };

  // Already happened. The stamp is never cleared, so this is what stops a
  // resumed or re-run advance burning a dead world a second time.
  if (state?.ascensionFiredTurn != null) return { turnNumber: turn.number, ...IDLE };

  // "It stops ONLY if the cult leader is killed." A dangling id — the row
  // deleted by a Restart, or no leader recorded at all — reads as gone, which
  // cancels, which is the safe direction.
  const leaderId = state?.ascensionLeaderCharacterId ?? null;
  const leader = leaderId
    ? await prisma.character.findUnique({ where: { id: leaderId }, select: { id: true, name: true, status: true } })
    : null;
  if (!leader || leader.status !== "ALIVE") {
    await prisma.gameState.update({ where: { id: 1 }, data: { ascensionArmedTurn: null } });
    return {
      turnNumber: turn.number,
      fired: false,
      cancelled: true,
      leader: leader?.name ?? null,
      broadcast: null,
    };
  }

  // Claim it before anything else, the bomb's rule: a crash halfway through
  // cannot leave a world that burns again on the next close.
  await prisma.gameState.update({
    where: { id: 1 },
    data: { ascensionFiredTurn: turn.number, ascensionArmedTurn: null },
  });

  return {
    turnNumber: turn.number,
    fired: true,
    cancelled: false,
    leader: leader.name,
    broadcast: { content: ASCENSION_LINE },
  };
}

module.exports = { runAscensionPass, ASCENSION_LINE };
