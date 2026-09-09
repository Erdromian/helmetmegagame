// A DRAIN, and nothing else any more. docs/systemdocs/MAP.md §3.
//
// This used to be the whole deferred-travel mechanic: a zone crossing that
// cost the Move spent it at once and parked its destination on
// Character.travelToLocationId, and this pass walked the traveller and their
// party over at the next turn advance — a day on the road, which is what kept
// the destination's channels shut until then.
//
// Every crossing lands the moment it is made now (2026-09-14), and
// performLocationMove writes travelToLocationId nowhere. NOTHING FILES WORK
// FOR THIS PASS. It is kept, and kept LAST in TURN_PASSES, for exactly one
// reason: anybody who was mid-journey when that change deployed still has a
// destination parked on their row and nothing else left to land them. It walks
// them over on the first advance after the deploy and is a permanent no-op
// from then on — its findMany matches nobody, and no cleanup is owed.
//
// Delete it once the stragglers have landed. The columns stay either way;
// this schema drops none (CLAUDE.md).
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
