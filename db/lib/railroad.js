// The tunnels out of the Depot, and what is in one of them.
//
// A `railroad: true` edge in docs/zones.yaml is an ordinary crossing in every
// way but one: the cargo train uses it. The clock is the train's own
// (db/lib/train.js#trainHere, read against the OPEN turn) — standing at the
// platform the tunnel is empty and the walk is unremarkable; out on the line
// it is not survivable, and there is no roll, no armour and no severity ladder
// between you and that. It is the only hazard in the game with no die in it,
// which is exactly why the confirm is asked EVERY time on both faces
// (web/lib/travelCost.js#crossingConfirm, bot/src/events/interactions/travel.js)
// rather than only when the player is about to spend something.
//
// Shaped like db/lib/turretPass.js#rollTurretOnArrivalAt on purpose: it decides
// and it kills, it returns a death descriptor, and it does no Discord work of
// its own. Takes `prisma` as a parameter and stays off the @lifeweb/db barrel,
// same as its neighbours.

const { trainHere } = require("./train");
const { applyDeathToRow } = require("./characterDeath");
const { linkBetween } = require("./locationGraph");
const { seatZoneIdFor } = require("./seatZone");

// Third person: this is the `#leave` line, not the DM.
const RAILROAD_DEATH_REASON = "They went into the tunnel while the train was on the line.";

// What the archive keeps.
const RAILROAD_DEATH_CONTENT = (name) => `${name} was killed by the train.`;

// What the destination hears. Scenery, so the caller runs it through
// db/lib/ambientLine.js — pass raw text, never a pre-written `-#`.
const RAILROAD_LOCATION_LINE = (name) =>
  `The train comes through the tunnel. There is not enough of ${name} left to bury.`;

// Pure, so the parity can be pinned without a database. Deliberately the exact
// negation of trainHere: the two must never drift, and db/test/railroad.test.js
// asserts that over a run of turns.
//
// NOTE trainHere(1) is false — turn 1 is "not in yet", nothing has run — so the
// tunnel kills on turn 1 as well. That falls out of using the train's own clock
// rather than a second one, and is the designer's call, not an accident. If
// turn 1 should ever be safe the predicate is `!trainHere(n) && n > 1`.
function tunnelKills(turnNumber) {
  return !trainHere(turnNumber);
}

// Called on every arrival from db/lib/locationMove.js#applyLocationMoveSideEffects.
// Returns null for the overwhelming majority of moves — a first placement, a GM
// teleport, a revive and a rite all cross no edge, and every other edge is not a
// railroad — at a cost of one indexed read.
async function railroadGibOnArrival(prisma, { characterId, fromLocationId, toLocationId, turn }) {
  // No origin means nobody crossed anything: a spawn, a teleport, a reincarnation.
  if (!fromLocationId || !toLocationId) return null;

  const link = await linkBetween(prisma, fromLocationId, toLocationId);
  if (!link?.railroad) return null;
  if (!tunnelKills(turn?.number)) return null;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      // Captured before applyDeathToRow nulls it out from under us — the same
      // note TURRET_CHARACTER_SELECT carries.
      discordRoleId: true,
      status: true,
    },
  });
  if (!character || character.status !== "ALIVE") return null;

  const roleId = character.discordRoleId;
  // gib: every tag vaporized, no corpse minted, nothing left to bury, loot or
  // butcher — the Remote Detonator's death exactly (docs/systemdocs/COLLAR.md).
  const { claimed } = await applyDeathToRow(prisma, character, {
    turn: turn ?? null,
    gib: true,
    content: RAILROAD_DEATH_CONTENT(character.name),
  });
  // Something else already killed them this turn. Not ours to announce.
  if (!claimed) return null;

  // The SEAT zone, not the presence zone. A death in the Chasm belongs on the
  // Caves GM's table — the Depths have no seat of their own, and filing it
  // against the presence zone is the exact failure db/lib/seatZone.js's header
  // warns about.
  const toLocation = await prisma.location.findUnique({
    where: { id: toLocationId },
    include: { zone: true },
  });

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system:railroad",
        actionType: "system_railroad_gib",
        targetCharacterId: character.id,
        // Set deliberately: /gm/audit's turn filter reads it, and anything a
        // per-turn ration might one day count needs it (CLAUDE.md).
        turnId: turn?.id ?? null,
        locationId: toLocationId,
        details: {
          turnNumber: turn?.number ?? null,
          from: fromLocationId,
          to: toLocationId,
          // applyDeathToRow only writes its own gib audit row when there were
          // tags to vaporize, so a bare sheet would otherwise die unrecorded.
          note: "went into the tunnel while the train was on the line",
        },
      },
    })
    .catch((err) => console.error(`Railroad: audit failed for ${character.id}:`, err.message ?? err));

  return {
    locationId: toLocationId,
    death: {
      characterId: character.id,
      // `id` too: applyDeathTeardown -> revokeAllCharacterAccess reads it for
      // private-Room door grants; missing it silently matches nothing.
      id: character.id,
      name: character.name,
      discordUserId: character.discordUserId,
      discordRoleId: roleId,
      zoneId: seatZoneIdFor(toLocation?.zone),
      reason: RAILROAD_DEATH_REASON,
      ownDm: true,
    },
  };
}

module.exports = {
  RAILROAD_DEATH_REASON,
  RAILROAD_DEATH_CONTENT,
  RAILROAD_LOCATION_LINE,
  tunnelKills,
  railroadGibOnArrival,
};
