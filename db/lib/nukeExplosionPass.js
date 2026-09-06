// The bomb goes off. TURN-ENGINE.md's newest pass, and the only one that can
// end most of a game in a single close.
//
// ORDERING IS LOAD-BEARING. It must run:
//   - AFTER tagExpiry and the staged push, so a Disarm filed this turn — or a
//     GM defusing it from /gm/dev — beats the clock. Same rule dyingDeath
//     already follows, and for the same reason: the last word belongs to the
//     people who acted, not to the timer.
//   - BEFORE the expiry sweep, purely so it sits with its siblings. It reads
//     GameConfig rather than a tag, so the sweep cannot actually eat its
//     trigger the way it would have eaten an armed tag — which is one of the
//     reasons the countdown lives where it does.
//
// WHO DIES: every ALIVE character whose zone is not a CAVE_LEVEL. The Caves
// and the Depths are the only two, and being under the rock is the whole
// escape. A character with no zone at all (never placed) is left alone — the
// blast is a fact about the map, and they are not on it.
//
// DB writes only. Discord work comes back as `deaths` and `broadcast` for the
// side-effect thunk, the catatonicDeathPass.js contract exactly — a pass that
// posts to Discord inside the turn transaction is a pass that can wedge a
// turn on a 429.
//
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { applyDeathToRow } = require("./characterDeath");

// What every #summary reads, verbatim from Bascinet. The @everyone is the
// point: this is the one event in the game that should wake somebody who is
// asleep. Unsigned — these are their words.
const DETONATION_LINE =
  "You hear a deafening roar. There's a fireball in the sky. @everyone";

async function runNukeExplosionPass(prisma, turn) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });

  // Not armed, or armed for a turn that has not come yet. Returning an object
  // rather than null matters: null means "did not run, retry forever" and
  // would wedge every turn from here on.
  const armedTurn = config?.nukeArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // Already gone off. The stamp is never cleared, so this is what stops a
  // resumed or re-run advance detonating a second time on a dead world.
  if (config?.nukeDetonatedTurn != null) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // Claim it first. Disarming clears nukeArmedTurn, so writing the detonation
  // stamp before the killing starts means a crash halfway through cannot
  // leave a world that explodes again on the next close.
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { nukeDetonatedTurn: turn.number, nukeArmedTurn: null },
  });

  const doomed = await prisma.character.findMany({
    where: { status: "ALIVE", zone: { kind: { not: "CAVE_LEVEL" } } },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      discordRoleId: true,
      zoneId: true,
    },
  });

  const deaths = [];
  for (const character of doomed) {
    // Sequential, never Promise.all: each applyDeathToRow mints a corpse,
    // vacates a faction office and writes an archive row, and the conditional
    // claim inside it is what makes a resumed turn unable to kill twice.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      content: `${character.name} died in the blast.`,
    });
    if (!claimed) continue;
    deaths.push({
      characterId: character.id,
      name: character.name,
      discordUserId: character.discordUserId,
      // Captured before applyDeathToRow nulls it — the thunk still owes
      // Discord this role's deletion.
      discordRoleId: character.discordRoleId,
      zoneId: character.zoneId,
    });
  }

  return {
    turnNumber: turn.number,
    detonated: true,
    killed: deaths.length,
    deaths,
    broadcast: { content: DETONATION_LINE, mentionEveryone: true },
  };
}

module.exports = { runNukeExplosionPass, DETONATION_LINE };
