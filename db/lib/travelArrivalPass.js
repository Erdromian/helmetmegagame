// Journeys landing. docs/systemdocs/MAP.md §3.
//
// A zone crossing that costs the Move is a day on the road: the Move is spent
// the moment the player confirms, but nothing about where they STAND changes
// until this pass walks them over at the next turn advance. That is the whole
// point — the destination's channels stay shut for the rest of the turn they
// left in, instead of opening under them the second they press Confirm. Free
// crossings and same-zone hops never come through here; they land at once.
//
// The destination is parked on Character.travelToLocationId by
// db/lib/locationTravel.js#performLocationMove, for the traveller and for
// anyone they dragged along.
//
// LAST in TURN_PASSES, and the order is load-bearing: every other pass settles
// the turn that just ended, and the traveller spent that turn walking. Auto-
// labor pays them at the place they left, and the Depot and Gatehouse turrets
// do not shoot somebody who is still on the road while they sweep.
//
// No Discord work here — same split as everything else in db/lib. The rows
// this returns go through the zoneMoves loop in db/index.js#runSideEffects,
// which owns the role swap (applyLocationMoveSideEffects) and the Caving Die.
//
// Takes `prisma` as a parameter (db/lib/dm.js convention); off the barrel.
const { recordArchiveEvent } = require("./archive");

async function runTravelArrivalPass(prisma, config) {
  const travelling = await prisma.character.findMany({
    where: { travelToLocationId: { not: null } },
    select: {
      id: true,
      name: true,
      status: true,
      discordUserId: true,
      locationId: true,
      zoneId: true,
      travelToLocationId: true,
      zone: { select: { name: true } },
    },
  });

  const arrivals = [];
  for (const row of travelling) {
    try {
      const target = await prisma.location.findUnique({
        where: { id: row.travelToLocationId },
        include: { zone: true },
      });
      // The place stopped existing mid-journey (a zone re-sync, most likely).
      // Clear the road rather than leaving a character walking forever.
      if (!target) {
        await prisma.character.update({
          where: { id: row.id },
          data: { travelToLocationId: null, travelTurnId: null },
        });
        continue;
      }

      await prisma.character.update({
        where: { id: row.id },
        data: {
          locationId: target.id,
          zoneId: target.zoneId,
          lastLocationMoveAt: new Date(),
          travelToLocationId: null,
          travelTurnId: null,
        },
      });

      // Off by default (GameConfig.archiveTravelEvents) and recorded here
      // rather than at departure, because here is where the journey happened.
      if (config?.archiveTravelEvents && row.zoneId !== target.zoneId) {
        await recordArchiveEvent(prisma, {
          kind: "TRAVEL",
          character: row,
          zoneId: target.zoneId,
          zoneName: target.zone.name,
          content: `${row.name} left ${row.zone?.name ?? "the road"} for ${target.zone.name}.`,
        }).catch((err) => console.error(`Travel archive row for ${row.id} failed:`, err));
      }

      arrivals.push({
        characterId: row.id,
        discordUserId: row.discordUserId,
        name: row.name,
        alive: row.status === "ALIVE",
        fromLocationId: row.locationId,
        toLocationId: target.id,
        toLocationName: target.name,
      });
    } catch (err) {
      // One stuck traveller must not cost everyone else their arrival. The
      // row keeps its destination and the next advance tries again.
      console.error(`Travel arrival failed for character ${row.id}:`, err);
    }
  }

  return arrivals;
}

module.exports = { runTravelArrivalPass };
